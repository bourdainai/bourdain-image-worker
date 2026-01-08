import { FetchResult, KNOWN_ERROR_PAYLOADS } from '../types.js';
import { logger } from '../utils/logger.js';

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchImage(url: string, sourceName?: string): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Bourdain-Image-Worker/1.0',
        'Accept': 'image/*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        httpStatus: response.status,
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return {
        ok: false,
        error: `Invalid content type: ${contentType}`,
        httpStatus: response.status,
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    // Check for known error payloads
    if (sourceName && isKnownErrorPayload(bytes, sourceName)) {
      return {
        ok: false,
        error: 'known_error_payload',
        httpStatus: response.status,
      };
    }

    return {
      ok: true,
      bytes,
      contentType,
      httpStatus: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Fetch failed', { url, error: message });

    return {
      ok: false,
      error: message,
    };
  }
}

export function isKnownErrorPayload(bytes: Buffer, sourceName: string): boolean {
  const errorSizes = KNOWN_ERROR_PAYLOADS[sourceName];
  if (!errorSizes) return false;

  return errorSizes.includes(bytes.length);
}
