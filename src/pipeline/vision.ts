import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ImageJob, SideDetectionResult } from '../types.js';

interface VisionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/**
 * Use OpenRouter Vision API to verify if image shows front of card
 */
export async function checkWithVision(
  buffer: Buffer,
  job: ImageJob,
  trustTier: number
): Promise<SideDetectionResult> {
  if (!config.openrouterApiKey) {
    logger.warn('OpenRouter API key not configured, skipping vision check');
    return { side: 'unknown', confidence: 0.5, method: 'vision' };
  }

  try {
    // Convert buffer to base64
    const base64Image = buffer.toString('base64');
    const mimeType = 'image/jpeg'; // Assume JPEG for simplicity

    // Build prompt based on trust tier
    let prompt = 'Is this the front of a Pokémon trading card? ';
    prompt += 'Answer with only "FRONT", "BACK", or "UNKNOWN". ';

    // For Tier 2/3 sources, also verify card identity
    if (trustTier >= 2 && job.cardNumber && job.setCode) {
      prompt += `Also verify: does this appear to be card number ${job.cardNumber} from set ${job.setCode}? `;
      prompt += 'If the card number/set don\'t match, answer "WRONG_CARD".';
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bourdain.io',
        'X-Title': 'Bourdain Image Worker',
      },
      body: JSON.stringify({
        model: config.visionModel,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 50,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Vision API request failed', { status: response.status, error: errorText });
      return { side: 'unknown', confidence: 0.5, method: 'vision' };
    }

    const data = (await response.json()) as VisionResponse;
    const answer = data.choices[0]?.message?.content?.trim().toUpperCase() || '';

    logger.info('Vision API response', { answer, cardId: job.cardId });

    // Parse response
    if (answer.includes('FRONT')) {
      return { side: 'front', confidence: 0.95, method: 'vision' };
    } else if (answer.includes('BACK')) {
      return { side: 'back', confidence: 0.95, method: 'vision' };
    } else if (answer.includes('WRONG_CARD')) {
      // This is a different card, treat as unknown
      return { side: 'unknown', confidence: 0.3, method: 'vision' };
    } else {
      return { side: 'unknown', confidence: 0.5, method: 'vision' };
    }
  } catch (error) {
    logger.error('Vision check failed', { error: error instanceof Error ? error.message : 'Unknown' });
    return { side: 'unknown', confidence: 0.5, method: 'vision' };
  }
}

/**
 * Determine if vision check should be run based on trust tier and confidence
 */
export function shouldRunVisionCheck(
  trustTier: number,
  currentConfidence: number,
  sampleRate = 0.1
): boolean {
  // Tier 1: Never run vision (trusted sources)
  if (trustTier === 1) {
    return false;
  }

  // Tier 3: Always run vision
  if (trustTier === 3) {
    return true;
  }

  // Tier 2: Run on uncertain cases or 10% sample
  if (currentConfidence >= config.visionCheckLowerBound &&
      currentConfidence < config.visionCheckUpperBound) {
    return true;
  }

  // Random sampling for Tier 2
  return Math.random() < sampleRate;
}
