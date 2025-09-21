export function ensureWhatsAppAddress(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('whatsapp:')) return trimmed;
  if (trimmed.startsWith('+')) return `whatsapp:${trimmed}`;
  return `whatsapp:+${trimmed}`;
}

export function normalizePhoneNumber(raw: string): string {
  return raw.replace(/^whatsapp:/, '').replace(/[^\d+]/g, '').replace(/^\+/, '');
}
