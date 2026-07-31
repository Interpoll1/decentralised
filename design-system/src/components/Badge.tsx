import React from 'react';
import './Badge.css';

export type BadgeTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic color. */
  tone?: BadgeTone;
  /** Optional leading dot indicator. */
  dot?: boolean;
  /** Optional leading icon element. */
  icon?: React.ReactNode;
}

/**
 * Compact status label used across InterPoll for verification state, poll status
 * ("Ended"), identity trust level, and content flags. Tinted background with a
 * matching foreground color per semantic `tone`.
 */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  dot = false,
  icon,
  className,
  children,
  ...rest
}) => {
  const classes = ['ip-badge', `ip-badge--${tone}`, className || ''].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      {dot && <span className="ip-badge__dot" aria-hidden="true" />}
      {icon && <span className="ip-badge__icon">{icon}</span>}
      {children}
    </span>
  );
};

export default Badge;
