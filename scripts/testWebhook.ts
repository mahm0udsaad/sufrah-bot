#!/usr/bin/env bun
/**
 * Test script to simulate a Twilio webhook with button click
 * This helps verify that your webhook handler is working correctly
 */

const WEBHOOK_URL = process.env.WEBHOOK_TEST_URL || 'http://localhost:3000/whatsapp/webhook';

// Simulate a button click webhook payload from Twilio
const buttonClickPayload = {
  From: 'whatsapp:+201157337829', // Test customer number
  To: 'whatsapp:+966508034010',    // Your WhatsApp sender number
  MessageSid: `TEST${Date.now()}`,
  ProfileName: 'Test User',
  ButtonPayload: 'view_order',
  ButtonText: 'View Order Details',
  Body: 'View Order Details',
};

// Simulate a regular text message webhook
const regularMessagePayload = {
  From: 'whatsapp:+201157337829',
  To: 'whatsapp:+966508034010',
  MessageSid: `TEST${Date.now()}`,
  ProfileName: 'Test User',
  Body: 'Hello',
};

async function testWebhook(payload: any, description: string) {
  console.log(`\n📤 Testing: ${description}`);
  console.log('   URL:', WEBHOOK_URL);
  console.log('   Payload:', JSON.stringify(payload, null, 2));

  try {
    const formBody = new URLSearchParams(payload).toString();
    
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TwilioProxy/1.1',
      },
      body: formBody,
    });

    const status = response.status;
    const statusText = response.statusText;
    const body = await response.text();

    if (status === 200) {
      console.log(`   ✅ Success: ${status} ${statusText}`);
      if (body) {
        console.log(`   Response: ${body}`);
      }
    } else {
      console.log(`   ❌ Failed: ${status} ${statusText}`);
      if (body) {
        console.log(`   Error: ${body}`);
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

async function main() {
  console.log('🧪 Webhook Test Script');
  console.log('='.repeat(60));
  
  console.log('\n📋 Configuration:');
  console.log('   WEBHOOK_URL:', WEBHOOK_URL);
  console.log('   (Set WEBHOOK_TEST_URL env var to override)');
  
  // Test 1: Button click webhook
  await testWebhook(buttonClickPayload, 'Button Click (View Order Details)');
  
  // Wait a bit between requests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Regular message webhook
  await testWebhook(regularMessagePayload, 'Regular Text Message');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Test completed!');
  console.log('\n💡 What to check:');
  console.log('   1. Check your server logs (pm2 logs whatsapp-bot)');
  console.log('   2. Look for: "🔔 [Webhook] Received POST"');
  console.log('   3. For button test, look for: "🔘 [Webhook] Button detected"');
  console.log('   4. For button test, look for: "🔘 [ButtonClick] User requested"');
  console.log('   5. For button test, look for: "✅ [ButtonClick] Successfully sent"');
}

main().catch(console.error);

