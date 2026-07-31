import React from 'react';
import './Avatar.css';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name used for initials and the deterministic color. */
  name: string;
  /** Optional image URL; falls back to initials when absent or broken. */
  src?: string;
  /** Diameter preset. */
  size?: AvatarSize;
}

const PALETTE = ['#5e6ad2', '#8b5cf6', '#7c8cff', '#34d399', '#fbbf24', '#f87171', '#22d3ee'];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  const parts = name.replace(/^u\//, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Identity avatar. Renders the user's image when available, otherwise a colored
 * disc with initials — the color is derived deterministically from the name, so
 * the same pseudonym always gets the same tint (matching InterPoll's pseudonym UI).
 */
export const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'md', className, style, ...rest }) => {
  const color = PALETTE[hashName(name) % PALETTE.length];
  const classes = ['ip-avatar', `ip-avatar--${size}`, className || ''].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      style={{ '--ip-avatar-color': color, ...style } as React.CSSProperties}
      title={name}
      {...rest}
    >
      {src ? <img className="ip-avatar__img" src={src} alt={name} /> : initials(name)}
    </span>
  );
};

export default Avatar;
