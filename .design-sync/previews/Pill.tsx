import React from 'react';
import { Pill } from '@interpoll/design-system';

export const Tags = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
    <Pill>Governance</Pill>
    <Pill>Privacy</Pill>
    <Pill icon={<span aria-hidden>#</span>}>crypto</Pill>
    <Pill icon={<span aria-hidden>🔒</span>}>Private</Pill>
  </div>
);

export const FilterChips = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Pill active>All</Pill>
    <Pill>Trending</Pill>
    <Pill>Ending soon</Pill>
    <Pill>My votes</Pill>
  </div>
);
