Avatar from @interpoll/design-system. Use via `window.InterpollDS.Avatar` (bundle loaded from the root `_ds_bundle.js`).

Identity avatar. Renders the user's image when available, otherwise a colored
disc with initials — the color is derived deterministically from the name, so
the same pseudonym always gets the same tint (matching InterPoll's pseudonym UI).

## Props

```ts
interface AvatarProps {
  /** Display name used for initials and the deterministic color. */
  name: string;
  /** Optional image URL; falls back to initials when absent or broken. */
  src?: string;
  /** Diameter preset. */
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Sizes

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Ada Lovelace" size="sm" />
    <Avatar name="Ada Lovelace" size="md" />
    <Avatar name="Ada Lovelace" size="lg" />
  </div>
)
```

### Pseudonyms

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="quiet-harbor-4821" />
    <Avatar name="brave-comet-77" />
    <Avatar name="u/silentvoter" />
    <Avatar name="Nakamoto" />
  </div>
)
```

### WithImage

```jsx
() => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Grace Hopper" src="https://i.pravatar.cc/80?img=5" size="lg" />
    <Avatar name="Broken Link" src="about:blank" size="lg" />
  </div>
)
```
