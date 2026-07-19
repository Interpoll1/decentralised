Pill from @interpoll/design-system. Use via `window.InterpollDS.Pill` (bundle loaded from the root `_ds_bundle.js`).

Rounded glass pill used for tags, filter chips, and metadata capsules
(e.g. community names, categories). Softer and more neutral than {@link Badge}.

## Props

```ts
interface PillProps {
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  /** Render as an active/selected pill. */
  active?: boolean;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Tags

```jsx
() => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Pill>Governance</Pill>
    <Pill>Privacy</Pill>
    <Pill icon={<span aria-hidden>#</span>}>crypto</Pill>
    <Pill icon={<span aria-hidden>🔒</span>}>Private</Pill>
  </div>
)
```

### FilterChips

```jsx
() => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Pill active>All</Pill>
    <Pill>Trending</Pill>
    <Pill>Ending soon</Pill>
    <Pill>My votes</Pill>
  </div>
)
```
