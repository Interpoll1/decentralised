/** Versioned DM media: only opaque ciphertext crosses the upload boundary.
 * Descriptors belong exclusively inside the encrypted DM envelope.
 */
import config from '../config';

const RELAY_BASE = (() => {
  const ws = config.relay.websocket;
  return ws.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
})();

const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // 100 MB

export interface MediaMeta {
  version: 1;
  context: string;
  mediaId:   string;  // relay-assigned UUID
  mediaKey:  string;  // base64 AES-256-GCM key
  mediaIV:   string;  // base64 IV
  mediaType: string;  // MIME type (image/jpeg, video/mp4, …)
  mediaSize: number;  // original byte length
  mediaName: string;  // original file name
}

function aad(meta: Pick<MediaMeta, 'version' | 'context' | 'mediaType' | 'mediaSize' | 'mediaName'>): Uint8Array<ArrayBuffer> {
  if (meta.version !== 1 || typeof meta.context !== 'string' || !Number.isSafeInteger(meta.mediaSize)
    || meta.mediaSize < 0 || meta.mediaSize > MAX_MEDIA_BYTES || typeof meta.mediaName !== 'string'
    || typeof meta.mediaType !== 'string') throw new Error('Unsupported or malformed media descriptor');
  return new TextEncoder().encode(JSON.stringify(['interpoll-dm-media', meta.version, meta.context,
    meta.mediaType, meta.mediaSize, meta.mediaName]));
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

  const metadata = { version: 1 as const, context: crypto.randomUUID(),
    mediaType: file.type || 'application/octet-stream', mediaSize: file.size, mediaName: file.name };
  // 2. Encrypt
  const plaintext  = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(metadata) }, cryptoKey, plaintext);

  // 3. Upload ciphertext blob to relay
  const formData = new FormData();
  formData.append('file', new Blob([ciphertext], { type: 'application/octet-stream' }), 'encrypted.bin');
  formData.append('mimeType', 'application/octet-stream');

  const res = await fetch(`${RELAY_BASE}/api/chat-media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });
  if (!res.ok) throw new Error(`Media upload failed: ${res.status}`);
  const { mediaId } = await res.json();
  if (typeof mediaId !== 'string' || !mediaId) throw new Error('Invalid media reference');

  return {
    mediaId,
    mediaKey:  btoa(String.fromCharCode(...rawKey)),
    mediaIV:   btoa(String.fromCharCode(...iv)),
    ...metadata,
  };
}

/**
 * Decrypted media is memoised per media id for the life of the tab (and concurrent callers share one
 * download). Re-opening a chat used to re-download and re-decrypt every image and create a fresh blob
 * URL each time. Only the CIPHERTEXT is persisted across sessions (Cache Storage) — never plaintext.
 */
const decrypted = new Map<string, Promise<string>>();
const CIPHER_CACHE = 'interpoll-dm-media-v1';

async function fetchCiphertext(url: string, authToken: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = typeof caches !== 'undefined' ? await caches.open(CIPHER_CACHE) : null; } catch { cache = null; }
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch { /* fall through to network */ }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${authToken}` } });
  if (!res.ok) throw new Error(`Media fetch failed: ${res.status}`);
  void cache?.put(url, res.clone()).catch(() => {});
  return await res.arrayBuffer();
}

/** Authenticate before rendering; sender preview must not delete recipient media. */
export function fetchAndDecrypt(meta: MediaMeta, authToken: string): Promise<string> {
  const id = meta.mediaId;
  let p = decrypted.get(id);
  if (!p) {
    p = fetchAndDecryptUncached(meta, authToken);
    decrypted.set(id, p);
    p.catch(() => { if (decrypted.get(id) === p) decrypted.delete(id); });   // failures are retried next time
  }
  return p;
}

async function fetchAndDecryptUncached(meta: MediaMeta, authToken: string): Promise<string> {
  const ciphertext = await fetchCiphertext(`${RELAY_BASE}/api/chat-media/${encodeURIComponent(meta.mediaId)}`, authToken);
  const rawKey = Uint8Array.from(atob(meta.mediaKey), c => c.charCodeAt(0));
  const iv     = Uint8Array.from(atob(meta.mediaIV),  c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(meta) }, cryptoKey, ciphertext);
  if (plaintext.byteLength !== meta.mediaSize) throw new Error('Media size mismatch');

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
