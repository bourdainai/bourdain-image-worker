import sharp from 'sharp';
import { ImageMetadata } from '../types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export async function decodeImage(buffer: Buffer): Promise<{ ok: true; metadata: ImageMetadata } | { ok: false; error: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return { ok: false, error: 'Could not determine image dimensions' };
    }

    const pixels = metadata.width * metadata.height;
    if (pixels > config.maxImagePixels) {
      return { ok: false, error: `Image too large: ${pixels} pixels (max: ${config.maxImagePixels})` };
    }

    return {
      ok: true,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format || 'unknown',
        size: buffer.length,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown decode error';
    logger.error('Image decode failed', { error: message });
    return { ok: false, error: message };
  }
}

export function getAspectRatio(width: number, height: number): number {
  return width / height;
}
