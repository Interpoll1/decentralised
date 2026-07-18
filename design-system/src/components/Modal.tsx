import React from 'react';
import './Modal.css';

export interface ModalProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Whether the modal is visible. */
  open?: boolean;
  /** Heading text shown in the modal header. */
  title?: React.ReactNode;
  /** Footer content, typically action buttons. */
  footer?: React.ReactNode;
  /** Called when the backdrop or close button is activated. */
  onClose?: () => void;
}

/**
 * Centered dialog on a dimmed backdrop. The panel uses the InterPoll glass
 * surface with a header, scrollable body, and optional footer actions. Render it
 * with `open` and provide `onClose` for the backdrop / close affordance.
 */
export const Modal: React.FC<ModalProps> = ({
  open = true,
  title,
  footer,
  onClose,
  className,
  children,
  ...rest
}) => {
  if (!open) return null;
  return (
    <div className="ip-modal__backdrop" onClick={onClose}>
      <div
        className={['ip-modal', className || ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        {(title || onClose) && (
          <div className="ip-modal__header">
            <h2 className="ip-modal__title">{title}</h2>
            {onClose && (
              <button className="ip-modal__close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            )}
          </div>
        )}
        <div className="ip-modal__body">{children}</div>
        {footer && <div className="ip-modal__footer">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;
