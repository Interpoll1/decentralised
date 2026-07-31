import React from 'react';
import './Toolbar.css';

export interface ToolbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Leading content (back button, menu, logo). */
  start?: React.ReactNode;
  /** Centered title. */
  title?: React.ReactNode;
  /** Trailing content (actions). */
  end?: React.ReactNode;
}

/**
 * The frosted top app bar. A blurred, translucent toolbar with a hairline bottom
 * border — the sticky header used across InterPoll pages. Provide `start`, `title`,
 * and `end` slots, or arbitrary children.
 */
export const Toolbar: React.FC<ToolbarProps> = ({ start, title, end, className, children, ...rest }) => {
  const classes = ['ip-toolbar', className || ''].filter(Boolean).join(' ');
  if (children) {
    return (
      <div className={classes} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div className={classes} {...rest}>
      <div className="ip-toolbar__start">{start}</div>
      {title && <div className="ip-toolbar__title">{title}</div>}
      <div className="ip-toolbar__end">{end}</div>
    </div>
  );
};

export default Toolbar;
