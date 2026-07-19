Button from @interpoll/design-system. Use via `window.InterpollDS.Button` (bundle loaded from the root `_ds_bundle.js`).

Primary action control for InterPoll. Accent-filled `primary`, translucent
glass `secondary`, borderless `ghost`, and a `danger` variant for destructive
actions. Matches the app's rounded, soft-shadow button language.

## Props

```ts
interface ButtonProps {
  /** Visual style. `primary` is the accent-filled call to action. */
  variant?: "danger" | "primary" | "secondary" | "ghost";
  /** Control height and padding. */
  size?: "sm" | "md" | "lg";
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Variants

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button variant="primary">Cast Vote</Button>
    <Button variant="secondary">Share Poll</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Delete</Button>
  </div>
)
```

### Sizes

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
)
```

### States

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button loading>Submitting</Button>
    <Button disabled>Disabled</Button>
    <Button icon={<span aria-hidden>＋</span>}>New Poll</Button>
  </div>
)
```

### FullWidth

```jsx
() => (
  <div style={{ width: 320 }}>
    <Button block>Cast Vote</Button>
  </div>
)
```
