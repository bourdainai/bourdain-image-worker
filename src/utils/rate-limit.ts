interface TokenBucket {
  tokens: number;
  lastRefill: number;
  maxTokens: number;
  refillRate: number; // tokens per second
}

const buckets = new Map<string, TokenBucket>();
const CACHE_DURATION_MS = 60_000; // Cache rate limits for 60 seconds

export function initBucket(sourceId: string, maxRps: number): void {
  buckets.set(sourceId, {
    tokens: maxRps,
    lastRefill: Date.now(),
    maxTokens: maxRps,
    refillRate: maxRps,
  });
}

export function tryAcquire(sourceId: string): boolean {
  const bucket = buckets.get(sourceId);
  if (!bucket) {
    // No rate limit configured, allow
    return true;
  }

  // Refill tokens based on time elapsed
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  const refill = Math.floor(elapsed * bucket.refillRate);

  if (refill > 0) {
    bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  // Try to acquire a token
  if (bucket.tokens > 0) {
    bucket.tokens--;
    return true;
  }

  return false;
}

export function getWaitTime(sourceId: string): number {
  const bucket = buckets.get(sourceId);
  if (!bucket || bucket.tokens > 0) {
    return 0;
  }

  // Calculate time until next token
  return Math.ceil(1000 / bucket.refillRate);
}

// Cleanup old buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > CACHE_DURATION_MS) {
      buckets.delete(key);
    }
  }
}, CACHE_DURATION_MS);
