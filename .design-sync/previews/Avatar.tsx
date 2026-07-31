import React from 'react';
import { Avatar } from '@interpoll/design-system';

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Ada Lovelace" size="sm" />
    <Avatar name="Ada Lovelace" size="md" />
    <Avatar name="Ada Lovelace" size="lg" />
  </div>
);

export const Pseudonyms = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="quiet-harbor-4821" />
    <Avatar name="brave-comet-77" />
    <Avatar name="u/silentvoter" />
    <Avatar name="Nakamoto" />
  </div>
);

export const WithImage = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Avatar name="Grace Hopper" src="https://i.pravatar.cc/80?img=5" size="lg" />
    <Avatar name="Broken Link" src="about:blank" size="lg" />
  </div>
);
