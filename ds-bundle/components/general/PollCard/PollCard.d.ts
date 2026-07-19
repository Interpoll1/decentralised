import * as React from 'react';

/**
 * PollCard — from @interpoll/design-system@0.1.0.
 */
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

export declare const PollCard: React.ComponentType<PollCardProps>;
