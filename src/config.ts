import 'dotenv/config';

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || 'https://gxhynkhxwuroedvlzucm.supabase.co',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  // QStash
  qstashCurrentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY || '',
  qstashNextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY || '',

  // OpenRouter (for vision)
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  visionModel: 'google/gemini-2.5-flash-preview',

  // Processing
  maxImagePixels: 20_000_000,
  derivativeSizes: {
    thumb: { width: 160, quality: 75 },
    grid: { width: 360, quality: 80 },
    detail: { width: 960, quality: 80 },
  } as const,

  // Confidence thresholds
  minConfidenceForAssignment: 0.85,
  visionCheckLowerBound: 0.6,
  visionCheckUpperBound: 0.9,

  // Storage
  cardImagesBucket: 'card-images',
};

// Validate required config
export function validateConfig(): void {
  const required = [
    'supabaseServiceKey',
    'qstashCurrentSigningKey',
    'qstashNextSigningKey',
  ] as const;

  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }
}
