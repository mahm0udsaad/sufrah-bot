#!/usr/bin/env bun

/**
 * WhatsApp Send API Test Script
 * Tests the /api/whatsapp/send endpoint with detailed logging
 */

const PHONE_NUMBER = '+201157337829';
const TEXT = 'Hello from test script';
const TOKEN = 'sufrah_bot_0f3c9e7d4b82e19a56e2a1f3d9b8c4aa';
const API_URL = 'http://localhost:3000/api/whatsapp/send';

console.log('🧪 Testing WhatsApp Send API');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📞 Phone: ${PHONE_NUMBER}`);
console.log(`💬 Text: ${TEXT}`);
console.log(`🔑 Token: ${TOKEN.substring(0, 20)}...`);
console.log(`🌐 URL: ${API_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function testAPI() {
  console.log('⏱️  Step 1: Preparing request...');
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    console.error('❌ Request timed out after 10 seconds');
  }, 10000);

  try {
    console.log('⏱️  Step 2: Sending POST request...');
    const startTime = Date.now();
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: PHONE_NUMBER,
        text: TEXT,
      }),
      signal: controller.signal,
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️  Response received in ${duration}ms\n`);
    
    clearTimeout(timeoutId);

    console.log('📊 Response Details:');
    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
    
    const contentType = response.headers.get('content-type') || '';
    let body;
    
    if (contentType.includes('application/json')) {
      body = await response.json();
      console.log(`   Body:`, JSON.stringify(body, null, 2));
    } else {
      body = await response.text();
      console.log(`   Body (text):`, body);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (response.ok) {
      console.log('✅ Test PASSED - Message sent successfully!');
      if (body.status === 'queued') {
        console.log(`📬 Job ID: ${body.jobId}`);
        console.log(`📍 Queue Position: ${body.queuePosition}`);
      } else if (body.sid) {
        console.log(`📨 Message SID: ${body.sid}`);
        console.log(`📡 Channel: ${body.channel}`);
      }
    } else {
      console.log('❌ Test FAILED - API returned error');
      console.log(`   Error: ${body.error || 'Unknown error'}`);
      
      // Common error hints
      if (response.status === 401) {
        console.log('\n💡 Hint: Check that WHATSAPP_SEND_TOKEN in .env matches the token used');
      } else if (response.status === 400) {
        console.log('\n💡 Hint: Check phone number format and required parameters');
      } else if (response.status === 500) {
        console.log('\n💡 Hint: Check Twilio credentials and database connection');
      } else if (response.status === 503) {
        console.log('\n💡 Hint: WHATSAPP_SEND_TOKEN is not configured in .env');
      }
    }
    
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      console.error('\n❌ Request timed out!');
      console.error('\n🔍 Possible causes:');
      console.error('   1. Database connection is slow or hanging');
      console.error('   2. Redis connection is slow or hanging');
      console.error('   3. Twilio API is slow or timing out');
      console.error('   4. Server is stuck in a long-running operation');
      console.error('\n💡 Check server logs for more details:');
      console.error('   pm2 logs sufrah-api --lines 50');
      console.error('   OR if running directly: check terminal where server is running');
    } else {
      console.error('\n❌ Request failed:', error.message);
      console.error('\n🔍 Error details:', error);
    }
  }
}

// Run the test
console.log('🚀 Starting test...\n');
testAPI().then(() => {
  console.log('\n✅ Test complete');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Test crashed:', error);
  process.exit(1);
});

