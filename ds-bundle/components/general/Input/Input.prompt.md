Input from @interpoll/design-system. Use via `window.InterpollDS.Input` (bundle loaded from the root `_ds_bundle.js`).

Text input styled as an InterPoll glass field: translucent item surface,
hairline border, and an accent focus ring. Supports an optional label, leading
icon, and hint/error text.

## Props

```ts
interface InputProps {
  /** Field label rendered above the control. */
  label?: string;
  /** Helper or error text rendered below the control. */
  hint?: string;
  /** Render in an error state (red focus ring + hint color). */
  invalid?: boolean;
  /** Optional leading icon inside the field. */
  icon?: React.ReactNode;
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
  <div style={{ width: 320 }}>
    <Input label="Poll question" placeholder="What should we build next?" />
  </div>
)
```

### WithIconAndHint

```jsx
() => (
  <div style={{ width: 320 }}>
    <Input
      label="Invite code"
      placeholder="Paste your single-use code"
      icon={<span aria-hidden>🔑</span>}
      hint="Codes are consumed atomically and can be used once."
    />
  </div>
)
```

### Invalid

```jsx
() => (
  <div style={{ width: 320 }}>
    <Input
      label="Relay URL"
      defaultValue="ws://broken"
      invalid
      hint="Relay must be a reachable wss:// endpoint."
    />
  </div>
)
```
