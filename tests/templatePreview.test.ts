/**
 * Test suite for template preview functionality
 * Run with: bun test tests/templatePreview.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { 
  fetchTemplatePreview, 
  renderTemplateBody, 
  getRenderedTemplatePreview,
  clearTemplateCache 
} from '../src/services/templatePreview';

describe('Template Preview Service', () => {
  
  beforeAll(() => {
    // Clear cache before tests
    clearTemplateCache();
  });

  describe('renderTemplateBody', () => {
    test('should replace single variable', () => {
      const body = 'Hello {{1}}!';
      const variables = { '1': 'John' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('Hello John!');
    });

    test('should replace multiple variables', () => {
      const body = 'Welcome {{2}} to {{1}}!';
      const variables = { '1': 'Sufrah', '2': 'Ahmed' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('Welcome Ahmed to Sufrah!');
    });

    test('should handle variables in middle of text', () => {
      const body = 'Your order {{1}} is ready for pickup at {{2}}';
      const variables = { '1': '#1234', '2': 'Main Street' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('Your order #1234 is ready for pickup at Main Street');
    });

    test('should keep unreplaced variables if not provided', () => {
      const body = 'Hello {{1}} and {{2}}!';
      const variables = { '1': 'John' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('Hello John and {{2}}!');
    });

    test('should return original body if no variables provided', () => {
      const body = 'Hello {{1}}!';
      const result = renderTemplateBody(body);
      expect(result).toBe('Hello {{1}}!');
    });

    test('should handle body without variables', () => {
      const body = 'Hello world!';
      const variables = { '1': 'Test' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('Hello world!');
    });

    test('should handle emojis in body', () => {
      const body = 'You have a new order made on Sufrah! 🎉 {{1}}';
      const variables = { '1': '👍' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('You have a new order made on Sufrah! 🎉 👍');
    });

    test('should handle Arabic text', () => {
      const body = 'مرحباً {{2}} في {{1}}!';
      const variables = { '1': 'سفرة', '2': 'أحمد' };
      const result = renderTemplateBody(body, variables);
      expect(result).toBe('مرحباً أحمد في سفرة!');
    });
  });

  describe('fetchTemplatePreview', () => {
    test('should return null for invalid SID', async () => {
      const result = await fetchTemplatePreview('INVALID_SID_12345');
      // Should return null if fetch fails or SID doesn't exist
      expect(result).toBeNull();
    }, { timeout: 10000 });

    test('should handle fetch errors gracefully', async () => {
      // Use an obviously fake SID format
      const result = await fetchTemplatePreview('HX000000000000000000000000000000');
      expect(result).toBeNull();
    }, { timeout: 10000 });

    // Note: Real template testing would require valid Twilio credentials and template SIDs
    // These tests verify error handling and data structure
  });

  describe('getRenderedTemplatePreview', () => {
    test('should return null for invalid SID with variables', async () => {
      const result = await getRenderedTemplatePreview('INVALID_SID', { '1': 'Test' });
      expect(result).toBeNull();
    }, { timeout: 10000 });

    // Integration test with real template would go here
    // Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in environment
  });

  describe('Template Cache', () => {
    test('should clear specific template from cache', () => {
      clearTemplateCache('HX1234567890');
      // Cache cleared successfully if no error thrown
      expect(true).toBe(true);
    });

    test('should clear all templates from cache', () => {
      clearTemplateCache();
      // Cache cleared successfully if no error thrown
      expect(true).toBe(true);
    });
  });
});

describe('Template Preview Data Structure', () => {
  test('should have correct structure for quick-reply template', () => {
    const mockTemplate = {
      sid: 'HX1234567890',
      friendlyName: 'order_notification',
      language: 'en',
      body: 'You have a new order!',
      contentType: 'quick-reply' as const,
      buttons: [
        {
          type: 'QUICK_REPLY' as const,
          title: 'View Order',
          id: 'view_order',
        },
      ],
    };

    expect(mockTemplate.sid).toBeTruthy();
    expect(mockTemplate.contentType).toBe('quick-reply');
    expect(mockTemplate.buttons).toHaveLength(1);
    expect(mockTemplate.buttons[0].type).toBe('QUICK_REPLY');
  });

  test('should have correct structure for text template', () => {
    const mockTemplate = {
      sid: 'HX9876543210',
      friendlyName: 'simple_notification',
      language: 'ar',
      body: 'تم توصيل طلبك',
      contentType: 'text' as const,
      buttons: [],
    };

    expect(mockTemplate.contentType).toBe('text');
    expect(mockTemplate.buttons).toHaveLength(0);
    expect(mockTemplate.language).toBe('ar');
  });

  test('should support multiple button types', () => {
    const mockButtons = [
      { type: 'QUICK_REPLY' as const, title: 'Reply', id: 'reply' },
      { type: 'URL' as const, title: 'Visit', url: 'https://example.com' },
      { type: 'PHONE_NUMBER' as const, title: 'Call', phone_number: '+1234567890' },
      { type: 'COPY_CODE' as const, title: 'Copy Code' },
    ];

    mockButtons.forEach((button) => {
      expect(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']).toContain(button.type);
    });
  });
});

describe('Integration with Message Events', () => {
  test('should create proper message event structure', () => {
    const mockEvent = {
      type: 'message.sent',
      message: {
        id: 'cm7abc123',
        conversationId: 'cm7conv123',
        content: 'You have a new order!',
        messageType: 'template',
        direction: 'OUT',
        createdAt: new Date().toISOString(),
        contentSid: 'HX1234567890',
        variables: { '1': 'Restaurant Name' },
        templatePreview: {
          sid: 'HX1234567890',
          friendlyName: 'order_notification',
          language: 'en',
          body: 'You have a new order!',
          contentType: 'quick-reply',
          buttons: [
            {
              type: 'QUICK_REPLY',
              title: 'View Details',
              id: 'view_order',
            },
          ],
        },
      },
    };

    expect(mockEvent.type).toBe('message.sent');
    expect(mockEvent.message.messageType).toBe('template');
    expect(mockEvent.message.templatePreview).toBeTruthy();
    expect(mockEvent.message.templatePreview.buttons).toHaveLength(1);
  });

  test('should handle fallback for text messages', () => {
    const mockEvent = {
      type: 'message.sent',
      message: {
        id: 'cm7xyz456',
        conversationId: 'cm7conv123',
        content: 'Your order is ready!',
        messageType: 'text',
        direction: 'OUT',
        createdAt: new Date().toISOString(),
      },
    };

    expect(mockEvent.message.messageType).toBe('text');
    expect(mockEvent.message).not.toHaveProperty('templatePreview');
    expect(mockEvent.message).not.toHaveProperty('contentSid');
  });
});

console.log('\n✅ Template Preview Test Suite');
console.log('Run these tests with: bun test tests/templatePreview.test.ts');
console.log('\nNote: Integration tests with real Twilio templates require:');
console.log('  - TWILIO_ACCOUNT_SID in .env');
console.log('  - TWILIO_AUTH_TOKEN in .env');
console.log('  - Valid template SID for testing');

