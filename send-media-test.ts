
import axios from 'axios';

const BOT_API_TOKEN = process.env.BOT_API_TOKEN;
const RESTAURANT_ID = process.env.RESTAURANT_ID;
const CONVERSATION_ID = process.env.CONVERSATION_ID; 
const BOT_DOMAIN = process.env.BOT_DOMAIN || 'http://localhost:3000';

async function sendMediaTest() {
  if (!BOT_API_TOKEN || !RESTAURANT_ID || !CONVERSATION_ID) {
    console.error('Missing required environment variables: BOT_API_TOKEN, RESTAURANT_ID, CONVERSATION_ID');
    return;
  }

  try {
    const response = await axios.post(
      `${BOT_DOMAIN}/api/conversations/${CONVERSATION_ID}/send-media`,
      {
        mediaUrl: 'https://sufrah.nyc3.cdn.digitaloceanspaces.com/logos/sufrah_logo.png',
        caption: 'This is a test message from the send-media-test.ts script.',
        mediaType: 'image',
      },
      {
        headers: {
          Authorization: `Bearer ${BOT_API_TOKEN}`,
          'X-Restaurant-Id': RESTAURANT_ID,
        },
      }
    );

    console.log('Message sent successfully:', response.data);
  } catch (error) {
    console.error('Error sending message:', error.response ? error.response.data : error.message);
  }
}

sendMediaTest();
