import { describe, expect, test } from 'bun:test';
import {
  standardizeWhatsappNumber,
  formatPhoneForSufrah,
  derivePhoneFormats,
} from '../src/utils/phone';

describe('phone utils', () => {
  test('standardizes local numbers by prepending +966', () => {
    expect(standardizeWhatsappNumber('536656166')).toBe('+966536656166');
    expect(standardizeWhatsappNumber('0536656166')).toBe('+966536656166');
  });

  test('standardizes numbers with whatsapp prefix', () => {
    expect(standardizeWhatsappNumber('whatsapp:+966500000001')).toBe('+966500000001');
  });

  test('formats phone for Sufrah using raw input when provided', () => {
    expect(formatPhoneForSufrah('536656166')).toBe('536656166');
    expect(formatPhoneForSufrah('0536656166')).toBe('0536656166');
  });

  test('formats phone for Sufrah using fallback when raw missing', () => {
    expect(formatPhoneForSufrah(undefined, '+966536656166')).toBe('0536656166');
  });

  test('derivePhoneFormats returns consistent representations', () => {
    const formats = derivePhoneFormats('  whatsapp:0536656166  ');
    expect(formats.e164).toBe('+966536656166');
    expect(formats.local).toBe('0536656166');
    expect(formats.digits).toBe('966536656166');
  });
});
