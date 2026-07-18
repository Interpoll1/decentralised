import React from 'react';
import { Badge } from '@interpoll/design-system';

export const Tones = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
    <Badge tone="accent">Poll</Badge>
    <Badge tone="success">Verified</Badge>
    <Badge tone="warning">Ending soon</Badge>
    <Badge tone="danger">Flagged</Badge>
    <Badge tone="neutral">Ended</Badge>
  </div>
);

export const WithDot = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Badge tone="success" dot>Live</Badge>
    <Badge tone="warning" dot>Syncing</Badge>
    <Badge tone="neutral" dot>Offline</Badge>
  </div>
);

export const WithIcon = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Badge tone="success" icon={<span aria-hidden>🛡️</span>}>128 verified</Badge>
    <Badge tone="accent" icon={<span aria-hidden>📊</span>}>Poll</Badge>
  </div>
);
