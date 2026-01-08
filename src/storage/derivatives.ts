import sharp from 'sharp';
import { config } from '../config.js';
import { DerivativeResult } from '../types.js';
import { getDerivativeStoragePath } from '../utils/hash.js';
import { logger } from '../utils/logger.js';

type Variant = 'thumb' | 'grid' | 'detail';

export async function generateDerivatives(
  buffer: Buffer,
  sha256: string,
  originalWidth: number
): Promise<DerivativeResult[]> {
  const results: DerivativeResult[] = [];
  const variants: Variant[] = ['thumb', 'grid', 'detail'];

  for (const variant of variants) {
    const settings = config.derivativeSizes[variant];

    // Don't upscale - if original is smaller than target, use original size
    const targetWidth = Math.min(settings.width, originalWidth);

    try {
      const processed = await sharp(buffer)
        .resize(targetWidth, null, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: settings.quality })
        .toBuffer();

      const metadata = await sharp(processed).metadata();

      const storagePath = getDerivativeStoragePath(sha256, variant);

      results.push({
        variant,
        buffer: processed,
        width: metadata.width || targetWidth,
        height: metadata.height || 0,
        bytes: processed.length,
        storagePath,
      });

      logger.info('Generated derivative', {
        variant,
        width: metadata.width,
        height: metadata.height,
        bytes: processed.length,
      });
    } catch (error) {
      logger.error('Failed to generate derivative', {
        variant,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }

  return results;
}
