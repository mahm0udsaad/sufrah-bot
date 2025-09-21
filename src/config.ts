export const PORT = Number(process.env.PORT || 3000);
export const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'your_verify_token_here';
export const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
export const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
export const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
export const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'bun-whatsapp-bot/1.0';
export const PAYMENT_LINK = process.env.PAYMENT_LINK || 'https://example.com/pay';
export const SUPPORT_CONTACT = process.env.SUPPORT_CONTACT || '+966-500-000000';
export const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || 'https://sufrah-bot.vercel.app';

export const TWILIO_CONTENT_AUTH = Buffer.from(
  `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
).toString('base64');
