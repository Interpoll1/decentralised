# Interface language packs

English and Ukrainian are bundled with both the web build and Android APK. No
translation service or pack download is needed. Choose a language in Settings,
or on the welcome step before setup. The device language is used until an explicit
choice is saved. Unsupported device languages fall back to English. The choice is
device-local, survives reloads and synchronizes between tabs.

`src/i18n/locales/en.json` and `uk.json` use source-English interface copy as keys,
similar to gettext. This keeps the existing English wording reviewable. Only
explicit `$ui(...)` / `ui(...)` calls translate text. Do not apply them to posts,
poll questions/answers, usernames, community names, recovery words, identifiers,
signed records or arbitrary remote content. Technical diagnostics supplied by a
server may remain in their original language. Translation changes no network
protocol, authorization rule or cryptographic input.

Add a key to both catalogs, preserving `{p0}`, `{p1}`, etc. for dynamic messages.
Use `formatUi(source, { p0: value })` for these parameters; they remain literal
values. Messages render as text, not through `v-html`. `$count(value, 'vote')` and
the other registered count nouns use `Intl.PluralRules`; dates and relative times
use the chosen interface locale. Language names appear in their own language.

Run `npm run check:locales`, `npm test` and `npm run test:poll-first-use` after
editing a pack. CI checks key completeness and parameter parity. Browser coverage
includes live switching, persistence, automatic device-language selection, small
and landscape screens, original user content, and a real local vote/receipt in
Ukrainian. Run `npm run build` followed by `npm run test:production` to exercise
the emitted production chunks rather than only Vite's development modules. CI
runs both browser configurations. Native review builds also need an offline
language-switch/restart check.

Keep Vue's i18n dependencies in the framework chunk and let Rollup group unrelated
dependencies naturally. A catch-all miscellaneous vendor chunk introduced an
initialization cycle that compiled successfully but prevented the production app
from booting; the production smoke test rejects that earlier bundle. PWA launch
colors match graphite and its offline cache includes the bundled wordmark font.

To add a language, supply its complete catalog, register its BCP 47 language code
and native name in `src/i18n/index.ts`, update runtime preference validation and
device matching, add any required count forms/direction, and test longer labels.
An incomplete catalog can fall back to English but should not be advertised as a
complete language pack.
