import * as React from 'react';

/**
 * Pill — from @interpoll/design-system@0.1.0.
 */
export interface PillProps {
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  /** Render as an active/selected pill. */
  active?: boolean;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Pill: React.ComponentType<PillProps>;
