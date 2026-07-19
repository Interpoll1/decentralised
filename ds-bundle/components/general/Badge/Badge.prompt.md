Badge from @interpoll/design-system. Use via `window.InterpollDS.Badge` (bundle loaded from the root `_ds_bundle.js`).

Compact status label used across InterPoll for verification state, poll status
("Ended"), identity trust level, and content flags. Tinted background with a
matching foreground color per semantic `tone`.

## Props

```ts
interface BadgeProps {
  /** Semantic color. */
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
  /** Optional leading dot indicator. */
  dot?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Tones

```jsx
() => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <Badge tone="accent">Poll</Badge>
    <Badge tone="success">Verified</Badge>
    <Badge tone="warning">Ending soon</Badge>
    <Badge tone="danger">Flagged</Badge>
    <Badge tone="neutral">Ended</Badge>
  </div>
)
```

### WithDot

```jsx
() => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Badge tone="success" dot>Live</Badge>
    <Badge tone="warning" dot>Syncing</Badge>
    <Badge tone="neutral" dot>Offline</Badge>
  </div>
)
```

### WithIcon

```jsx
() => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Badge tone="success" icon={<span aria-hidden>🛡️</span>}>128 verified</Badge>
    <Badge tone="accent" icon={<span aria-hidden>📊</span>}>Poll</Badge>
  </div>
)
```
