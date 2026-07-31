import React, { useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import './VoteForm.css';

export interface VoteFormOption {
  id?: string;
  /** Option label shown next to the radio. */
  text: string;
}

export interface VoteFormProps {
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

/**
 * The ballot. A glass {@link Card} with radio options, a one-vote-per-device
 * notice, and a full-width "Cast Vote" action. Renders the "already voted" state
 * when the device has a recorded vote. The second signature InterPoll composite.
 */
export const VoteForm: React.FC<VoteFormProps> = ({
  title,
  description,
  options,
  alreadyVoted = false,
  submitting = false,
  onSubmit,
}) => {
  const [selected, setSelected] = useState<string>('');

  if (alreadyVoted) {
    return (
      <Card padding="lg" className="ip-voteform ip-voteform--voted">
        <div className="ip-voteform__voted-badge" aria-hidden>
          ⚠︎
        </div>
        <div>
          <h3 className="ip-voteform__voted-title">Already Voted</h3>
          <p className="ip-voteform__voted-text">
            You've already voted on this poll from this device. Each device can only vote once to
            ensure fair results.
          </p>
          <Button variant="secondary" size="sm" className="ip-voteform__voted-action">
            View My Receipt
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="lg" className="ip-voteform">
      <h3 className="ip-voteform__title">{title}</h3>
      {description && <p className="ip-voteform__description">{description}</p>}

      <div className="ip-voteform__options" role="radiogroup" aria-label={title}>
        {options.map((option, i) => {
          const value = option.id || option.text;
          const active = selected === value;
          return (
            <label
              key={value}
              className={['ip-voteform__option', active ? 'ip-voteform__option--active' : ''].join(' ')}
            >
              <input
                type="radio"
                name="ip-vote"
                value={value}
                checked={active}
                onChange={() => setSelected(value)}
                className="ip-voteform__radio"
              />
              <span className="ip-voteform__radio-dot" aria-hidden />
              <span className="ip-voteform__option-text">{option.text || `Option ${i + 1}`}</span>
            </label>
          );
        })}
      </div>

      <p className="ip-voteform__notice">
        <strong>One vote per device.</strong> Your device fingerprint is recorded to prevent
        duplicates. You'll receive a 12-word verification code to verify your vote later.
      </p>

      <Button
        block
        loading={submitting}
        disabled={!selected}
        onClick={() => selected && onSubmit?.(selected)}
        className="ip-voteform__submit"
      >
        {submitting ? 'Submitting…' : 'Cast Vote'}
      </Button>
    </Card>
  );
};

export default VoteForm;
