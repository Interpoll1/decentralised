import React from 'react';
import { Modal, Button } from '@interpoll/design-system';

export const Dialog = () => (
  <div style={{ position: 'relative', width: 560, height: 380 }}>
    <Modal
      open
      title="Confirm your vote"
      footer={
        <>
          <Button variant="ghost">Cancel</Button>
          <Button>Cast Vote</Button>
        </>
      }
    >
      You're voting <strong>“Ship the mobile app first”</strong>. Your device fingerprint will be
      recorded and you'll receive a 12-word verification code. This cannot be undone.
    </Modal>
  </div>
);
