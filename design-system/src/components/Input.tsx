import React from 'react';
import './Input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the control. */
  label?: string;
  /** Helper or error text rendered below the control. */
  hint?: string;
  /** Render in an error state (red focus ring + hint color). */
  invalid?: boolean;
  /** Optional leading icon inside the field. */
  icon?: React.ReactNode;
}

/**
 * Text input styled as an InterPoll glass field: translucent item surface,
 * hairline border, and an accent focus ring. Supports an optional label, leading
 * icon, and hint/error text.
 */
export const Input: React.FC<InputProps> = ({
  label,
  hint,
  invalid = false,
  icon,
  className,
  id,
  ...rest
}) => {
  const fieldId = id || (label ? `ip-input-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div className={['ip-field', invalid ? 'ip-field--invalid' : '', className || ''].filter(Boolean).join(' ')}>
      {label && (
        <label className="ip-field__label" htmlFor={fieldId}>
          {label}
        </label>
      )}
      <div className="ip-field__control">
        {icon && <span className="ip-field__icon">{icon}</span>}
        <input id={fieldId} className="ip-field__input" aria-invalid={invalid} {...rest} />
      </div>
      {hint && <span className="ip-field__hint">{hint}</span>}
    </div>
  );
};

export default Input;
