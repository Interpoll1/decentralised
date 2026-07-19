import * as React from 'react';

/**
 * VoteForm — from @interpoll/design-system@0.1.0.
 */
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

export declare const VoteForm: React.ComponentType<VoteFormProps>;
