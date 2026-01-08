import { getSupabase } from '../db/client.js';
import { config } from '../config.js';
import { DerivativeResult } from '../types.js';
import { logger } from '../utils/logger.js';

export async function uploadDerivatives(derivatives: DerivativeResult[]): Promise<void> {
  const supabase = getSupabase();

  for (const derivative of derivatives) {
    try {
      const { error } = await supabase.storage
        .from(config.cardImagesBucket)
        .upload(derivative.storagePath, derivative.buffer, {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
          upsert: true,
        });

      if (error) {
        throw new Error(`Upload failed: ${error.message}`);
      }

      logger.info('Uploaded derivative', {
        variant: derivative.variant,
        path: derivative.storagePath,
        bytes: derivative.bytes,
      });
    } catch (error) {
      logger.error('Failed to upload derivative', {
        variant: derivative.variant,
        path: derivative.storagePath,
        error: error instanceof Error ? error.message : 'Unknown',
      });
      throw error;
    }
  }
}

export function getPublicUrl(storagePath: string): string {
  return `${config.supabaseUrl}/storage/v1/object/public/${config.cardImagesBucket}/${storagePath}`;
}
