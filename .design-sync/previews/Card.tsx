import React from 'react';
import { Card } from '@interpoll/design-system';

export const Basic = () => (
  <div style={{ width: 340 }}>
    <Card>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>Community guidelines</h3>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        Every poll and vote is cryptographically signed and replicated across peers — no single
        server can forge or silently drop your ballot.
      </p>
    </Card>
  </div>
);

export const Interactive = () => (
  <div style={{ width: 340 }}>
    <Card interactive>
      <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>r/decentralization</h3>
      <p style={{ margin: 0, fontSize: 14 }}>1,204 members · 38 active polls</p>
    </Card>
  </div>
);

export const Padding = () => (
  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
    <Card padding="sm" style={{ width: 150 }}>Compact</Card>
    <Card padding="lg" style={{ width: 150 }}>Roomy</Card>
  </div>
);
