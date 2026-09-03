/**
 * chatMediaService.ts — Relay-routed ephemeral media for DMs
 *
 * Flow:
 *   1. Sender encrypts the file bytes with a fresh AES-256-GCM key (mediaKey).
 *   2. Ciphertext is uploaded to relay POST /api/chat-media (returns a mediaId).
 *   3. mediaKey + mediaId are embedded in a normal Signal-encrypted chat message.
 *   4. Recipient decrypts the chat message, extracts mediaId + mediaKey,
 *      fetches GET /api/chat-media/:id, decrypts locally, renders inline.
 *   5. Once the recipient has ACK'd (sent a read-receipt), relay deletes the blob.
 *   6. Client also calls DELETE /api/chat-media/:id after first successful render.
 *
 * Backend never sees plaintext. The mediaKey travels inside the Signal envelope.
 * Max relay retention: 7 days (TTL enforced by the relay).
 */

import config from '../config';

const RELAY_BASE = (() => {
  const ws = config.relay.websocket;
  return ws.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
})();

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

export interface MediaMeta {
  mediaId:   string;  // relay-assigned UUID
  mediaKey:  string;  // base64 AES-256-GCM key
  mediaIV:   string;  // base64 IV
  mediaType: string;  // MIME type (image/jpeg, video/mp4, …)
  mediaSize: number;  // original byte length
  mediaName: string;  // original file name
}

/** Encrypt a File, upload ciphertext to relay, return meta for embedding in message. */
export async function encryptAndUpload(file: File, authToken: string): Promise<MediaMeta> {
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error(`File too large — maximum ${MAX_MEDIA_BYTES / 1024 / 1024} MB`);
  }

  // 1. Generate fresh AES-256-GCM key + IV
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // 2. Encrypt
  const plaintext  = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plaintext);

  // 3. Upload ciphertext blob to relay
  const formData = new FormData();
  formData.append('blob', new Blob([ciphertext], { type: 'application/octet-stream' }));
  formData.append('mimeType', file.type);
  formData.append('size', String(file.size));

  const res = await fetch(`${RELAY_BASE}/api/chat-media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Media upload failed: ${res.status}`);
  const { mediaId } = await res.json();

  return {
    mediaId,
    mediaKey:  btoa(String.fromCharCode(...rawKey)),
    mediaIV:   btoa(String.fromCharCode(...iv)),
    mediaType: file.type,
    mediaSize: file.size,
    mediaName: file.name,
  };
}

/** Download and decrypt media, returning an object URL. Deletes from relay after. */
export async function fetchAndDecrypt(meta: MediaMeta, authToken: string): Promise<string> {
  const res = await fetch(`${RELAY_BASE}/api/chat-media/${meta.mediaId}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);

  const ciphertext = await res.arrayBuffer();
  const rawKey = Uint8Array.from(atob(meta.mediaKey), c => c.charCodeAt(0));
  const iv     = Uint8Array.from(atob(meta.mediaIV),  c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext);

  // Delete from relay immediately after successful decryption
  fetch(`${RELAY_BASE}/api/chat-media/${meta.mediaId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  }).catch(() => {}); // fire-and-forget

  return URL.createObjectURL(new Blob([plaintext], { type: meta.mediaType }));
}

/** Embed MediaMeta as JSON inside a chat message text payload. */
export function encodeMediaMessage(meta: MediaMeta): string {
  return `\x00MEDIA:${JSON.stringify(meta)}\x00`;
}

/** Returns MediaMeta if the text is a media message, null otherwise. */
export function decodeMediaMessage(text: string): MediaMeta | null {
  const m = text.match(/^\x00MEDIA:(.*)\x00$/s);
  if (!m) return null;
  try { return JSON.parse(m[1]) as MediaMeta; }
  catch { return null; }
}
