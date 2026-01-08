export interface ImageJob {
  cardId: string;
  sourceUrl: string;
  sourceId: string;
  sourceName?: string;
  trustTier?: number;
  priority?: number;
  cardNumber?: string;
  setCode?: string;
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'deduplicated' | 'rejected' | 'rate_limited';
  imageId?: string;
  error?: string;
  sha256?: string;
  detectedSide?: 'front' | 'back' | 'unknown';
  confidence?: number;
}

export interface FetchResult {
  ok: boolean;
  bytes?: Buffer;
  contentType?: string;
  error?: string;
  httpStatus?: number;
}

export interface SideDetectionResult {
  side: 'front' | 'back' | 'unknown';
  confidence: number;
  method: 'heuristic' | 'vision' | 'manual';
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface DerivativeResult {
  variant: 'thumb' | 'grid' | 'detail';
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  storagePath: string;
}

export interface ImageSource {
  id: string;
  name: string;
  baseUrl: string | null;
  trustTier: number;
  maxRps: number;
  maxConcurrency: number;
  isAllowed: boolean;
}

// Known error payloads (bad responses from sources)
export const KNOWN_ERROR_PAYLOADS: Record<string, number[]> = {
  // pokemontcg.io returns this 186316 byte file for missing images
  'pokemontcg_api': [186316],
};
