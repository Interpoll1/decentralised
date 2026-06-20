// src/services/imageService.ts — image storage over GenosDB.
//
// Images are compressed client-side and stored as base64 inside GenosDB nodes
// (the worker persists them to OPFS and syncs them P2P), replacing the former
// Gun `images/<cid>` graph (the old "IPFS" naming was a misnomer — no IPFS is involved).
import { db } from './gdbServices'
import imageCompression from 'browser-image-compression'

export class ImageService {
  private static isReady = false

  static getReadyStatus(): boolean {
    return this.isReady
  }

  static async initialize() {
    this.isReady = true
  }

  /** Compress an image and store it as a GenosDB node. Returns a content id + thumbnail. */
  static async uploadImage(file: File): Promise<{ cid: string; thumbnail: string; size: number }> {
    if (!this.isReady) await this.initialize()

    const compressed = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true })
    const thumbnail = await imageCompression(file, { maxSizeMB: 0.1, maxWidthOrHeight: 800, useWebWorker: true })
    const fullImageBase64 = await this.fileToBase64(compressed)
    const thumbnailBase64 = await this.fileToBase64(thumbnail)
    const cid = `img-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

    await db.put({
      type: 'image',
      id: cid,
      data: fullImageBase64,
      thumbnail: thumbnailBase64,
      size: compressed.size,
      uploadedAt: Date.now(),
      pinned: false,
    }, cid)

    return { cid, thumbnail: thumbnailBase64, size: compressed.size }
  }

  static async downloadImage(cid: string): Promise<string | null> {
    if (!this.isReady) await this.initialize()
    const { result } = await db.get(cid)
    return result?.value?.data ?? null
  }

  static async pin(cid: string) {
    const { result } = await db.get(cid)
    if (result?.value) await db.put({ ...result.value, pinned: true }, cid)
  }

  static async unpin(cid: string) {
    const { result } = await db.get(cid)
    if (result?.value) await db.put({ ...result.value, pinned: false }, cid)
  }

  static async listPinned(): Promise<string[]> {
    const { results } = await db.map({ query: { type: 'image', pinned: true } })
    return results.map(n => n.value.id as string)
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}
