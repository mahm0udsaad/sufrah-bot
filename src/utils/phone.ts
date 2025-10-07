export function ensureWhatsAppAddress(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('whatsapp:')) return trimmed;
  if (trimmed.startsWith('+')) return `whatsapp:${trimmed}`;
  return `whatsapp:+${trimmed}`;
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
