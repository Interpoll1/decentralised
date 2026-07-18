import React from 'react';
import { Toolbar, Button, Badge, Avatar } from '@interpoll/design-system';

export const AppBar = () => (
  <div style={{ width: 460 }}>
    <Toolbar
      start={<strong style={{ fontSize: 15 }}>InterPoll</strong>}
      title="Home"
      end={
        <>
          <Badge tone="success" dot>Synced</Badge>
          <Avatar name="quiet-harbor-4821" size="sm" />
        </>
      }
    />
  </div>
);

export const WithActions = () => (
  <div style={{ width: 460 }}>
    <Toolbar
      start={<Button variant="ghost" size="sm">← Back</Button>}
      title="Create Poll"
      end={<Button size="sm">Publish</Button>}
    />
  </div>
);
