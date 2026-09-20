# Chat notifications

Two layers, shipped together.

| Layer | Works when | Needs |
|-------|-----------|-------|
| **Local** — `src/services/notificationService.ts` | App process alive (foreground, or backgrounded but not swiped away) | Nothing. Already on. |
| **Remote push (FCM)** — `src/native/pushNotifications.ts` + `relay-push/push-notifications.js` | Always, including app killed | Firebase project + relay wiring, below |

Both deep-link through the same `data.path`, so a tap lands on `/chat/<peerId>` either way.

**Resend is not involved.** Resend sends email; it cannot deliver an Android
notification. No API key needed from you for this.

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

### 4. Turn it on in the app

The client path is behind a flag so a device with no Firebase config never
crashes on startup:

```js
localStorage.setItem('interpoll_push_enabled', 'true');
```

or call `setPushEnabled(true)` from `src/native/pushNotifications.ts`.

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
