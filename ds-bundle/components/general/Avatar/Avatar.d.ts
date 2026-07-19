import * as React from 'react';

/**
 * Avatar — from @interpoll/design-system@0.1.0.
 */
export interface AvatarProps {
  /** Display name used for initials and the deterministic color. */
  name: string;
  /** Optional image URL; falls back to initials when absent or broken. */
  src?: string;
  /** Diameter preset. */
  size?: "sm" | "md" | "lg";
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Avatar: React.ComponentType<AvatarProps>;
