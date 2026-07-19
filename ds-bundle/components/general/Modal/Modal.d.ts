import * as React from 'react';

/**
 * Modal — from @interpoll/design-system@0.1.0.
 * @replaces dialog
 */
export interface ModalProps {
  /** Whether the modal is visible. */
  open?: boolean;
  /** Heading text shown in the modal header. */
  title?: React.ReactNode;
  /** Footer content, typically action buttons. */
  footer?: React.ReactNode;
  /** Called when the backdrop or close button is activated. */
  onClose?: () => void;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

export declare const Modal: React.ComponentType<ModalProps>;
