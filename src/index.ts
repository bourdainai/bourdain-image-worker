import express from 'express';
import { Receiver } from '@upstash/qstash';
import { config, validateConfig } from './config.js';
import { processImage } from './pipeline/index.js';
import { ImageJob } from './types.js';
import { logger } from './utils/logger.js';

// Validate config on startup
validateConfig();

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// QStash webhook receiver
const receiver = new Receiver({
  currentSigningKey: config.qstashCurrentSigningKey,
  nextSigningKey: config.qstashNextSigningKey,
});

// QStash webhook endpoint
app.post('/webhook/qstash', async (req, res) => {
  const startTime = Date.now();

  try {
    // Verify QStash signature
    const signature = req.headers['upstash-signature'];
    if (!signature || typeof signature !== 'string') {
      logger.warn('Missing QStash signature');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const isValid = await receiver.verify({
      signature,
      body: JSON.stringify(req.body),
    });

    if (!isValid) {
      logger.warn('Invalid QStash signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse job from body
    const job = req.body as ImageJob;

    if (!job.cardId || !job.sourceUrl) {
      logger.warn('Invalid job payload', { job });
      return res.status(400).json({ error: 'Missing cardId or sourceUrl' });
    }

    // Process the image
    const result = await processImage(job);

    const elapsed = Date.now() - startTime;
    logger.info('Job completed', { cardId: job.cardId, status: result.status, elapsed });

    // If rate limited, tell QStash to retry (429 status)
    if (result.status === 'rate_limited') {
      return res.status(429).json(result);
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Webhook handler error', { error: message });
    return res.status(500).json({ error: message });
  }
});

// Direct processing endpoint (for testing without QStash)
app.post('/process', async (req, res) => {
  const startTime = Date.now();

  try {
    // Check for service key auth
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization' });
    }

    const token = authHeader.substring(7);
    if (token !== config.supabaseServiceKey) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const job = req.body as ImageJob;

    if (!job.cardId || !job.sourceUrl) {
      return res.status(400).json({ error: 'Missing cardId or sourceUrl' });
    }

    const result = await processImage(job);

    const elapsed = Date.now() - startTime;
    logger.info('Direct process completed', { cardId: job.cardId, status: result.status, elapsed });

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Process handler error', { error: message });
    return res.status(500).json({ error: message });
  }
});

// Batch processing endpoint (for testing)
app.post('/batch', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || authHeader.substring(7) !== config.supabaseServiceKey) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const jobs = req.body.jobs as ImageJob[];
    if (!Array.isArray(jobs)) {
      return res.status(400).json({ error: 'jobs must be an array' });
    }

    const results = [];
    for (const job of jobs) {
      if (job.cardId && job.sourceUrl) {
        const result = await processImage(job);
        results.push({ cardId: job.cardId, ...result });
      }
    }

    return res.json({ results, count: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Batch handler error', { error: message });
    return res.status(500).json({ error: message });
  }
});

// Start server
app.listen(config.port, () => {
  logger.info('Railway Image Worker started', {
    port: config.port,
    supabaseUrl: config.supabaseUrl,
  });
});
