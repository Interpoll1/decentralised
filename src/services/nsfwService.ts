// Browser-side NSFW image detection using nsfwjs + TensorFlow.js

import { ModerationService } from './moderationService';

export interface NsfwResult {
  safe: boolean;
  classification: string; // 'Safe' | 'Suggestive' | 'NSFW'
  confidence: number;     // 0-1
  predictions: Record<string, number>;
}

const MODEL_URL = 'MobileNetV2Mid';

export class NsfwService {
  private static model: any = null;
  private static loading = false;
  private static loadPromise: Promise<void> | null = null;
  private static cache = new Map<string, NsfwResult>();

  static async loadModel(): Promise<boolean> {
    if (this.model) return true;
    if (this.loadPromise) {
      await this.loadPromise;
      return !!this.model;
    }

    this.loading = true;
    this.loadPromise = (async () => {
      try {
        const nsfwjs = await import('nsfwjs');
        // Use quantized MobileNet v2 mid model (~3MB) for speed
        this.model = await nsfwjs.load(MODEL_URL, { size: 299 });
      } catch (e) {
        console.warn('NSFW model failed to load:', e);
        this.model = null;
        this.loadPromise = null; // allow retry on next call
      } finally {
        this.loading = false;
      }
    })();

    await this.loadPromise;
    return !!this.model;
  }

  static isEnabled(): boolean {
    return ModerationService.getSettings().imageFilterEnabled ?? false;
  }

  static getSensitivity(): number {
    return ModerationService.getSettings().imageFilterSensitivity ?? 0.6;
  }

  /**
   * Classify an image element. Returns cached result if available.
   */
  static async classifyImage(img: HTMLImageElement): Promise<NsfwResult> {
    const cacheKey = img.src;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.isEnabled()) {
      return { safe: true, classification: 'Safe', confidence: 1, predictions: {} };
    }

    const loaded = await this.loadModel();
    if (!loaded || !this.model) {
      return { safe: true, classification: 'Safe', confidence: 1, predictions: {} };
    }

    try {
      const predictions = await this.model.classify(img);
      const map: Record<string, number> = {};
      for (const p of predictions) {
        map[p.className] = p.probability;
      }

      const sensitivity = this.getSensitivity();
      const nsfwScore = (map['Porn'] || 0) + (map['Hentai'] || 0);
      const suggestiveScore = map['Sexy'] || 0;

      let classification: string;
      let safe: boolean;
      let confidence: number;

      if (nsfwScore >= sensitivity) {
        classification = 'NSFW';
        safe = false;
        confidence = nsfwScore;
      } else if (suggestiveScore >= sensitivity) {
        classification = 'Suggestive';
        safe = false;
        confidence = suggestiveScore;
      } else {
        classification = 'Safe';
        safe = true;
        confidence = map['Neutral'] || map['Drawing'] || 1 - nsfwScore - suggestiveScore;
      }

      const result: NsfwResult = { safe, classification, confidence, predictions: map };

      // Cache (limit size to prevent memory leaks)
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(cacheKey, result);

      return result;
    } catch (e) {
      console.warn('NSFW classification error:', e);
      return { safe: true, classification: 'Safe', confidence: 1, predictions: {} };
    }
  }

  /**
   * Classify from a URL by creating a temporary image element.
   */
  static async classifyUrl(url: string): Promise<NsfwResult> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    if (!this.isEnabled()) {
      return { safe: true, classification: 'Safe', confidence: 1, predictions: {} };
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        const result = await this.classifyImage(img);
        resolve(result);
      };
      img.onerror = () => {
        resolve({ safe: true, classification: 'Safe', confidence: 1, predictions: {} });
      };
      img.src = url;
    });
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static isLoading(): boolean {
    return this.loading;
  }

  static isModelLoaded(): boolean {
    return !!this.model;
  }
}
