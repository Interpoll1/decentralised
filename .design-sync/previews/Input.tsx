import React from 'react';
import { Input } from '@interpoll/design-system';

export const Basic = () => (
  <div style={{ width: 320 }}>
    <Input label="Poll question" placeholder="What should we build next?" />
  </div>
);

export const WithIconAndHint = () => (
  <div style={{ width: 320 }}>
    <Input
      label="Invite code"
      placeholder="Paste your single-use code"
      icon={<span aria-hidden>🔑</span>}
      hint="Codes are consumed atomically and can be used once."
    />
  </div>
);

export const Invalid = () => (
  <div style={{ width: 320 }}>
    <Input
      label="Relay URL"
      defaultValue="ws://broken"
      invalid
      hint="Relay must be a reachable wss:// endpoint."
    />
  </div>
);
