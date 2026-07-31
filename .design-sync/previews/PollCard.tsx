import React from 'react';
import { PollCard } from '@interpoll/design-system';

export const Active = () => (
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
);

export const Ended = () => (
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
);
