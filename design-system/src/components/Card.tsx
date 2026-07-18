import React from 'react';
import './Card.css';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add hover lift + border emphasis for clickable cards. */
  interactive?: boolean;
  /** Inner padding preset. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * The InterPoll glass surface. A translucent, blurred panel with a soft layered
 * shadow and hairline border — the container every poll, post, and panel sits on.
 * Set `interactive` for clickable cards that lift on hover.
 */
export const Card: React.FC<CardProps> = ({
  interactive = false,
  padding = 'md',
  className,
  children,
  ...rest
}) => {
  const classes = [
    'ip-card',
    interactive ? 'ip-card--interactive' : '',
    `ip-card--pad-${padding}`,
    className || '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
};

export default Card;
