import React from 'react';
import './Pill.css';

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional leading icon element. */
  icon?: React.ReactNode;
  /** Render as an active/selected pill. */
  active?: boolean;
}

/**
 * Rounded glass pill used for tags, filter chips, and metadata capsules
 * (e.g. community names, categories). Softer and more neutral than {@link Badge}.
 */
export const Pill: React.FC<PillProps> = ({ icon, active = false, className, children, ...rest }) => {
  const classes = ['ip-pill', active ? 'ip-pill--active' : '', className || '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} {...rest}>
      {icon && <span className="ip-pill__icon">{icon}</span>}
      {children}
    </span>
  );
};

export default Pill;
