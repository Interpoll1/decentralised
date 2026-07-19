Toolbar from @interpoll/design-system. Use via `window.InterpollDS.Toolbar` (bundle loaded from the root `_ds_bundle.js`).

The frosted top app bar. A blurred, translucent toolbar with a hairline bottom
border — the sticky header used across InterPoll pages. Provide `start`, `title`,
and `end` slots, or arbitrary children.

## Props

```ts
interface ToolbarProps {
  /** Leading content (back button, menu, logo). */
  start?: React.ReactNode;
  /** Centered title. */
  title?: React.ReactNode;
  /** Trailing content (actions). */
  end?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### AppBar

```jsx
() => (
  <div style={{ width: 460 }}>
    <Toolbar
      start={<strong style={{ fontSize: 15 }}>InterPoll</strong>}
      title="Home"
      end={
        <>
          <Badge tone="success" dot>Synced</Badge>
          <Avatar name="quiet-harbor-4821" size="sm" />
        </>
      }
    />
  </div>
)
```

### WithActions

```jsx
() => (
  <div style={{ width: 460 }}>
    <Toolbar
      start={<Button variant="ghost" size="sm">← Back</Button>}
      title="Create Poll"
      end={<Button size="sm">Publish</Button>}
    />
  </div>
)
```
