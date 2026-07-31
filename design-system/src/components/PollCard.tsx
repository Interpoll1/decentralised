import React from 'react';
import { Card } from './Card';
import { Badge } from './Badge';
import './PollCard.css';

export interface PollOption {
  id?: string;
  /** Option label. */
  text: string;
  /** Vote count for this option. */
  votes: number;
}

export interface PollCardProps {
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

const iconStats = '📊';
const iconPeople = '👥';
const iconShield = '🛡️';
const iconTime = '⏳';

/**
 * The primary feed unit: a poll rendered on the glass {@link Card}. Shows the
 * author/identity header, question, up to three options with animated result
 * bars, and a footer of vote/verification/time stats. The signature InterPoll
 * composite — everything a voter sees before opening a poll.
 */
export const PollCard: React.FC<PollCardProps> = ({
  question,
  description,
  options,
  author = 'anon',
  timeAgo,
  timeRemaining,
  verifiedCount = 0,
  ended = false,
  onClick,
}) => {
  const total = options.reduce((sum, o) => sum + (o.votes || 0), 0);
  const shown = options.slice(0, 3);
  const percent = (o: PollOption) => (total > 0 ? Math.round(((o.votes || 0) / total) * 100) : 0);

  return (
    <Card interactive padding="none" className="ip-pollcard" onClick={onClick}>
      <div className="ip-pollcard__body">
        <div className="ip-pollcard__header">
          <Badge tone="accent" icon={<span aria-hidden>{iconStats}</span>}>
            Poll
          </Badge>
          <div className="ip-pollcard__meta">
            <span className="ip-pollcard__author">u/{author}</span>
            {timeAgo && (
              <>
                <span className="ip-pollcard__dot">•</span>
                <span>{timeAgo}</span>
              </>
            )}
            {ended && (
              <Badge tone="neutral" className="ip-pollcard__ended">
                Ended
              </Badge>
            )}
          </div>
        </div>

        <h3 className="ip-pollcard__question">{question || 'Untitled Poll'}</h3>
        {description && <p className="ip-pollcard__description">{description}</p>}

        <div className="ip-pollcard__options">
          {shown.map((option, i) => (
            <div className="ip-pollcard__option" key={option.id || i}>
              <div className="ip-pollcard__bar">
                <div className="ip-pollcard__fill" style={{ width: `${percent(option)}%` }} />
              </div>
              <div className="ip-pollcard__option-info">
                <span className="ip-pollcard__option-text">{option.text || `Option ${i + 1}`}</span>
                <span className="ip-pollcard__option-votes">{percent(option)}%</span>
              </div>
            </div>
          ))}
          {options.length > 3 && (
            <div className="ip-pollcard__more">
              +{options.length - 3} more option{options.length - 3 !== 1 ? 's' : ''}
            </div>
          )}
        </div>

        <div className="ip-pollcard__footer">
          <span className="ip-pollcard__stat">
            <span aria-hidden>{iconPeople}</span> {total} vote{total !== 1 ? 's' : ''}
          </span>
          {verifiedCount > 0 && (
            <span className="ip-pollcard__stat ip-pollcard__stat--verified">
              <span aria-hidden>{iconShield}</span> {verifiedCount} verified
            </span>
          )}
          {timeRemaining && (
            <span className="ip-pollcard__stat">
              <span aria-hidden>{iconTime}</span> {timeRemaining}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
};

export default PollCard;
