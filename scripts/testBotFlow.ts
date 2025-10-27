/**
 * Test script to diagnose bot flow issues
 * Simulates a message coming in and traces execution
 */

import { processMessage, resolveRestaurantContext } from '../src/handlers/processMessage';
import { getGlobalBotEnabled } from '../src/state/bot';

async function testBotFlow() {
  console.log('🔍 Testing bot flow for Karam Shawrma (+966573610338)');
  console.log('='.repeat(60));

  // Test phone number
  const customerPhone = '+966555123456';
  const restaurantWhatsApp = '+966573610338';
  
  console.log('\n1. Checking global bot status...');
  const botEnabled = getGlobalBotEnabled();
  console.log(`   Bot globally enabled: ${botEnabled}`);
  
  console.log('\n2. Resolving restaurant context...');
  try {
    const restaurant = await resolveRestaurantContext(customerPhone, restaurantWhatsApp);
    console.log(`   Restaurant context:`, restaurant);
    
    if (!restaurant) {
      console.error('   ❌ No restaurant context found');
      return;
    }
    
    console.log('\n3. Testing processMessage...');
    await processMessage(customerPhone, 'مرحبا', 'text', {
      recipientPhone: restaurantWhatsApp,
      profileName: 'Test User'
    });
    
    console.log('\n✅ Bot flow test completed');
  } catch (error) {
    console.error('\n❌ Bot flow test failed:', error);
    console.error('Stack trace:', (error as Error).stack);
  }
}

testBotFlow()
  .then(() => {
    console.log('\n' + '='.repeat(60));
    console.log('Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });

