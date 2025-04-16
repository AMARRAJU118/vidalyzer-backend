const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || 'd2288872-b12c-4974-af8c-e98665ea2564';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// Function to generate notification message using ChatGPT
async function generateMessage() {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'user',
            content: 'Generate a short, engaging push notification message (max 50 characters) for Vidalyzer, a video analysis app.'
          }
        ],
        max_tokens: 60
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating message:', error.response ? error.response.data : error.message);
    return 'Discover new video insights with Vidalyzer!';
  }
}

// Function to send push notification via OneSignal
async function sendNotification(message) {
  try {
    await axios.post(
      'https://onesignal.com/api/v1/notifications',
      {
        app_id: ONESIGNAL_APP_ID,
        included_segments: ['All'],
        contents: { en: message },
        headings: { en: 'Vidalyzer Daily Tip' }
      },
      {
        headers: {
          'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Notification sent:', message);
  } catch (error) {
    console.error('Error sending notification:', error.response ? error.response.data : error.message);
  }
}

// Schedule daily notification at 9:00 AM
cron.schedule('0 9 * * *', async () => {
  console.log('Running daily notification task');
  const message = await generateMessage();
  await sendNotification(message);
});

// Start the server
app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.listen(port, () => console.log(`Server running on port ${port}`));