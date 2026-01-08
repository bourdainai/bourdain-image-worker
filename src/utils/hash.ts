import { createHash } from 'crypto';

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function getStoragePathPrefix(sha256: string): string {
  return sha256.substring(0, 2);
}

export function getDerivativeStoragePath(sha256: string, variant: string): string {
  const prefix = getStoragePathPrefix(sha256);
  return `derivatives/${prefix}/${sha256}/${variant}.webp`;
}
