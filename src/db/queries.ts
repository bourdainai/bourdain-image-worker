import { getSupabase } from './client.js';
import type { ImageSource } from '../types.js';
import { logger } from '../utils/logger.js';

export async function findImageBySha256(sha256: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabase()
    .from('images')
    .select('id')
    .eq('sha256', sha256)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error('Error finding image by SHA256', { error: error.message });
  }

  return data;
}

export async function getImageSource(sourceId: string): Promise<ImageSource | null> {
  const { data, error } = await getSupabase()
    .from('image_sources')
    .select('id, name, base_url, trust_tier, max_rps, max_concurrency, is_allowed')
    .eq('id', sourceId)
    .single();

  if (error) {
    logger.error('Error getting image source', { error: error.message });
    return null;
  }

  return data ? {
    id: data.id,
    name: data.name,
    baseUrl: data.base_url,
    trustTier: data.trust_tier,
    maxRps: data.max_rps,
    maxConcurrency: data.max_concurrency,
    isAllowed: data.is_allowed,
  } : null;
}

export async function getImageSourceByName(name: string): Promise<ImageSource | null> {
  const { data, error } = await getSupabase()
    .from('image_sources')
    .select('id, name, base_url, trust_tier, max_rps, max_concurrency, is_allowed')
    .eq('name', name)
    .single();

  if (error) {
    logger.error('Error getting image source by name', { error: error.message, name });
    return null;
  }

  return data ? {
    id: data.id,
    name: data.name,
    baseUrl: data.base_url,
    trustTier: data.trust_tier,
    maxRps: data.max_rps,
    maxConcurrency: data.max_concurrency,
    isAllowed: data.is_allowed,
  } : null;
}

export async function createImageRecord(params: {
  sha256: string;
  phash?: string;
  originalMime: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  originalStoragePath?: string;
  status: string;
  detectedSide: string;
  sideConfidence: number;
  isCollage: boolean;
  detectedMethod: string;
}): Promise<string> {
  const { data, error } = await getSupabase()
    .from('images')
    .insert({
      sha256: params.sha256,
      phash: params.phash,
      original_mime: params.originalMime,
      original_width: params.originalWidth,
      original_height: params.originalHeight,
      original_bytes: params.originalBytes,
      original_storage_path: params.originalStoragePath,
      status: params.status,
      detected_side: params.detectedSide,
      side_confidence: params.sideConfidence,
      is_collage: params.isCollage,
      detected_method: params.detectedMethod,
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create image record: ${error.message}`);
  }

  return data.id;
}

export async function updateImageStatus(imageId: string, status: string, error?: string): Promise<void> {
  const { error: updateError } = await getSupabase()
    .from('images')
    .update({ status, error, updated_at: new Date().toISOString() })
    .eq('id', imageId);

  if (updateError) {
    logger.error('Failed to update image status', { error: updateError.message });
  }
}

export async function createDerivativeRecord(params: {
  imageId: string;
  variant: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  storagePath: string;
}): Promise<void> {
  const { error } = await getSupabase()
    .from('image_derivatives')
    .insert({
      image_id: params.imageId,
      variant: params.variant,
      format: params.format,
      width: params.width,
      height: params.height,
      bytes: params.bytes,
      storage_path: params.storagePath,
    });

  if (error) {
    throw new Error(`Failed to create derivative record: ${error.message}`);
  }
}

export async function assignImageToCard(params: {
  cardId: string;
  imageId: string;
  role: string;
  sourceId?: string;
  sourceUrl?: string;
}): Promise<void> {
  const { error } = await getSupabase()
    .from('card_images')
    .upsert({
      card_id: params.cardId,
      image_id: params.imageId,
      role: params.role,
      source_id: params.sourceId,
      source_url: params.sourceUrl,
      assigned_at: new Date().toISOString(),
    }, {
      onConflict: 'card_id,role',
    });

  if (error) {
    throw new Error(`Failed to assign image to card: ${error.message}`);
  }
}

export async function logIngestEvent(params: {
  cardId?: string;
  candidateId?: string;
  imageId?: string;
  eventType: string;
  message?: string;
  httpStatus?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await getSupabase()
    .from('image_ingest_events')
    .insert({
      card_id: params.cardId,
      candidate_id: params.candidateId,
      image_id: params.imageId,
      event_type: params.eventType,
      message: params.message,
      http_status: params.httpStatus,
      metadata: params.metadata,
    });

  if (error) {
    logger.error('Failed to log ingest event', { error: error.message });
  }
}
