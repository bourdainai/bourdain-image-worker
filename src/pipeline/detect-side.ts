import sharp from 'sharp';
import { SideDetectionResult, ImageMetadata } from '../types.js';
import { logger } from '../utils/logger.js';

// Pokemon card aspect ratio is approximately 63mm x 88mm = 0.716
const EXPECTED_CARD_ASPECT_RATIO = 0.716;
const ASPECT_RATIO_TOLERANCE = 0.08; // Allow 8% variance

export async function detectSide(buffer: Buffer, metadata: ImageMetadata): Promise<SideDetectionResult> {
  try {
    let score = 0;
    const reasons: string[] = [];

    // 1. Aspect ratio check
    const aspectRatio = metadata.width / metadata.height;
    const aspectDiff = Math.abs(aspectRatio - EXPECTED_CARD_ASPECT_RATIO);

    if (aspectDiff <= ASPECT_RATIO_TOLERANCE) {
      score += 0.2;
      reasons.push('aspect_ratio_match');
    }

    // 2. Border color analysis (backs have distinctive blue/red border)
    const borderAnalysis = await analyzeBorderColors(buffer);

    if (borderAnalysis.isBlueBack) {
      score -= 0.6; // Strong indicator of back
      reasons.push('blue_back_detected');
    } else if (borderAnalysis.hasYellowBorder) {
      score += 0.3; // Yellow borders often indicate front
      reasons.push('yellow_border');
    } else if (borderAnalysis.hasVariedColors) {
      score += 0.2; // Varied colors suggest front (artwork)
      reasons.push('varied_colors');
    }

    // 3. Determine side based on score
    let side: 'front' | 'back' | 'unknown';
    let confidence: number;

    if (score >= 0.3) {
      side = 'front';
      confidence = Math.min(0.95, 0.5 + score);
    } else if (score <= -0.3) {
      side = 'back';
      confidence = Math.min(0.95, 0.5 + Math.abs(score));
    } else {
      side = 'unknown';
      confidence = 0.5;
    }

    logger.info('Side detection result', {
      side,
      confidence,
      score,
      reasons,
      aspectRatio,
    });

    return {
      side,
      confidence,
      method: 'heuristic',
    };
  } catch (error) {
    logger.error('Side detection failed', { error: error instanceof Error ? error.message : 'Unknown' });
    return {
      side: 'unknown',
      confidence: 0.5,
      method: 'heuristic',
    };
  }
}

interface BorderAnalysis {
  isBlueBack: boolean;
  hasYellowBorder: boolean;
  hasVariedColors: boolean;
  dominantHue: number;
}

async function analyzeBorderColors(buffer: Buffer): Promise<BorderAnalysis> {
  // Downscale to 64x64 for analysis
  const small = await sharp(buffer)
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Extract border pixels (outer 10% frame)
  const borderPixels = extractBorderPixels(small, 64, 64);

  // Analyze colors
  const analysis = analyzePixelColors(borderPixels);

  return analysis;
}

function extractBorderPixels(buffer: Buffer, width: number, height: number): Array<{ r: number; g: number; b: number }> {
  const pixels: Array<{ r: number; g: number; b: number }> = [];
  const borderSize = Math.floor(width * 0.1); // 10% border

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Check if pixel is in border region
      const inBorder = x < borderSize || x >= width - borderSize ||
                       y < borderSize || y >= height - borderSize;

      if (inBorder) {
        const idx = (y * width + x) * 3;
        pixels.push({
          r: buffer[idx],
          g: buffer[idx + 1],
          b: buffer[idx + 2],
        });
      }
    }
  }

  return pixels;
}

function analyzePixelColors(pixels: Array<{ r: number; g: number; b: number }>): BorderAnalysis {
  let blueCount = 0;
  let yellowCount = 0;
  let totalHue = 0;
  const hueHistogram = new Array(12).fill(0); // 12 hue buckets

  for (const pixel of pixels) {
    const { r, g, b } = pixel;

    // Check for blue (Pokemon card back is distinctive blue)
    // RGB roughly (28, 107, 175) to (50, 130, 200)
    if (b > 120 && b > r * 1.5 && b > g * 1.2) {
      blueCount++;
    }

    // Check for yellow (common border color on fronts)
    if (r > 180 && g > 150 && b < 100) {
      yellowCount++;
    }

    // Calculate hue for variety analysis
    const hue = rgbToHue(r, g, b);
    totalHue += hue;
    const hueBucket = Math.floor(hue / 30);
    hueHistogram[hueBucket]++;
  }

  const blueRatio = blueCount / pixels.length;
  const yellowRatio = yellowCount / pixels.length;

  // Check color variety (non-uniform = likely front with artwork)
  const maxBucket = Math.max(...hueHistogram);
  const hasVariedColors = maxBucket < pixels.length * 0.4; // No single hue dominates

  return {
    isBlueBack: blueRatio > 0.5,
    hasYellowBorder: yellowRatio > 0.3,
    hasVariedColors,
    dominantHue: totalHue / pixels.length,
  };
}

function rgbToHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  return hue * 60;
}
