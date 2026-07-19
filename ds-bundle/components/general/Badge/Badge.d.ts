import * as React from 'react';

/**
 * Badge — from @interpoll/design-system@0.1.0.
 */
export interface BadgeProps {
  /** Semantic color. */
  tone?: "accent" | "success" | "warning" | "danger" | "neutral";
  /** Optional leading dot indicator. */
  dot?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Badge: React.ComponentType<BadgeProps>;
