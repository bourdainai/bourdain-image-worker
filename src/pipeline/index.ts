import { ImageJob, ProcessResult, SideDetectionResult } from '../types.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { computeSha256 } from '../utils/hash.js';
import { tryAcquire, initBucket, getWaitTime } from '../utils/rate-limit.js';

import { fetchImage } from './fetch.js';
import { decodeImage } from './decode.js';
import { detectSide } from './detect-side.js';
import { detectCollage } from './collage.js';
import { checkWithVision, shouldRunVisionCheck } from './vision.js';
import { generateDerivatives } from '../storage/derivatives.js';
import { uploadDerivatives } from '../storage/upload.js';

import {
  findImageBySha256,
  getImageSource,
  getImageSourceByName,
  createImageRecord,
  updateImageStatus,
  createDerivativeRecord,
  assignImageToCard,
  logIngestEvent,
} from '../db/queries.js';

export async function processImage(job: ImageJob): Promise<ProcessResult> {
  const startTime = Date.now();

  logger.info('Processing image job', {
    cardId: job.cardId,
    sourceUrl: job.sourceUrl,
    sourceId: job.sourceId,
  });

  // Log start event
  await logIngestEvent({
    cardId: job.cardId,
    eventType: 'fetch_started',
    message: job.sourceUrl,
  });

  try {
    // 1. Get source info for rate limiting and trust tier
    let source = job.sourceId ? await getImageSource(job.sourceId) : null;
    if (!source && job.sourceName) {
      source = await getImageSourceByName(job.sourceName);
    }

    const trustTier = source?.trustTier ?? job.trustTier ?? 3;
    const sourceName = source?.name ?? job.sourceName ?? 'unknown';

    // 2. Check rate limit
    if (source) {
      initBucket(source.id, source.maxRps);
      if (!tryAcquire(source.id)) {
        const waitTime = getWaitTime(source.id);
        logger.warn('Rate limited', { sourceId: source.id, waitTime });
        return { status: 'rate_limited', error: `Rate limited, retry after ${waitTime}ms` };
      }
    }

    // 3. Fetch image
    const fetchResult = await fetchImage(job.sourceUrl, sourceName);

    if (!fetchResult.ok || !fetchResult.bytes) {
      await logIngestEvent({
        cardId: job.cardId,
        eventType: 'fetch_failed',
        message: fetchResult.error,
        httpStatus: fetchResult.httpStatus,
      });
      return { status: 'failed', error: fetchResult.error };
    }

    await logIngestEvent({
      cardId: job.cardId,
      eventType: 'fetch_completed',
      httpStatus: fetchResult.httpStatus,
      metadata: { bytes: fetchResult.bytes.length, contentType: fetchResult.contentType },
    });

    // 4. Compute SHA256 for deduplication
    const sha256 = computeSha256(fetchResult.bytes);

    const existing = await findImageBySha256(sha256);
    if (existing) {
      logger.info('Image deduplicated', { sha256, existingId: existing.id });
      await logIngestEvent({
        cardId: job.cardId,
        imageId: existing.id,
        eventType: 'deduplicated',
      });

      // Still assign to card if not already assigned
      await assignImageToCard({
        cardId: job.cardId,
        imageId: existing.id,
        role: 'primary_front',
        sourceId: source?.id,
        sourceUrl: job.sourceUrl,
      });

      return { status: 'deduplicated', imageId: existing.id, sha256 };
    }

    // 5. Decode and validate dimensions
    const decodeResult = await decodeImage(fetchResult.bytes);
    if (!decodeResult.ok) {
      await logIngestEvent({
        cardId: job.cardId,
        eventType: 'validation_failed',
        message: decodeResult.error,
      });
      return { status: 'failed', error: decodeResult.error };
    }

    const { metadata } = decodeResult;

    // 6. Side detection (heuristics)
    let sideResult: SideDetectionResult = await detectSide(fetchResult.bytes, metadata);

    // 7. Collage detection
    const isCollage = await detectCollage(fetchResult.bytes);

    // 8. Vision fallback if needed
    if (shouldRunVisionCheck(trustTier, sideResult.confidence)) {
      logger.info('Running vision check', { trustTier, currentConfidence: sideResult.confidence });
      const visionResult = await checkWithVision(fetchResult.bytes, job, trustTier);

      // Use vision result if it provides higher confidence
      if (visionResult.confidence > sideResult.confidence) {
        sideResult = visionResult;
      }
    }

    await logIngestEvent({
      cardId: job.cardId,
      eventType: 'validation_passed',
      metadata: {
        width: metadata.width,
        height: metadata.height,
        side: sideResult.side,
        confidence: sideResult.confidence,
        isCollage,
        method: sideResult.method,
      },
    });

    // 9. Create image record
    await logIngestEvent({ cardId: job.cardId, eventType: 'processing_started' });

    const imageId = await createImageRecord({
      sha256,
      originalMime: fetchResult.contentType || 'image/unknown',
      originalWidth: metadata.width,
      originalHeight: metadata.height,
      originalBytes: fetchResult.bytes.length,
      status: 'processing',
      detectedSide: sideResult.side,
      sideConfidence: sideResult.confidence,
      isCollage,
      detectedMethod: sideResult.method,
    });

    // 10. Generate derivatives
    const derivatives = await generateDerivatives(fetchResult.bytes, sha256, metadata.width);

    await logIngestEvent({
      cardId: job.cardId,
      imageId,
      eventType: 'derivatives_generated',
      metadata: { count: derivatives.length },
    });

    // 11. Upload derivatives
    await uploadDerivatives(derivatives);

    await logIngestEvent({
      cardId: job.cardId,
      imageId,
      eventType: 'upload_completed',
    });

    // 12. Record derivatives in database
    for (const derivative of derivatives) {
      await createDerivativeRecord({
        imageId,
        variant: derivative.variant,
        format: 'webp',
        width: derivative.width,
        height: derivative.height,
        bytes: derivative.bytes,
        storagePath: derivative.storagePath,
      });
    }

    // 13. Update image status to completed
    await updateImageStatus(imageId, 'completed');

    await logIngestEvent({
      cardId: job.cardId,
      imageId,
      eventType: 'processing_completed',
      metadata: { elapsed_ms: Date.now() - startTime },
    });

    // 14. Assign to card if valid (front, high confidence, not collage)
    const canAssign =
      sideResult.side === 'front' &&
      sideResult.confidence >= config.minConfidenceForAssignment &&
      !isCollage;

    if (canAssign) {
      await assignImageToCard({
        cardId: job.cardId,
        imageId,
        role: 'primary_front',
        sourceId: source?.id,
        sourceUrl: job.sourceUrl,
      });

      await logIngestEvent({
        cardId: job.cardId,
        imageId,
        eventType: 'assigned',
        message: 'primary_front',
      });

      logger.info('Image assigned to card', {
        cardId: job.cardId,
        imageId,
        side: sideResult.side,
        confidence: sideResult.confidence,
      });

      return {
        status: 'completed',
        imageId,
        sha256,
        detectedSide: sideResult.side,
        confidence: sideResult.confidence,
      };
    } else {
      await logIngestEvent({
        cardId: job.cardId,
        imageId,
        eventType: 'rejected',
        message: `side=${sideResult.side}, confidence=${sideResult.confidence}, isCollage=${isCollage}`,
      });

      logger.info('Image processed but not assigned', {
        cardId: job.cardId,
        imageId,
        side: sideResult.side,
        confidence: sideResult.confidence,
        isCollage,
      });

      return {
        status: 'rejected',
        imageId,
        sha256,
        detectedSide: sideResult.side,
        confidence: sideResult.confidence,
        error: `Not assigned: side=${sideResult.side}, confidence=${sideResult.confidence.toFixed(2)}, isCollage=${isCollage}`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Pipeline error', { cardId: job.cardId, error: message });

    await logIngestEvent({
      cardId: job.cardId,
      eventType: 'fetch_failed',
      message,
    });

    return { status: 'failed', error: message };
  }
}
