// Server configuration
export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || 'development';

// Redis connection details
export const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
export const REDIS_PORT = process.env.REDIS_PORT || 6379;
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
export const REDIS_TLS = process.env.REDIS_TLS === 'true';
// Database
export const DATABASE_URL = process.env.DATABASE_URL || '';

// Redis (for queue & pub/sub)
const rawRedisUrl = process.env.REDIS_URL || '';

function buildRedisUrl(): string {
  if (rawRedisUrl && rawRedisUrl.includes('://')) {
    return rawRedisUrl;
  }

  const protocol = REDIS_TLS ? 'rediss' : 'redis';
  const auth = REDIS_PASSWORD ? `:${encodeURIComponent(REDIS_PASSWORD)}@` : '';
  const host = REDIS_HOST || 'localhost';
  const port = REDIS_PORT || 6379;

  return `${protocol}://${auth}${host}:${port}`;
}

export const REDIS_URL = buildRedisUrl();
export const EVENT_BUS = (process.env.EVENT_BUS || 'redis') as 'redis' | 'pg';

// Twilio (master account or default)
export const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token_here';
export const TWILIO_MASTER_SID = process.env.TWILIO_MASTER_SID || process.env.TWILIO_ACCOUNT_SID || '';
export const TWILIO_MASTER_AUTH = process.env.TWILIO_MASTER_AUTH || process.env.TWILIO_AUTH_TOKEN || '';
export const TWILIO_WEBHOOK_VALIDATE = process.env.TWILIO_WEBHOOK_VALIDATE === 'true';

// Legacy support (deprecated - use RestaurantBot table)
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || TWILIO_MASTER_SID;
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || TWILIO_MASTER_AUTH;
export const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
export const TWILIO_API_KEY = process.env.TWILIO_API_KEY || '';
export const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET || '';
export const TWILIO_QUICK_REPLAY_SID = process.env.TWILIO_QUICK_REPLAY_SID || '';

// App settings
export const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'bun-whatsapp-bot/1.0';
export const PAYMENT_LINK = process.env.PAYMENT_LINK || 'https://example.com/pay';
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '+966-500-000000';
export const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || 'https://sufrah-bot.vercel.app';
export const WHATSAPP_SEND_TOKEN = process.env.WHATSAPP_SEND_TOKEN || '';

// Sufrah external API
export const SUFRAH_API_BASE = process.env.SUFRAH_API_BASE || 'https://api.sufrah.sa/api/v1/external';
export const SUFRAH_API_KEY = `ApiToken ${process.env.SUFRAH_API_KEY}` || '';
export const SUFRAH_CACHE_TTL_MS = Number(process.env.SUFRAH_CACHE_TTL_MS || 180_000);
// Auth
export const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
export const DASHBOARD_PAT = process.env.DASHBOARD_PAT || '';
export const BOT_API_TOKEN = process.env.BOT_API_TOKEN || '';
export const BOT_API_KEY = process.env.BOT_API_KEY || '';

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);

// Queue settings
export const OUTBOUND_QUEUE_NAME = process.env.OUTBOUND_QUEUE_NAME || 'whatsapp-outbound';
export const WHATSAPP_SEND_QUEUE_NAME = process.env.WHATSAPP_SEND_QUEUE_NAME || 'whatsapp-send';
export const QUEUE_RETRY_ATTEMPTS = Number(process.env.QUEUE_RETRY_ATTEMPTS || 3);
export const QUEUE_BACKOFF_DELAY = Number(process.env.QUEUE_BACKOFF_DELAY || 5000);
export const WHATSAPP_SEND_QUEUE_ENABLED = process.env.WHATSAPP_SEND_QUEUE_ENABLED !== 'false'; // Default enabled

export const TWILIO_CONTENT_AUTH = Buffer.from(
  `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
).toString('base64');
