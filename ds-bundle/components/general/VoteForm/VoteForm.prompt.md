VoteForm from @interpoll/design-system. Use via `window.InterpollDS.VoteForm` (bundle loaded from the root `_ds_bundle.js`).

The ballot. A glass {@link Card} with radio options, a one-vote-per-device
notice, and a full-width "Cast Vote" action. Renders the "already voted" state
when the device has a recorded vote. The second signature InterPoll composite.

## Props

```ts
interface VoteFormProps {
  /** Poll title shown above the options. */
  title: string;
  /** Optional subtitle / description. */
  description?: string;
  /** Selectable options. */
  options: VoteFormOption[];
  /** When true, shows the "already voted from this device" state instead. */
  alreadyVoted?: boolean;
  /** Disables the submit button and shows a spinner. */
  submitting?: boolean;
  /** Called with the chosen option's id (or text when no id) on submit. */
  onSubmit?: (value: string) => void;
}
```

## Examples

### Ballot

```jsx
() => (
  <VoteForm
    title="What should we build next?"
    description="One vote per device. Choose the initiative you want prioritized."
    options={[
      { id: 'a', text: 'Ship the mobile app first' },
      { id: 'b', text: 'Improve relay reliability' },
      { id: 'c', text: 'Add threaded discussions' },
    ]}
  />
)
```

### Submitting

```jsx
() => (
  <VoteForm
    title="What should we build next?"
    submitting
    options={[
      { id: 'a', text: 'Ship the mobile app first' },
      { id: 'b', text: 'Improve relay reliability' },
    ]}
  />
)
```

### AlreadyVoted

```jsx
() => (
  <VoteForm title="What should we build next?" alreadyVoted options={[]} />
)
```
