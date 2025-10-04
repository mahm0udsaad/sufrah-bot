import crypto from 'crypto';
import { TWILIO_WEBHOOK_VALIDATE } from '../config';

/**
 * Verify Twilio webhook signature for security
 * https://www.twilio.com/docs/usage/security#validating-requests
 */

export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, any>
): boolean {
  if (!TWILIO_WEBHOOK_VALIDATE) {
    console.log('⚠️ Twilio signature validation is disabled');
    return true;
  }

  try {
    // Sort params alphabetically
    const sortedKeys = Object.keys(params).sort();
    
    // Concatenate url with sorted params
    let data = url;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    // Create HMAC-SHA1 signature
    const hmac = crypto.createHmac('sha1', authToken);
    hmac.update(data);
    const expectedSignature = hmac.digest('base64');

    const isValid = expectedSignature === signature;
    
    if (!isValid) {
      console.warn('⚠️ Invalid Twilio signature');
      console.log('Expected:', expectedSignature);
      console.log('Received:', signature);
    }

    return isValid;
  } catch (error) {
    console.error('❌ Error validating Twilio signature:', error);
    return false;
  }
}

/**
 * Extract signature from request headers
 */
export function extractTwilioSignature(headers: Headers): string | null {
  return headers.get('x-twilio-signature') || null;
}

