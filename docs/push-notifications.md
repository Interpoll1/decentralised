# Chat notifications

Three layers, shipped together.

| Layer | Works when | Needs |
|-------|-----------|-------|
| **Local** — `src/services/notificationService.ts` | App process alive (foreground, or backgrounded but not swiped away) | Nothing. Already on. |
| **Remote push (FCM)** — `src/native/pushNotifications.ts` + `relay-push/push-notifications.js` | Always, including app killed | Firebase project + relay wiring, below |
| **Email fallback (Resend)** — `src/native/emailNotifications.ts` + `relay-push/email-notifications.js` | Push could not reach the user at all — web build, push switched off, or a dead FCM token | `RESEND_API_KEY` on the relay + the user opting in |

The first two deep-link through the same `data.path`, so a tap lands on
`/chat/<peerId>` either way.

**Resend does not replace FCM.** Resend sends email; it cannot deliver an
Android notification, and an inbox is not a tray notification. It is a
fallback for reach FCM does not have, and it fires only when the FCM path
delivered nothing.

---

## Layer 1 — local notifications (already working)

`@capacitor/local-notifications` on native, the Web Notification API in the
browser. `useChat` calls `initNotifications()` once and `notifyChatMessage()`
per incoming message; opening a chat clears that peer's notification.

Android channel: `interpoll-chat` ("Messages", high importance). Created on
first init.

Nothing to configure. Rebuild and sync:

```bash
npm run cap:sync
```

---

## Layer 2 — FCM push (app closed)

### 1. Firebase

1. Create a Firebase project (or reuse one) at <https://console.firebase.google.com>.
2. Add an **Android app** with the package name from `capacitor.config.*`
   (`appId`).
3. Download `google-services.json` → put it at `android/app/google-services.json`.
4. Project settings → **Service accounts** → *Generate new private key*. Keep
   that JSON off the repo; it goes on the relay host only.

### 2. Android Gradle

`android/` is largely gitignored here, so make these edits after `cap sync`
(or once, then keep them — `cap sync` does not overwrite them):

`android/build.gradle`, in `buildscript { dependencies { … } }`:

```gradle
classpath 'com.google.gms:google-services:4.4.2'
```

`android/app/build.gradle`, at the bottom:

```gradle
apply plugin: 'com.google.gms.google-services'
```

`android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

### 3. Relay

The relay source (`relay-server/relay-server-enhanced.js`) is gitignored and
lives on the VPS. Copy the module up and wire it in:

```bash
scp relay-push/push-notifications.js <vps>:/path/to/relay-server/
scp <your-service-account>.json <vps>:/path/to/relay-server/fcm-service-account.json
```

In `relay-server-enhanced.js`:

```js
const { attachPush } = require('./push-notifications');

const push = attachPush(app, {
  serviceAccountPath: './fcm-service-account.json',
  tokenStorePath:     './push-tokens.json',
  // Skip the push when the recipient already has a live socket:
  isUserOnline: (userId) => connectedUsers.has(userId),
});
```

Then, wherever the relay forwards a chat frame to its recipient, add:

```js
void push.notifyChatMessage({
  toUserId:   frame.to,
  fromUserId: frame.from,
  senderName: displayNameFor(frame.from) || 'New message',
});
```

Restart under PM2:

```bash
pm2 restart relay-server
```

The module adds `POST /api/push/register` and `POST /api/push/unregister`. The
OAuth2 access token is minted by signing a JWT with node's built-in `crypto`;
the only npm dependencies are `@noble/curves` and `@noble/hashes`, which the
relay already has for signature verification.

#### How the endpoints are authenticated

There is no session to trust — InterPoll identities are keys, not accounts, and
the relay is explicitly untrusted. So registration is self-authenticating:

- `userId` **is** the x-only Schnorr public key.
- The client signs `interpoll-push-register-1:<userId>:<deviceId>:<token>:<ts>`
  with the matching private key (`CryptoService.sign`, same primitive as
  `signRawSchnorr` in `shared-validation/signatures.js`).
- The relay verifies that signature *against `userId` itself*, so no key
  lookup is needed and nobody can bind their FCM token to another identity —
  which would leak who is messaging that user — or unregister someone else's
  device, which would silence them.
- `ts` must be within 5 minutes and each signature is accepted once, so a
  captured request cannot be replayed. Registrations are rate-limited to 20 per
  IP per minute.

Unregister is signed the same way (`interpoll-push-unregister-1:…`) and only
removes a device whose stored `userId` matches the signer.

### 4. Email fallback (Resend)

Optional, and independent of the Firebase setup above — it works even with no
FCM at all, which is what makes the web build reachable.

```bash
scp relay-push/email-notifications.js <vps>:/path/to/relay-server/
```

`attachPush` picks it up automatically; the only required setting is the key:

```bash
# relay environment
RESEND_API_KEY=re_...
RESEND_FROM='InterPoll <notifications@endless.sbs>'   # must be a Resend-verified domain
APP_PUBLIC_URL=https://endless.sbs                    # "open the app" link
SERVER_ORIGIN=https://relay.endless.sbs               # where the unsubscribe link points
EMAIL_STORE=./push-emails.json                        # optional, this is the default
EMAIL_COOLDOWN_MS=900000                              # optional, 15 min default
```

With no `RESEND_API_KEY` the module logs `[Email] No RESEND_API_KEY — email
fallback disabled` and everything else carries on unchanged. To disable it
even when a key is present, pass `email: false` to `attachPush`.

It adds three routes:

| Route | Purpose |
|-------|---------|
| `POST /api/push/email/register` | Bind an address to an identity (signed, as below) |
| `POST /api/push/email/unregister` | Unbind it |
| `GET /api/push/email/unsubscribe?token=…` | One-click opt-out for the *recipient* of an unwanted mail — no identity key needed, the HMAC'd token in the link is the authority |

Registration is authenticated exactly like the FCM endpoints: the client signs
`interpoll-email-register-1:<userId>:<email>:<ts>` with the identity key, and
the relay verifies it against `userId`. Same 5-minute freshness window, same
replay guard, same per-IP limiter.

**When it fires.** `push.notifyChatMessage` mails the recipient only if the
user is not online *and* the FCM path delivered nothing — no tokens on file,
or every token came back dead. At most one mail per recipient per cooldown
window however many messages arrive.

**What the mail contains.** "You have a new message on InterPoll", a link to
the app, and the unsubscribe link. Not the message text (the relay cannot read
it), and not the sender's name — that would hand the social graph to Resend.

#### Privacy cost, stated plainly

This is the one feature that ties an InterPoll identity to a real-world
handle. The relay keeps the address in a plaintext JSON file (mode 0600)
keyed by public key, so a relay operator — or anyone who takes the box — can
deanonymise every user who opted in. That is why it is off by default, opt-in
per user, and labelled as such in Settings.

Addresses are **not** verified on registration. An attacker can only point
their own identity at someone else's inbox, and the cooldown caps that at a
few mails an hour, but every mail carries a signed one-click unsubscribe link
so the victim can cut it off without an account. Add a confirm-link flow if
that ceiling is too high for your deployment.

### 5. Turn it on in the app

The client path is behind a flag so a device with no Firebase config never
crashes on startup:

```js
localStorage.setItem('interpoll_push_enabled', 'true');
```

or call `setPushEnabled(true)` from `src/native/pushNotifications.ts`.

The email fallback has its own control in **Settings → Navigation &
notifications**: enter an address and hit Save. It is not behind the push flag
and needs no native platform, so the web build can use it on its own.

---

## What the push actually contains

Message bodies are end-to-end encrypted; the relay cannot read them. The push
carries the sender's display name and a generic body ("Sent you a message"),
plus `fromUserId` and the deep-link path. The real text appears once the app
opens and decrypts locally. That is deliberate — the alternative would mean
handing plaintext to the relay.

## Checking it works

1. `npm run cap:sync && npx cap open android`, run on a device.
2. Logcat should show `[Push] Device token acquired` and the relay should log a
   registration.
3. Swipe the app away, send yourself a DM from another account, confirm the
   tray notification and that tapping it opens the right chat.

For the email fallback, with no FCM token registered for the recipient:

1. Save an address in Settings; the relay should log nothing (registration is
   quiet) and `push-emails.json` should gain an entry keyed by your public key.
2. Send that identity a DM while it has no live socket. Resend's dashboard
   should show the send, and the relay logs `[Email] Resend send failed: …` if
   it did not.
3. Send a second DM inside the cooldown window and confirm *no* second mail.
4. Click the unsubscribe link and confirm the entry disappears from the store.
