import React from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` is the accent-filled call to action. */
  variant?: ButtonVariant;
  /** Control height and padding. */
  size?: ButtonSize;
  /** Stretch to fill the container width. */
  block?: boolean;
  /** Show a spinner and disable interaction. */
  loading?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
}

/**
 * Primary action control for InterPoll. Accent-filled `primary`, translucent
 * glass `secondary`, borderless `ghost`, and a `danger` variant for destructive
 * actions. Matches the app's rounded, soft-shadow button language.
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  disabled,
  children,
  className,
  ...rest
}) => {
  const classes = [
    'ip-btn',
    `ip-btn--${variant}`,
    `ip-btn--${size}`,
    block ? 'ip-btn--block' : '',
    loading ? 'ip-btn--loading' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className="ip-btn__spinner" aria-hidden="true" />}
      {!loading && icon && <span className="ip-btn__icon">{icon}</span>}
      <span className="ip-btn__label">{children}</span>
    </button>
  );
};

export default Button;
