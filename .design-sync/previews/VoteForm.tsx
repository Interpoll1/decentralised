import React from 'react';
import { VoteForm } from '@interpoll/design-system';

export const Ballot = () => (
  <VoteForm
    title="What should we build next?"
    description="One vote per device. Choose the initiative you want prioritized."
    options={[
      { id: 'a', text: 'Ship the mobile app first' },
      { id: 'b', text: 'Improve relay reliability' },
      { id: 'c', text: 'Add threaded discussions' },
    ]}
  />
);

export const Submitting = () => (
  <VoteForm
    title="What should we build next?"
    submitting
    options={[
      { id: 'a', text: 'Ship the mobile app first' },
      { id: 'b', text: 'Improve relay reliability' },
    ]}
  />
);

export const AlreadyVoted = () => (
  <VoteForm title="What should we build next?" alreadyVoted options={[]} />
);
