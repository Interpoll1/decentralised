# InterPoll Design System — how to build with it

A Linear-style **glass UI**: an indigo accent (`#5e6ad2`), translucent blurred
surfaces, hairline borders, soft layered shadows, and the Inter typeface. Ten
React components extracted from the InterPoll decentralized polling app.

## Setup — tokens load themselves, no provider needed

Every component is self-styled. Import the stylesheet once and the tokens apply
globally from `:root`; there is **no theme provider to wrap**. Components read
their colors, radii, shadows, and blur from CSS custom properties.

```jsx
import { PollCard, Button } from '@interpoll/design-system';
// styles.css (the bound copy) is loaded for you; it defines the tokens + component CSS.

<PollCard question="What next?" options={[{ text: 'A', votes: 3 }]} />
```

**Dark mode**: add `class="dark"` or `data-theme="dark"` to any ancestor
(`<html>` or a wrapper). All tokens flip to the pure-black glass theme. Light is
the default on `:root`.

## Styling idiom — compose components, don't reach for classes

There is **no utility-class framework** here (no Tailwind vocabulary to use).
Style in this order:

1. **Props first.** Components carry their own design language through props —
   `variant` / `size` / `block` on `Button`; `tone` / `dot` on `Badge`;
   `interactive` / `padding` on `Card`; `invalid` / `icon` on `Input`. Prefer a
   prop over any custom CSS.
2. **Layout glue with the tokens.** For your own wrappers, use the design
   tokens so spacing and color stay on-brand. Real token names (all defined in
   the bound `styles.css`):
   - Color: `--app-accent` `#5e6ad2`, `--app-text`, `--app-text-muted`,
     `--app-surface`, `--app-border`, `--app-success`, `--app-warning`,
     `--app-danger`. RGB triples for alpha: `rgba(var(--app-accent-rgb), .12)`.
   - Radius: `--app-radius-lg` (16px), `--app-radius-md` (12px), `--app-radius-sm` (10px).
   - Shadow: `--app-shadow-sm|md|lg`, `--app-shadow-inset`, `--app-focus-ring`.
   - Motion: `--app-transition` (240ms spring easing). Font: `--ip-font-sans`.

```jsx
<div style={{ display: 'grid', gap: 16, color: 'var(--app-text)' }}>
  <PollCard {...poll} />
  <div style={{
    padding: 20,
    borderRadius: 'var(--app-radius-lg)',
    background: 'var(--app-surface)',
    border: '1px solid var(--app-border)',
    boxShadow: 'var(--app-shadow-md)',
  }}>
    Custom panel that matches the DS glass surface.
  </div>
</div>
```

Reuse the glass surface via the `Card` component rather than re-deriving it, and
build ballots/feeds from the `PollCard` and `VoteForm` composites instead of
assembling raw markup.

## Where the truth lives

- **`_ds/<folder>/styles.css`** (the bound stylesheet) — every token value and
  component class. Read it before writing any custom CSS.
- **`components/<group>/<Name>/<Name>.d.ts`** — the exact prop contract per
  component. **`.prompt.md`** next to it — usage notes and examples.

## Components

`Button`, `Card`, `Badge`, `Pill`, `Input`, `Avatar`, `Toolbar`, `Modal`
(primitives) and `PollCard`, `VoteForm` (the signature poll composites).
