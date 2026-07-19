import * as React from 'react';

/**
 * Input — from @interpoll/design-system@0.1.0.
 * @replaces input
 */
export interface InputProps {
  /** Field label rendered above the control. */
  label?: string;
  /** Helper or error text rendered below the control. */
  hint?: string;
  /** Render in an error state (red focus ring + hint color). */
  invalid?: boolean;
  /** Optional leading icon inside the field. */
  icon?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Input: React.ComponentType<InputProps>;
