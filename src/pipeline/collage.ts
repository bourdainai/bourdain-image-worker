import sharp from 'sharp';
import { logger } from '../utils/logger.js';

/**
 * Detect if an image is a collage (multiple cards in one image)
 * Uses edge detection and aspect ratio analysis
 */
export async function detectCollage(buffer: Buffer): Promise<boolean> {
  try {
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return false;

    const aspectRatio = metadata.width / metadata.height;

    // Quick check: very wide/tall images are likely collages
    // Single card aspect ratio is ~0.716
    if (aspectRatio > 1.5 || aspectRatio < 0.4) {
      logger.info('Collage detected by aspect ratio', { aspectRatio });
      return true;
    }

    // For borderline cases, analyze edge patterns
    // Convert to grayscale and detect vertical edges
    const edges = await sharp(buffer)
      .grayscale()
      .resize(200, Math.round(200 / aspectRatio), { fit: 'fill' })
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1], // Sobel vertical
      })
      .raw()
      .toBuffer();

    // Count strong vertical edges in middle section
    const width = 200;
    const height = Math.round(200 / aspectRatio);
    const middleStart = Math.floor(width * 0.2);
    const middleEnd = Math.floor(width * 0.8);

    let strongEdgeColumns = 0;
    const threshold = 100;

    for (let x = middleStart; x < middleEnd; x++) {
      let columnSum = 0;
      for (let y = 0; y < height; y++) {
        columnSum += edges[y * width + x];
      }
      if (columnSum / height > threshold) {
        strongEdgeColumns++;
      }
    }

    // If there are multiple strong vertical lines, likely a collage
    const edgeRatio = strongEdgeColumns / (middleEnd - middleStart);
    const isCollage = edgeRatio > 0.15; // More than 15% of columns have strong edges

    if (isCollage) {
      logger.info('Collage detected by edge analysis', { edgeRatio });
    }

    return isCollage;
  } catch (error) {
    logger.error('Collage detection failed', { error: error instanceof Error ? error.message : 'Unknown' });
    return false; // Default to not collage on error
  }
}
