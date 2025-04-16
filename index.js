const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(express.json()); // Parse JSON request bodies
const port = process.env.PORT || 10000; // Use Render's PORT or default to 10000

// Firebase Admin SDK initialization with environment variables
initializeApp({
  credential: require('firebase-admin').credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});
const db = getFirestore();

// Environment variables
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || 'd2288872-b12c-4974-af8c-e98665ea2564';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

// Ad and coin tracking constants
const ADS_TO_WATCH = 10;
const COOLDOWN_MINUTES = 15;

// Function to generate engaging, growth-motivated notification message using ChatGPT
async function generateNotificationMessage(type = 'ad', userId = null) {
  try {
    let prompt;
    switch (type) {
      case 'ad':
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to motivate an Indian user to watch ads for coins in Vidalyzer to grow their YouTube/Instagram, e.g., "Hey, boost YouTube—watch ads! 🎉"';
        break;
      case 'app':
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to motivate an Indian user to use Vidalyzer daily to grow their YouTube/Instagram, e.g., "Morning champ! Grow Insta now! 😍" and feel like a friend encouraging growth';
        break;
      case 'subscription':
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to celebrate an Indian user’s new Vidalyzer subscription, e.g., "Welcome to Premium! Skyrocket growth! 🎉"';
        break;
      case 'coin_purchase':
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to celebrate an Indian user buying coins in Vidalyzer, e.g., "Coins added! Boost your channels! 🚀"';
        break;
      case 'cooldown':
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to notify an Indian user that their ad-watch cooldown in Vidalyzer is over, e.g., "Cooldown done! Watch ads to grow! 🎥"';
        break;
      default:
        prompt = 'Generate a short, fun, dopamine-boosting push notification (max 50 characters) to motivate an Indian user to use Vidalyzer, e.g., "Grow Insta today! 😍"';
    }
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
    switch (type) {
      case 'ad':
        return 'Boost YouTube—watch ads! 🎉';
      case 'app':
        return 'Grow Insta today! 😍';
      case 'subscription':
        return 'Welcome to Premium! Skyrocket growth! 🎉';
      case 'coin_purchase':
        return 'Coins added! Boost your channels! 🚀';
      case 'cooldown':
        return 'Cooldown done! Watch ads to grow! 🎥';
      default:
        return 'Grow with Vidalyzer now! 🚀';
    }
  }
}

// Function to send push notification via OneSignal to a specific user or segment
async function sendNotification(message, target = 'All', oneSignalId = null) {
  try {
    const notificationData = {
      app_id: ONESIGNAL_APP_ID,
      contents: { en: message },
      headings: { en: 'Vidalyzer Growth!' }
    };

    if (oneSignalId) {
      notificationData.include_player_ids = [oneSignalId]; // Target specific user
    } else {
      notificationData.included_segments = [target]; // Target segment
    }

    await axios.post(
      'https://onesignal.com/api/v1/notifications',
      notificationData,
      {
        headers: {
          'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Notification sent to ${oneSignalId || target}: ${message}`);
  } catch (error) {
    console.error('Error sending notification:', error.response ? error.response.data : error.message);
  }
}

// Function to check and update ad watch status
async function checkAdStatus(userId) {
  if (!userId) {
    console.error('Invalid userId in checkAdStatus');
    return null;
  }
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
  if (!userData) return { coins: 0, message: 'Invalid user data' };
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
  if (!userData) return res.status(500).send('Error accessing user data');
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
  if (!userData) return res.status(500).send('Error accessing user data');
  let cost = 0;
  switch (feature) {
    case 'followers':
      cost = quantity * 10;
      break; // 10 coins per Instagram follower
    case 'subscribers':
      cost = quantity * 20;
      break; // 20 coins per YouTube subscriber
    default:
      return res.status(400).send('Invalid feature');
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

// Firestore listener for new subscriptions
db.collection('Premium').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === 'added' || (change.type === 'modified' && change.doc.data().isPremiumUser)) {
      const userId = change.doc.data().userId;
      if (!userId) {
        console.error('Invalid userId in Premium collection snapshot');
        return;
      }
      const subscriptionType = change.doc.data().subscriptionType;

      // Fetch user's oneSignalId from users collection
      const userDoc = await db.collection('users').doc(userId).get();
      if (userDoc.exists && userDoc.data().oneSignalId) {
        const oneSignalId = userDoc.data().oneSignalId;
        const message = await generateNotificationMessage('subscription');
        await sendNotification(message, null, oneSignalId);
        console.log(`Subscription notification sent to user ${userId} for ${subscriptionType}`);
      } else {
        console.error(`No oneSignalId found for user ${userId}`);
      }
    }
  });
});

// Firestore listener for coin purchases and cooldown completion
db.collection('users').onSnapshot((snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    try {
      const userId = change.doc.id;
      if (!userId) {
        console.error('Invalid userId in users collection snapshot');
        return;
      }
      const userData = change.doc.data();
      const oneSignalId = userData.oneSignalId;

      // Handle coin purchases
      if (change.type === 'modified') {
        const oldData = change.oldIndex !== -1 ? snapshot.docs[change.oldIndex].data() : {};
        if (userData.coins > (oldData.coins || 0) && !userData.lastAdTime) {
          if (oneSignalId) {
            const message = await generateNotificationMessage('coin_purchase');
            await sendNotification(message, null, oneSignalId);
            console.log(`Coin purchase notification sent to user ${userId}`);
          } else {
            console.error(`No oneSignalId found for user ${userId}`);
          }
        }
      }

      // Handle cooldown completion
      if ((change.type === 'added' || change.type === 'modified') && userData.adCooldownEndTime && oneSignalId) {
        const now = Date.now();
        const cooldownEndTime = userData.adCooldownEndTime;
        const timeUntilCooldownEnds = cooldownEndTime - now;

        if (timeUntilCooldownEnds > 0 && timeUntilCooldownEnds < 24 * 60 * 60 * 1000) { // Only schedule if within 24 hours
          setTimeout(async () => {
            // Verify cooldown is still complete
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists && userDoc.data().adCooldownEndTime <= Date.now()) {
              const message = await generateNotificationMessage('cooldown');
              await sendNotification(message, null, oneSignalId);
              console.log(`Cooldown completion notification sent to user ${userId}`);
            }
          }, timeUntilCooldownEnds);
        }
      }
    } catch (error) {
      console.error('Error processing users snapshot:', error.message);
    }
  });
});

// Start the server
app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.listen(port, () => console.log(`Server running on port ${port}`));