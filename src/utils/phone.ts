const DEFAULT_COUNTRY_CODE = (process.env.DEFAULT_COUNTRY_CODE || '+966').trim();
const DEFAULT_COUNTRY_DIGITS = DEFAULT_COUNTRY_CODE.replace(/^\+/, '');

function removeWhatsappPrefix(value: string): string {
  return value.replace(/^whatsapp:/, '');
}

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
  return removeWhatsappPrefix(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
}

function stripInternationalDialPrefix(digits: string): string {
  return digits.startsWith('00') ? digits.replace(/^00+/, '') : digits;
}

function isLikelyLocalNumber(digits: string): boolean {
  if (!digits) return false;
  if (digits.length <= 9) return true;
  if (digits.startsWith('0')) return true;
  if (digits.startsWith('5')) return digits.length <= 10;
  return false;
}

export interface PhoneFormats {
  e164: string;
  rawInput: string;
  local: string;
  digits: string;
}

export function derivePhoneFormats(raw: string | undefined | null): PhoneFormats {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const withoutPrefix = trimmed ? removeWhatsappPrefix(trimmed) : '';
  const compact = withoutPrefix.replace(/\s+/g, '');
  const cleaned = compact.replace(/[^\d+]/g, '');

  if (!trimmed && !cleaned) {
    const fallback = DEFAULT_COUNTRY_DIGITS ? `+${DEFAULT_COUNTRY_DIGITS}` : '';
    return {
      e164: fallback,
      rawInput: '',
      local: '',
      digits: stripPlusPrefix(fallback),
    };
  }

  const digitsOnly = stripInternationalDialPrefix(cleaned.replace(/[+]/g, ''));
  const normalizedDigits = digitsOnly.replace(/^0+/, '') || digitsOnly;

  let e164 = '';
  let digits = normalizedDigits;

  if (digitsOnly && DEFAULT_COUNTRY_DIGITS) {
    if (digitsOnly.startsWith(DEFAULT_COUNTRY_DIGITS)) {
      e164 = `+${digitsOnly}`;
      digits = digitsOnly;
    } else if (normalizedDigits.startsWith(DEFAULT_COUNTRY_DIGITS)) {
      e164 = `+${normalizedDigits}`;
      digits = normalizedDigits;
    } else if (isLikelyLocalNumber(digitsOnly)) {
      e164 = `+${DEFAULT_COUNTRY_DIGITS}${normalizedDigits}`;
      digits = `${DEFAULT_COUNTRY_DIGITS}${normalizedDigits}`;
    }
  }

  if (!e164) {
    const fallbackDigits = digitsOnly || normalizedDigits || DEFAULT_COUNTRY_DIGITS;
    e164 = fallbackDigits ? `+${fallbackDigits}` : '';
    digits = fallbackDigits || '';
  }

  let local = compact.startsWith('+') ? compact.slice(1) : compact;

  if (!local || local === digits) {
    if (DEFAULT_COUNTRY_DIGITS && digits.startsWith(DEFAULT_COUNTRY_DIGITS)) {
      const localDigits = digits.slice(DEFAULT_COUNTRY_DIGITS.length);
      if (localDigits.length === 9 && localDigits.startsWith('5')) {
        local = `0${localDigits}`;
      } else {
        local = localDigits;
      }
    } else {
      local = digits;
    }
  }

  return {
    e164,
    rawInput: compact,
    local,
    digits,
  };
}

export function standardizeWhatsappNumber(raw: string): string {
  if (!raw) {
    return '';
  }
  const { e164 } = derivePhoneFormats(raw);
  return e164;
}

/**
 * Strip + prefix from phone number for Sufrah API compatibility
 * Sufrah API expects: 966502045939 (no + prefix)
 */
export function stripPlusPrefix(phone: string): string {
  if (!phone) return '';

  // Remove whatsapp: prefix if present
  let cleaned = removeWhatsappPrefix(phone);

  // Remove + prefix
  cleaned = cleaned.replace(/^\+/, '');

  return cleaned;
}

/**
 * Format phone numbers for Sufrah API requests using the user-supplied format when available.
 * Falls back to stripping the + prefix from the standardized variant.
 */
export function formatPhoneForSufrah(rawInput: string | undefined, fallback?: string): string {
  if (rawInput && rawInput.trim()) {
    return derivePhoneFormats(rawInput).local;
  }
  if (fallback && fallback.trim()) {
    return derivePhoneFormats(fallback).local;
  }
  return '';
}
