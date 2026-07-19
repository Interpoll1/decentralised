PollCard from @interpoll/design-system. Use via `window.InterpollDS.PollCard` (bundle loaded from the root `_ds_bundle.js`).

The primary feed unit: a poll rendered on the glass {@link Card}. Shows the
author/identity header, question, up to three options with animated result
bars, and a footer of vote/verification/time stats. The signature InterPoll
composite — everything a voter sees before opening a poll.

## Props

```ts
interface PollCardProps {
  /** The poll question / title. */
  question: string;
  /** Optional longer description shown under the question. */
  description?: string;
  /** Poll options; the top 3 are shown with result bars. */
  options: PollOption[];
  /** Author display name (without the leading `u/`). */
  author?: string;
  /** Relative time label, e.g. "2h ago". */
  timeAgo?: string;
  /** Time-remaining label, e.g. "3 days left". */
  timeRemaining?: string;
  /** Number of votes cryptographically verified from signed events. */
  verifiedCount?: number;
  /** Marks the poll as closed. */
  ended?: boolean;
  /** Click handler for the whole card. */
  onClick?: () => void;
}
```

## Examples

### Active

```jsx
() => (
  <PollCard
    author="quiet-harbor-4821"
    timeAgo="2h ago"
    timeRemaining="3 days left"
    verifiedCount={128}
    question="What should the DAO fund next quarter?"
    description="Non-binding signal vote. Results are cryptographically verifiable in the chain explorer."
    options={[
      { id: 'a', text: 'Mobile app', votes: 342 },
      { id: 'b', text: 'Relay incentives', votes: 289 },
      { id: 'c', text: 'Moderation tooling', votes: 96 },
      { id: 'd', text: 'Docs & onboarding', votes: 51 },
    ]}
  />
)
```

### Ended

```jsx
() => (
  <PollCard
    author="brave-comet-77"
    timeAgo="6 days ago"
    ended
    verifiedCount={54}
    question="Should we raise the invite-code expiry to 30 days?"
    options={[
      { id: 'y', text: 'Yes', votes: 210 },
      { id: 'n', text: 'No', votes: 88 },
    ]}
  />
)
```
