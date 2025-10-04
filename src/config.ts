// Server configuration
export const PORT = Number(process.env.PORT || 3000);
export const NODE_ENV = process.env.NODE_ENV || 'development';

// Database
export const DATABASE_URL = process.env.DATABASE_URL || '';

// Redis (for queue & pub/sub)
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
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

// App settings
export const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'bun-whatsapp-bot/1.0';
export const PAYMENT_LINK = process.env.PAYMENT_LINK || 'https://example.com/pay';
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '+966-500-000000';
export const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || 'https://sufrah-bot.vercel.app';

// Auth
export const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
export const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);

// Queue settings
export const OUTBOUND_QUEUE_NAME = process.env.OUTBOUND_QUEUE_NAME || 'whatsapp-outbound';
export const QUEUE_RETRY_ATTEMPTS = Number(process.env.QUEUE_RETRY_ATTEMPTS || 3);
export const QUEUE_BACKOFF_DELAY = Number(process.env.QUEUE_BACKOFF_DELAY || 5000);

export const TWILIO_CONTENT_AUTH = Buffer.from(
  `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
).toString('base64');
