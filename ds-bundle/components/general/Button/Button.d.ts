import * as React from 'react';

/**
 * Button — from @interpoll/design-system@0.1.0.
 * @replaces button
 */
export interface ButtonProps {
  /** Visual style. `primary` is the accent-filled call to action. */
  variant?: "danger" | "primary" | "secondary" | "ghost";
  /** Control height and padding. */
  size?: "sm" | "md" | "lg";
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Button: React.ComponentType<ButtonProps>;
