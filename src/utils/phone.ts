export function ensureWhatsAppAddress(phone: string): string {
  // Remove all whitespace and non-digit characters except + and :
  const cleaned = phone.replace(/\s/g, '').trim();
  
  if (cleaned.startsWith('whatsapp:')) {
    // Already has whatsapp: prefix, ensure no spaces in the number part
    const [prefix, number] = cleaned.split(':');
    return `${prefix}:${number.replace(/\s/g, '')}`;
  }
  
  if (cleaned.startsWith('+')) return `whatsapp:${cleaned}`;
  return `whatsapp:+${cleaned}`;
}

export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/^whatsapp:/, '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}

export function standardizeWhatsappNumber(raw: string): string {
  if (!raw) {
    return '';
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('whatsapp:')) {
    return standardizeWhatsappNumber(trimmed.replace(/^whatsapp:/, ''));
  }

  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  if (!digitsOnly) {
    return '';
  }

  if (digitsOnly.startsWith('+')) {
    return digitsOnly;
  }

  return `+${digitsOnly.replace(/^\+/, '')}`;
}

/**
 * Strip + prefix from phone number for Sufrah API compatibility
 * Sufrah API expects: 966502045939 (no + prefix)
 */
export function stripPlusPrefix(phone: string): string {
  if (!phone) return '';
  
  // Remove whatsapp: prefix if present
  let cleaned = phone.replace(/^whatsapp:/, '');
  
  // Remove + prefix
  cleaned = cleaned.replace(/^\+/, '');
  
  return cleaned;
}
