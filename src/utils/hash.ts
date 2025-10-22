import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue) as JsonValue[];
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([key, val]) => [key, normalizeValue(val)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const normalized: Record<string, JsonValue> = {};
    for (const [key, val] of entries) {
      normalized[key] = val;
    }
    return normalized;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return Number.isNaN(value) ? null : (value > 0 ? Number.MAX_VALUE : Number.MIN_VALUE);
    }
    return value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

export function hashObject(value: unknown): string {
  const normalized = JSON.stringify(normalizeValue(value));
  return createHash('sha256').update(normalized).digest('hex');
}

export function hashStrings(...parts: string[]): string {
  return hashObject(parts);
}
