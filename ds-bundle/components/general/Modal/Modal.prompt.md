Modal from @interpoll/design-system. Use via `window.InterpollDS.Modal` (bundle loaded from the root `_ds_bundle.js`).

Centered dialog on a dimmed backdrop. The panel uses the InterPoll glass
surface with a header, scrollable body, and optional footer actions. Render it
with `open` and provide `onClose` for the backdrop / close affordance.

## Props

```ts
interface ModalProps {
  /** Whether the modal is visible. */
  open?: boolean;
  /** Heading text shown in the modal header. */
  title?: React.ReactNode;
  /** Footer content, typically action buttons. */
  footer?: React.ReactNode;
  /** Called when the backdrop or close button is activated. */
  onClose?: () => void;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
```

## Examples

### Dialog

```jsx
() => (
  <div style={{ position: 'relative', width: 560, height: 380 }}>
    <Modal
      open
      title="Confirm your vote"
      footer={
        <>
          <Button variant="ghost">Cancel</Button>
          <Button>Cast Vote</Button>
        </>
      }
    >
      You're voting <strong>“Ship the mobile app first”</strong>. Your device fingerprint will be
      recorded and you'll receive a 12-word verification code. This cannot be undone.
    </Modal>
  </div>
)
```
