import * as React from 'react';

/**
 * Card — from @interpoll/design-system@0.1.0.
 */
export interface CardProps {
  /** Add hover lift + border emphasis for clickable cards. */
  interactive?: boolean;
  /** Inner padding preset. */
  padding?: "sm" | "md" | "lg" | "none";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Card: React.ComponentType<CardProps>;
