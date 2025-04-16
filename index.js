const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
const port = process.env.PORT || 3000;

// Firebase Admin SDK initialization (configure with your service account)
initializeApp({
    credential: require('firebase-admin').credential.cert({
      projectId: process.env.vidalyzer-aeb96,
      clientEmail: process.env.firebase-adminsdk-amy96@vidalyzer-aeb96.iam.gserviceaccount.com,
      privateKey: process.env.nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDHvommAq7TnhfO\no5koxiTM5Z46vU8VMu9HWflwmfbd5fjOUNmL9Ug5V6DFDKofL3fT2M+WS6Px+3Ud\n/hvLPe1MwB4k0F3FCbXLjMkd1AW1oqnW+Qi8wDaiYPKFY700cGgHbCa/wBqU/NyL\nhAKtUR8rKU7g7f8W4fmQO1VgxTjDGB4rUJLovXxwZl8rpTxzDlzz1PFT+DLHH1No\nCOCaOQugyU6exeP5bCIPz5GFe7Ddjza2IVFyF0HeBqLoQAAObnEw2dqX1mftNuQb\nKRA4PY5VKSNZnbNw8wW4ntSTfmocdB2KYrDJOeO7kuKP52OYZeCXPi6L2yFqdS1r\nkJX8nPEzAgMBAAECggEAJRQADkKCPIMkzTV+OVzquORI5oN8uiUt2LNhg974vgEy\nGe5VK89Y3FghXmK287oGhttA0Zfx83nnqC0i8KvqsGwbTF8ngOuIBSR5suFIPArZ\ndy/cSNlvat4PNuaoWSMilHoliUO6S3zS3c0gCBc+b28oFsXnK9K/1l/FPgTuP/yW\ngaDXepS3BzVpdcyXugK63jpEjaWq89qRZ6NurI7V4h0wLOR0lKFRd4EQQ4qzouAI\nmPgbsDUl2qnQ0J2ckLQYvYyIYqCVvAwc6prtnK28Q/DdwX9H8IabQy0ACRwSAz6P\nh/L5CGOOGShVVtbMTUAGWF1Pn0txTNwbE0jbFx1bwQKBgQDw+S26jVQ7V2TQ0yu4\n/98RpZE/I7vyP6mNySQEhJdVIK8c9TwSu85mJZxTP9DtOEFOzlnLVE4iq39yLlCp\n1gj/51kfEsWPDKqgYY1Bq/+1U4W6elVRxGsshMOuTwJYUUAsmFEl7aLJ8YvSJ4k7\nv7T6mDVAemKAQ3JI2Q+1zSwlQQKBgQDUMzED8xNHxRvC/bQ+iBTbJZXSR+zdZQMU\n4A6yhkkqKjlPiADejHTQTICfqE6vtKw4wMLZWIKIDHUgEnb/eVT3igPqqdw+B1Kz\nrioYhcuK7BZf48DtqCRnNMFgs7H9atr/JkQRO0LKsbQEe663XAZU2or3VeQ7QVlG\ntYqp1OH1cwKBgHhTpK7zpWzgTdosqDd/pQ61wxppKI9llK/VEWQkJUD/yhFGr5GX\nMBA3laDIS/Y4Ufwc9B+g4EdVpZUJZYP4+ZN3HTxz7ixpIcZmD9gMH+qWYz9jmLj0\nwKOBRAkFMOGS6N2bzWGIEPKP58avsUohhyhe2rBwrEDp7OZNZRfd9L5BAoGBAI5f\nRlyzA1Wc/xJl7EAkR3H9lrb+gQLOGjIwXkwTYxWCPO+KfaLTtDBpk8cLQrgKzZ5K\nXrE6/GFRkmgRW3vvKT3ogNY6X0XS3f8mNKI9aqJr4ls10STjMoF4WOKLzjkML6EP\nSI4TJ64dan2zijcF7E2UT7bBDx9eqgqSFVX7OhvXAoGBAKK3pfrEpNYYLEF/pFsd\n1dTD0NipWGKlVnp8HBIJwnTUEt9qI/CneDOrj99vf+gQrr6FIIvfUphAGkHr7qGp\njQj7DGIvsDwxXH/FwvtswTsG8XzeXa4ZnUYwwYT7IukWVGJlDmXgb/cqnWQyMmVe\n587w+wk9IQuIlLApe3PZ0nhH.replace(/\\n/g, '\n')
    })
  });
const db = getFirestore();

// Environment variables
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || 'd2288872-b12c-4974-af8c-e98665ea2564';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Ad and coin tracking
const ADS_TO_WATCH = 10;
const COOLDOWN_MINUTES = 15;

// Function to generate engaging, growth-motivated notification message using ChatGPT
async function generateNotificationMessage(type = 'ad', userId = null) {
  try {
    const prompt = type === 'ad'
      ? 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to motivate an Indian user to watch ads for coins in Vidalyzer to grow their YouTube/Instagram, e.g., "Hey, boost YouTube—watch ads! 🎉"'
      : 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to motivate an Indian user to use Vidalyzer daily to grow their YouTube/Instagram, e.g., "Morning champ! Grow Insta now! 😍" and feel like a friend encouraging growth';
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
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
    console.error('Error generating notification:', error.response ? error.response.data : error.message);
    return type === 'ad' ? 'Boost YouTube—watch ads! 🎉' : 'Grow Insta today! 😍';
  }
}

// Function to send push notification via OneSignal
async function sendNotification(message, segment = 'All') {
  try {
    await axios.post(
      'https://onesignal.com/api/v1/notifications',
      {
        app_id: ONESIGNAL_APP_ID,
        included_segments: [segment],
        contents: { en: message },
        headings: { en: 'Vidalyzer Growth!' }
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

// Function to check and update ad watch status
async function checkAdStatus(userId) {
  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) {
    await userRef.set({ adsWatched: 0, lastAdTime: null, coins: 0, rewards: [] }, { merge: true });
    return { adsWatched: 0, lastAdTime: null, coins: 0, rewards: [] };
  }
  return doc.data();
}

// Function to award coins and handle rewards
async function awardCoins(userId) {
  const userData = await checkAdStatus(userId);
  if (userData.adsWatched >= ADS_TO_WATCH) {
    const coins = Math.floor(Math.random() * (25 - 10 + 1)) + 10; // Random 10-25 coins
    const newCoins = userData.coins + coins;
    const rewards = userData.rewards || [];
    rewards.push({ type: 'coins', amount: coins, timestamp: new Date().toISOString() });
    if (rewards.length > 5) rewards.shift(); // Keep only last 5 rewards

    await db.collection('users').doc(userId).update({
      adsWatched: 0,
      lastAdTime: new Date().toISOString(),
      coins: newCoins,
      rewards
    });
    return { coins, message: `Wow! Earned ${coins} coins to grow! 🎉` };
  }
  return { coins: 0, message: 'Watch 10 ads to grow your channels!' };
}

// Schedule notifications for Indian daytime (IST: UTC+5:30) and midnight
const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
const getIstTime = () => new Date(Date.now() + istOffset).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

cron.schedule('0 0 0,3,6,9,12,15,18,21 * * *', async () => {
  console.log('Scheduling notifications at', getIstTime());
  const adMessage = await generateNotificationMessage('ad');
  await sendNotification(adMessage);

  const appMessage = await generateNotificationMessage('app');
  await sendNotification(appMessage, 'Active Users'); // Target active users

  // Additional midnight notifications (10 PM, 11 PM, 12 AM IST)
  const utcHour = new Date().getUTCHours();
  if ([15, 16, 17].includes(utcHour + 5.5)) { // 10 PM, 11 PM, 12 AM IST
    const extraAdMessage = await generateNotificationMessage('ad');
    await sendNotification(extraAdMessage);
  }
});

// API endpoint to track ad watching and award coins
app.post('/watch-ad', async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('User ID required');

  const userData = await checkAdStatus(userId);
  const now = new Date();
  const lastAdTime = userData.lastAdTime ? new Date(userData.lastAdTime) : null;
  const cooldownElapsed = !lastAdTime || (now - lastAdTime) / (1000 * 60) >= COOLDOWN_MINUTES;

  if (userData.adsWatched < ADS_TO_WATCH && cooldownElapsed) {
    await db.collection('users').doc(userId).update({
      adsWatched: userData.adsWatched + 1
    });
    res.send({ message: `Ad ${userData.adsWatched + 1}/10 watched! Grow soon!` });
  } else if (!cooldownElapsed) {
    res.status(429).send({ message: `Cooldown active. Wait ${COOLDOWN_MINUTES} minutes.` });
  } else {
    const { coins, message } = await awardCoins(userId);
    res.send({ message, coins });
  }
});

// API endpoint to spend coins on premium features (e.g., followers, subscribers)
app.post('/buy-feature', async (req, res) => {
  const { userId, feature, quantity } = req.body;
  if (!userId || !feature || !quantity) return res.status(400).send('User ID, feature, and quantity required');

  const userData = await checkAdStatus(userId);
  let cost = 0;
  switch (feature) {
    case 'followers': cost = quantity * 10; break; // 10 coins per Instagram follower
    case 'subscribers': cost = quantity * 20; break; // 20 coins per YouTube subscriber
    default: return res.status(400).send('Invalid feature');
  }

  if (userData.coins >= cost) {
    await db.collection('users').doc(userId).update({
      coins: userData.coins - cost,
      rewards: [...(userData.rewards || []), { type: feature, amount: quantity, timestamp: new Date().toISOString() }].slice(-5)
    });
    res.send({ message: `Bought ${quantity} ${feature} to skyrocket growth!` });
  } else {
    res.status(402).send({ message: 'Need more coins to grow!' });
  }
});

// Start the server
app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.listen(port, () => console.log(`Server running on port ${port}`));