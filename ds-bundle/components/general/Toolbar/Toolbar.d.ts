import * as React from 'react';

/**
 * Toolbar — from @interpoll/design-system@0.1.0.
 */
export interface ToolbarProps {
  /** Leading content (back button, menu, logo). */
  start?: React.ReactNode;
  /** Centered title. */
  title?: React.ReactNode;
  /** Trailing content (actions). */
  end?: React.ReactNode;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Toolbar: React.ComponentType<ToolbarProps>;
