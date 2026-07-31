import React from 'react';
import { Button } from '@interpoll/design-system';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
    <Button variant="primary">Cast Vote</Button>
    <Button variant="secondary">Share Poll</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Delete</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
);

export const States = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Button loading>Submitting</Button>
    <Button disabled>Disabled</Button>
    <Button icon={<span aria-hidden>＋</span>}>New Poll</Button>
  </div>
);

export const FullWidth = () => (
  <div style={{ width: 320 }}>
    <Button block>Cast Vote</Button>
  </div>
);
