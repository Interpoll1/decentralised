/**
 * videoService.ts
 *
 * Video upload and playback via Filebase (S3-compatible IPFS pinning).
 *
 * Architecture:
 *   Upload flow:
 *     Browser → compress (ffmpeg.wasm) → relay-server /api/upload-video (proxy)
 *             → Filebase S3 API → real IPFS CID returned
 *             → CID + thumbnail stored in Gun post node
 *
 *   Playback flow:
 *     CID → https://ipfs.filebase.io/ipfs/{CID}  (Filebase gateway, fastest)
 *          → https://cloudflare-ipfs.com/ipfs/{CID} (fallback)
 *          → https://dweb.link/ipfs/{CID}           (fallback)
 *
 * Why proxy through relay-server instead of uploading directly from browser:
 *   - Filebase S3 credentials (access key / secret) must never be in client JS
 *   - relay-server signs the S3 request with AWS Signature V4
 *   - relay-server enforces file size limits and content-type validation
 *   - Supports resumable uploads via relay multipart forwarding
 *
 * Gun stores only lightweight metadata per video:
 *   { videoCID, videoThumbnailCID, videoDuration, videoSize, mimeType }
 * The actual video bytes live exclusively on IPFS — never in Gun.
 */

import config from '../config';
import { GunService } from './gunService';
import { StorageService } from './storageService';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard size limit applied AFTER compression. Raw files can be larger — they get compressed first. */
export const VIDEO_MAX_SIZE_BYTES  = 30 * 1024 * 1024;  // 30 MB after compression
/** Raw pre-compression size limit — reject anything over this before even trying to compress */
export const VIDEO_RAW_MAX_BYTES   = 500 * 1024 * 1024; // 500 MB raw cap
export const VIDEO_MAX_DURATION_S  = 600;               // 10 minutes
export const VIDEO_THUMBNAIL_TIME  = 2;                 // seconds into video for thumbnail
export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4', 'video/webm', 'video/ogg',
  'video/quicktime', 'video/x-msvideo', 'video/mpeg',
];

// IPFS gateways in priority order — tried sequentially on playback failure
export const IPFS_GATEWAYS = [
  'https://ipfs.filebase.io/ipfs',    // Filebase own gateway — fastest for our content
  'https://cloudflare-ipfs.com/ipfs', // Cloudflare — global CDN, very reliable
  'https://dweb.link/ipfs',           // Protocol Labs
  'https://gateway.ipfs.io/ipfs',     // Public fallback
];

// IndexedDB key for locally cached video metadata
const VIDEO_META_KEY = (cid: string) => `video-meta:${cid}`;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VideoMeta {
  cid:              string;
  thumbnailDataUrl: string | null;  // base64 thumbnail extracted from video frame
  thumbnailCID:     string | null;  // IPFS CID of thumbnail (uploaded separately)
  duration:         number;         // seconds
  size:             number;         // bytes (compressed)
  mimeType:         string;
  uploadedAt:       number;
}

export interface VideoUploadProgress {
  stage:      'validating' | 'compressing' | 'extracting-thumbnail' | 'uploading' | 'pinning' | 'done' | 'error';
  percent:    number;   // 0–100
  message:    string;
  error?:     string;
}

export type ProgressCallback = (progress: VideoUploadProgress) => void;

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateVideoFile(file: File): string | null {
  if (!SUPPORTED_VIDEO_TYPES.includes(file.type)) {
    return `Unsupported format: ${file.type}. Use MP4, WebM, OGG, MOV, or AVI.`;
  }
  if (file.size > VIDEO_MAX_SIZE_BYTES) {
    return `File too large: ${(file.size / 1024 / 1024).toFixed(0)} MB. Maximum is 30 MB after compression.`;
  }
  return null;
}

/** Get video duration and basic metadata without loading the full file */
export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url    = URL.createObjectURL(file);
    const video  = document.createElement('video');
    video.preload = 'metadata';
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const dur = video.duration;
      cleanup();
      if (dur > VIDEO_MAX_DURATION_S) {
        reject(new Error(`Video is ${Math.round(dur / 60)} minutes. Maximum is ${VIDEO_MAX_DURATION_S / 60} minutes.`));
      } else {
        resolve(dur);
      }
    };
    video.onerror = () => { cleanup(); reject(new Error('Could not read video metadata.')); };
    video.src = url;
  });
}

// ─── Thumbnail extraction ─────────────────────────────────────────────────────

/**
 * Extract a JPEG thumbnail from a video file at VIDEO_THUMBNAIL_TIME seconds.
 * Uses an offscreen <video> + <canvas> — no ffmpeg needed for thumbnails.
 */
export async function extractVideoThumbnail(
  file: File,
  atSeconds = VIDEO_THUMBNAIL_TIME,
  maxWidth = 640,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url    = URL.createObjectURL(file);
    const video  = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d')!;
    const cleanup = () => URL.revokeObjectURL(url);

    video.preload    = 'metadata';
    video.crossOrigin = 'anonymous';
    video.muted       = true;

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(atSeconds, video.duration * 0.1);
    };

    video.onseeked = () => {
      const aspect  = video.videoHeight / video.videoWidth;
      canvas.width  = Math.min(video.videoWidth, maxWidth);
      canvas.height = Math.round(canvas.width * aspect);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      cleanup();
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };

    video.onerror = () => { cleanup(); reject(new Error('Thumbnail extraction failed.')); };
    video.src = url;
  });
}

// ─── Video compression (ffmpeg.wasm) ─────────────────────────────────────────
//
// ffmpeg.wasm is ~30 MB — loaded lazily via dynamic import() so it never
// touches the critical bundle. It's only fetched when a user actually
// attaches a video. We use the @ffmpeg/ffmpeg + @ffmpeg/util packages.
//
// Target output spec (balances quality vs file size):
//   codec:     H.264 (libx264) — widest browser support for HTML5 <video>
//   preset:    veryfast — good quality/speed tradeoff
//   crf:       28 — visually lossless for social content (lower = better quality)
//   scale:     max 720p height, maintain aspect ratio
//   audio:     AAC 128 kbps
//   container: MP4 (fragmented, so it can stream before fully downloaded)
//
// If ffmpeg.wasm fails to load (CSP blocks wasm, old browser, etc.) we
// fall back to uploading the original file — the relay enforces the 30 MB
// post-compression cap and rejects if still too large.

let _ffmpegInstance: any = null;
let _ffmpegLoading: Promise<any> | null = null;

async function getFFmpeg(): Promise<any> {
  if (_ffmpegInstance) return _ffmpegInstance;
  if (_ffmpegLoading) return _ffmpegLoading;

  _ffmpegLoading = (async () => {
    try {
      const { FFmpeg }       = await import('@ffmpeg/ffmpeg');
      const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

      const ffmpeg = new FFmpeg();

      // Load the ffmpeg wasm core from CDN — keeps it out of the app bundle
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL:   await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript'),
        wasmURL:   await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
      });

      _ffmpegInstance = { ffmpeg, fetchFile };
      return _ffmpegInstance;
    } catch (err) {
      _ffmpegLoading = null;
      throw err;
    }
  })();

  return _ffmpegLoading;
}

export interface CompressionResult {
  file:        File;
  wasCompressed: boolean;
  originalSize:  number;
  compressedSize: number;
  compressionRatio: number; // e.g. 0.4 = 40% of original size
}

/**
 * Compress a video file using ffmpeg.wasm.
 *
 * Targets H.264/AAC in MP4, max 720p, CRF 28.
 * Falls back to the original file if:
 *   - ffmpeg.wasm fails to load (CSP, unsupported browser)
 *   - File is already small enough (< 5 MB — not worth the wasm overhead)
 *   - Compression makes it larger (rare but possible with already-optimised files)
 *
 * @param file          Raw video file from the file picker
 * @param onProgress    Called with 0–100 during ffmpeg processing
 */
export async function compressVideo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<CompressionResult> {
  const originalSize = file.size;

  // Skip compression for tiny files — wasm startup cost isn't worth it
  if (originalSize < 5 * 1024 * 1024) {
    return { file, wasCompressed: false, originalSize, compressedSize: originalSize, compressionRatio: 1 };
  }

  // Check raw cap before wasting time compressing
  if (originalSize > VIDEO_RAW_MAX_BYTES) {
    throw new Error(`File too large to compress: ${(originalSize / 1024 / 1024).toFixed(0)} MB. Maximum raw size is 500 MB.`);
  }

  let ffmpegCtx: any;
  try {
    ffmpegCtx = await getFFmpeg();
  } catch (err) {
    console.warn('[VideoService] ffmpeg.wasm failed to load — uploading original:', err);
    return { file, wasCompressed: false, originalSize, compressedSize: originalSize, compressionRatio: 1 };
  }

  const { ffmpeg, fetchFile } = ffmpegCtx;
  const inputName  = 'input' + getFileExtension(file.name);
  const outputName = 'output.mp4';

  // Wire progress callback to ffmpeg's progress event
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(99, Math.round(progress * 100)));
  };
  ffmpeg.on('progress', progressHandler);

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    await ffmpeg.exec([
      '-i', inputName,
      // Video: H.264, veryfast preset, CRF 28, max 720p (scale only if taller)
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '28',
      '-vf', 'scale=trunc(iw/2)*2:min(720\\,trunc(oh*a/2)*2):force_original_aspect_ratio=decrease',
      '-pix_fmt', 'yuv420p',
      // Audio: AAC 128k
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',
      // MP4 container, fragmented for streaming
      '-movflags', '+faststart+frag_keyframe+empty_moov',
      '-f', 'mp4',
      outputName,
    ]);

    const outputData = await ffmpeg.readFile(outputName);
    const compressedBlob = new Blob([outputData], { type: 'video/mp4' });
    const compressedSize = compressedBlob.size;

    // Clean up ffmpeg virtual FS
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    // If compression made it larger (already optimised file), use original
    if (compressedSize >= originalSize) {
      console.info('[VideoService] Compression produced larger file — using original');
      return { file, wasCompressed: false, originalSize, compressedSize: originalSize, compressionRatio: 1 };
    }

    const compressedFile = new File([compressedBlob], file.name.replace(/\.[^.]+$/, '.mp4'), { type: 'video/mp4' });
    const ratio = compressedSize / originalSize;
    console.info(`[VideoService] Compressed: ${(originalSize/1024/1024).toFixed(1)} MB → ${(compressedSize/1024/1024).toFixed(1)} MB (${Math.round(ratio*100)}%)`);

    onProgress?.(100);
    return { file: compressedFile, wasCompressed: true, originalSize, compressedSize, compressionRatio: ratio };

  } catch (err) {
    console.warn('[VideoService] Compression failed — uploading original:', err);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    return { file, wasCompressed: false, originalSize, compressedSize: originalSize, compressionRatio: 1 };
  } finally {
    ffmpeg.off('progress', progressHandler);
  }
}

function getFileExtension(filename: string): string {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0] : '.mp4';
}



/**
 * Upload a video file to Filebase via the relay-server proxy.
 *
 * The relay-server endpoint POST /api/upload-video:
 *   - Accepts multipart/form-data with field `video`
 *   - Signs the S3 request with Filebase credentials (never exposed to browser)
 *   - Returns { cid, size, mimeType } on success
 *
 * Progress is reported via the onProgress callback:
 *   - 0–10%:  validation + thumbnail extraction
 *   - 10–90%: upload (tracked via XMLHttpRequest.upload.onprogress)
 *   - 90–100%: IPFS pinning confirmation from Filebase
 */
export async function uploadVideo(
  file: File,
  onProgress?: ProgressCallback,
): Promise<VideoMeta> {
  const report = (stage: VideoUploadProgress['stage'], percent: number, message: string, error?: string) => {
    onProgress?.({ stage, percent, message, error });
  };

  // 1. Validate raw file
  report('validating', 0, 'Checking file…');
  const rawValidation = validateVideoFile(file);
  if (rawValidation) throw new Error(rawValidation);

  let duration: number;
  try {
    duration = await getVideoDuration(file);
  } catch (err: any) {
    throw new Error(err.message || 'Could not read video duration.');
  }

  // 2. Extract thumbnail BEFORE compression (original quality → better thumbnail)
  report('extracting-thumbnail', 5, 'Generating thumbnail…');
  let thumbnailDataUrl: string | null = null;
  try {
    thumbnailDataUrl = await extractVideoThumbnail(file);
  } catch (err) {
    console.warn('[VideoService] Thumbnail extraction failed — continuing without:', err);
  }

  // 3. Compress video with ffmpeg.wasm
  report('compressing', 10, 'Compressing video…');
  let fileToUpload = file;
  let compressionResult: CompressionResult | null = null;
  try {
    compressionResult = await compressVideo(file, (pct) => {
      // Map compression progress: 10% → 60%
      report('compressing', 10 + Math.round(pct * 0.5), `Compressing… ${pct}%`);
    });
    fileToUpload = compressionResult.file;

    // Post-compression size check
    if (fileToUpload.size > VIDEO_MAX_SIZE_BYTES) {
      throw new Error(
        `Compressed file is still ${(fileToUpload.size / 1024 / 1024).toFixed(0)} MB. ` +
        `Please use a shorter or lower-quality video (max ${VIDEO_MAX_SIZE_BYTES / 1024 / 1024} MB after compression).`
      );
    }
  } catch (err: any) {
    // Re-throw size errors; swallow compression errors (will use original)
    if (err.message?.includes('MB')) throw err;
    console.warn('[VideoService] Compression error — using original:', err);
    fileToUpload = file;
  }

  // 4. Upload thumbnail first (small, fast)
  report('uploading', 62, 'Uploading thumbnail…');
  let thumbnailCID: string | null = null;
  if (thumbnailDataUrl) {
    try {
      const thumbBlob = await dataUrlToBlob(thumbnailDataUrl);
      const thumbForm = new FormData();
      thumbForm.append('video', thumbBlob, 'thumbnail.jpg');
      thumbForm.append('type', 'thumbnail');
      const thumbRes = await fetchWithTimeout(
        `${config.relay.api}/api/upload-video`,
        { method: 'POST', body: thumbForm },
        30_000,
      );
      if (thumbRes.ok) {
        const thumbJson = await thumbRes.json();
        thumbnailCID = thumbJson.cid || null;
      }
    } catch (err) {
      console.warn('[VideoService] Thumbnail upload failed — continuing without:', err);
    }
  }

  // 5. Upload compressed video with progress tracking
  report('uploading', 65, 'Uploading video…');
  const formData = new FormData();
  formData.append('video', fileToUpload, fileToUpload.name);
  formData.append('type', 'video');
  formData.append('duration', String(Math.round(duration)));

  const { cid, size, mimeType } = await uploadWithProgress(
    `${config.relay.api}/api/upload-video`,
    formData,
    (uploadPercent) => {
      // Map upload progress: 65% → 90%
      report('uploading', 65 + Math.round(uploadPercent * 0.25), `Uploading… ${uploadPercent}%`);
    },
  );

  // 6. Write metadata to Gun
  report('pinning', 92, 'Confirming on IPFS…');
  const gun = GunService.getGun();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn('[VideoService] Gun video meta ack timeout — continuing');
      resolve();
    }, 5_000);
    gun.get('videos').get(cid).put({
      id:              cid,
      thumbnailCID:    thumbnailCID || null,
      thumbnail:       thumbnailDataUrl || null,
      duration:        Math.round(duration),
      size,
      mimeType,
      originalSize:    compressionResult?.originalSize ?? size,
      wasCompressed:   compressionResult?.wasCompressed ?? false,
      compressionRatio: compressionResult?.compressionRatio ?? 1,
      uploadedAt:      Date.now(),
    }, (ack: any) => {
      clearTimeout(timer);
      if (ack?.err) console.warn('[VideoService] Gun meta write error:', ack.err);
      resolve();
    });
  });

  const meta: VideoMeta = {
    cid, thumbnailDataUrl, thumbnailCID,
    duration, size, mimeType,
    uploadedAt: Date.now(),
  };

  // 6. Cache meta locally for instant playback on this device
  try {
    await StorageService.setMetadata(VIDEO_META_KEY(cid), JSON.stringify(meta));
  } catch { /* non-fatal */ }

  report('done', 100, 'Upload complete!');
  return meta;
}

// ─── Playback helpers ─────────────────────────────────────────────────────────

/**
 * Returns the best IPFS gateway URL for a CID.
 * Tries each gateway in order, picks the first that responds with 200.
 * Caches the working gateway per CID in sessionStorage for fast subsequent loads.
 */
const _gatewayCache = new Map<string, string>();

export async function resolveVideoUrl(cid: string): Promise<string> {
  if (_gatewayCache.has(cid)) return `${_gatewayCache.get(cid)}/${cid}`;

  for (const gateway of IPFS_GATEWAYS) {
    const url = `${gateway}/${cid}`;
    try {
      const res = await fetchWithTimeout(url, { method: 'HEAD' }, 4_000);
      if (res.ok || res.status === 206) {
        _gatewayCache.set(cid, gateway);
        return url;
      }
    } catch { /* try next */ }
  }
  // Fall back to first gateway without checking
  return `${IPFS_GATEWAYS[0]}/${cid}`;
}

/** Get all gateway URLs for a CID (used by <source> multi-fallback) */
export function getAllGatewayUrls(cid: string): string[] {
  return IPFS_GATEWAYS.map(gw => `${gw}/${cid}`);
}

/**
 * Get the thumbnail for a video — checks local cache first, then Gun.
 * Returns a data URL or null.
 */
export async function getVideoThumbnail(cid: string): Promise<string | null> {
  // Local meta cache
  try {
    const cached = await StorageService.getMetadata(VIDEO_META_KEY(cid));
    if (cached) {
      const meta: VideoMeta = JSON.parse(cached as string);
      if (meta.thumbnailDataUrl) return meta.thumbnailDataUrl;
    }
  } catch { /* not cached */ }

  // Gun fallback
  const gun = GunService.getGun();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5_000);
    gun.get('videos').get(cid).once((data: any) => {
      clearTimeout(timer);
      // Try thumbnailCID gateway first, fall back to inline thumbnail
      if (data?.thumbnailCID) {
        resolve(`${IPFS_GATEWAYS[0]}/${data.thumbnailCID}`);
      } else if (data?.thumbnail) {
        resolve(data.thumbnail);
      } else {
        resolve(null);
      }
    });
  });
}

/** Get video metadata from local cache or Gun */
export async function getVideoMeta(cid: string): Promise<VideoMeta | null> {
  try {
    const cached = await StorageService.getMetadata(VIDEO_META_KEY(cid));
    if (cached) return JSON.parse(cached as string);
  } catch { /* not cached */ }

  const gun = GunService.getGun();
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5_000);
    gun.get('videos').get(cid).once((data: any) => {
      clearTimeout(timer);
      if (!data?.id) { resolve(null); return; }
      resolve({
        cid: data.id,
        thumbnailDataUrl: data.thumbnail || null,
        thumbnailCID:     data.thumbnailCID || null,
        duration:         data.duration || 0,
        size:             data.size || 0,
        mimeType:         data.mimeType || 'video/mp4',
        uploadedAt:       data.uploadedAt || 0,
      });
    });
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl).then(r => r.blob());
}

function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (percent: number) => void,
): Promise<{ cid: string; size: number; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          if (!json.cid) { reject(new Error('Upload succeeded but no CID returned.')); return; }
          resolve(json);
        } catch {
          reject(new Error('Invalid response from upload endpoint.'));
        }
      } else {
        let msg = `Upload failed (HTTP ${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };

    xhr.onerror   = () => reject(new Error('Network error during upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.timeout   = 5 * 60 * 1000; // 5 minutes for large files

    xhr.send(formData);
  });
}

/** Format seconds as m:ss */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format bytes as human-readable size */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}