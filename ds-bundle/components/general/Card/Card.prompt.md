Card from @interpoll/design-system. Use via `window.InterpollDS.Card` (bundle loaded from the root `_ds_bundle.js`).

The InterPoll glass surface. A translucent, blurred panel with a soft layered
shadow and hairline border — the container every poll, post, and panel sits on.
Set `interactive` for clickable cards that lift on hover.

## Props

```ts
interface CardProps {
  /** Add hover lift + border emphasis for clickable cards. */
  interactive?: boolean;
  /** Inner padding preset. */
  padding?: "sm" | "md" | "lg" | "none";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Basic

```jsx
() => (
  <div style={{ width: 340 }}>
    <Card>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Community guidelines</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        Every poll and vote is cryptographically signed and replicated across peers — no single
        server can forge or silently drop your ballot.
      </p>
    </Card>
  </div>
)
```

### Interactive

```jsx
() => (
  <div style={{ width: 340 }}>
    <Card interactive>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>r/decentralization</h3>
      <p style={{ margin: 0, fontSize: 14 }}>1,204 members · 38 active polls</p>
    </Card>
  </div>
)
```

### Padding

```jsx
() => (
  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
    <Card padding="sm" style={{ width: 150 }}>Compact</Card>
    <Card padding="lg" style={{ width: 150 }}>Roomy</Card>
  </div>
)
```
