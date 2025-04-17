const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(express.json());
const port = process.env.PORT || 10000;

// Firebase Admin SDK initialization
try {
  initializeApp({
    credential: require('firebase-admin').credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization failed:', error.message, error.stack);
  process.exit(1);
}
const db = getFirestore();

// Global unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason.message, reason.stack);
});

// Helper to get IST time
const getIstTime = () => new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

// Check if notification can be sent based on type and limits
async function canSendNotification(userId, type) {
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return false;

    const userData = userDoc.data();
    const today = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });

    if (type === 'ad') {
      const adCount = userData.adNotificationCount || 0;
      const lastAdDate = userData.lastAdNotificationDate || '';
      if (lastAdDate !== today) {
        await userRef.update({ adNotificationCount: 0, lastAdNotificationDate: today });
        return true;
      }
      return adCount < 3;
    } else if (type === 'welcome') {
      return !userData.welcomeSent;
    } else {
      // For motivational, subscription, coin_purchase, cooldown
      const lastSent = userData[`last${type.charAt(0).toUpperCase() + type.slice(1)}Sent`] || 0;
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      return now - lastSent >= oneHour;
    }
  } catch (error) {
    console.error(`Error checking notification limits for user ${userId}, type ${type}:`, error.message);
    return false;
  }
}

// Update notification tracking
async function updateNotificationTracking(userId, type) {
  try {
    const userRef = db.collection('users').doc(userId);
    if (type === 'ad') {
      const today = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
      await userRef.update({
        adNotificationCount: db.FieldValue.increment(1),
        lastAdNotificationDate: today,
      });
    } else if (type === 'welcome') {
      await userRef.update({ welcomeSent: true });
    } else {
      await userRef.update({
        [`last${type.charAt(0).toUpperCase() + type.slice(1)}Sent`]: Date.now(),
      });
    }
    console.log(`Updated notification tracking for user ${userId}, type ${type}`);
  } catch (error) {
    console.error(`Error updating notification tracking for user ${userId}, type ${type}:`, error.message);
  }
}

// Generate notification messages
async function generateNotificationMessage(type = 'ad', userId = null, coins = 0) {
  console.log(`Generating notification for type: ${type}, userId: ${userId || 'none'}, coins: ${coins}`);
  try {
    let prompt;
    const tones = ['exciting', 'motivational', 'urgent', 'reward-focused'];
    const randomTone = tones[Math.floor(Math.random() * tones.length)];

    switch (type) {
      case 'ad':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, reminder-style push notifications (max 10–15 words) to:
- Remind users to watch ads (limited to 3 notifications per day)
- Emphasize earning coins
- Boost daily engagement

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Forgot to watch ads today? Earn coins now! 🎉”
- “Don’t miss out! Watch ads for coins! 💰”
- “Hey, watch ads to grow your channels! 🚀”`;
        break;
      case 'cooldown':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, attention-grabbing push notifications (max 10–15 words) to:
- Notify users when their 15-minute cooldown ends
- Encourage watching more ads
- Boost engagement
- Sent only once per hour

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Cooldown’s done! Watch ads for coins! 🎉”
- “15 min up! Earn more coins now! 💰”
- “Ready? Your next ad awaits! 🚀”`;
        break;
      case 'motivational':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app helps users grow their channels and includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, motivational push notifications (max 10–15 words) to:
- Encourage users to create/upload content for YouTube/Instagram
- Promote Vidalyzer’s growth tools
- Boost daily engagement
- Sent only once per hour

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Uploaded your YouTube video today? Boost it with Vidalyzer! 🚀”
- “New Insta post? Grow it with Vidalyzer! 📸”
- “Create content today? Skyrocket it with us! 🎉”
- “Ready to shine? Post & grow with Vidalyzer! 💪”`;
        break;
      case 'subscription':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, attention-grabbing push notifications (max 10–15 words) to:
- Celebrate new premium subscriptions
- Encourage engagement with premium features
- Boost retention
- Sent only once per hour

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Premium unlocked! Grow faster with Vidalyzer! 🎉”
- “Welcome to premium! Skyrocket your channels! 🚀”
- “Premium power activated! Boost your growth! 💰”`;
        break;
      case 'coin_purchase':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, congratulatory push notifications (max 10–15 words) to:
- Celebrate when coins are added to the user’s account
- Mention the number of coins earned (e.g., ${coins} coins)
- Encourage using coins for growth
- Sent only once per hour

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Hey, you got ${coins} coins! Congrats! 🎉”
- “${coins} coins added! Boost your growth! 💰”
- “Woohoo! ${coins} coins earned! Grow now! 🚀”`;
        break;
      case 'welcome':
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, welcoming push notifications (max 10–15 words) to:
- Welcome new users on their first login
- Encourage initial engagement
- Sent only once ever per user

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Welcome to Vidalyzer! Grow your channels now! 🎉”
- “Hey, start boosting your Instagram & YouTube! 🚀”
- “New user? Skyrocket your growth with us! 💪”`;
        break;
      default:
        prompt = `You are an assistant helping write engaging push notifications for the Vidalyzer app, an AI-powered SEO Toolkit for YouTube & Instagram.

The app includes a feature called "Watch Ads & Get Coins", where users can:
- Watch up to 10 ads daily
- Earn coins for each ad watched
- Wait 15 minutes between each ad watch
- Use coins to buy Instagram followers, likes, YouTube subscribers, likes, or unlock premium features

🎯 Objective:
Create short, reminder-style push notifications (max 10–15 words) to:
- Remind users to watch ads (limited to 3 notifications per day)
- Emphasize earning coins
- Boost daily engagement

✨ Tone:
- ${randomTone}

💬 Sample Notification Themes:
- “Forgot to watch ads today? Earn coins now! 🎉”
- “Don’t miss out! Watch ads for coins! 💰”
- “Hey, watch ads to grow your channels! 🚀”`;
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    let message = response.data.choices[0].message.content.trim();
    if (type === 'coin_purchase') {
      message = message.replace('${coins}', coins); // Ensure coins value is inserted
    }
    console.log(`Generated message for ${type}: ${message}`);
    return message.length <= 50 ? message : message.substring(0, 50).trim() + '…';
  } catch (error) {
    console.error(`Error generating notification for type ${type}:`, error.response ? error.response.data : error.message, error.stack);
    const fallbacks = {
      ad: 'Watch ads to boost your channels! 📈',
      cooldown: 'Ad cooldown over! Grow now! ⏰',
      motivational: 'Post today? Grow with Vidalyzer! 🚀',
      subscription: 'Premium activated! Excel now! 🎉',
      coin_purchase: `Got ${coins} coins! Grow your channels! 💰`,
      welcome: 'Welcome to Vidalyzer! Grow now! 🎉',
    };
    const fallback = fallbacks[type] || 'Boost your channels now! 🚀';
    console.log(`Using fallback message for ${type}: ${fallback}`);
    return fallback;
  }
}

// Send push notification via OneSignal with retry mechanism
async function sendNotification(message, target = 'All', oneSignalId = null, type = 'ad', userId = null, coins = 0, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!ONESIGNAL_API_KEY || !ONESIGNAL_APP_ID) {
        throw new Error('OneSignal credentials are not set');
      }
      if (oneSignalId && !isValidOneSignalId(oneSignalId)) {
        console.warn(`Invalid oneSignalId format: ${oneSignalId}`);
        return false;
      }
      console.log('Preparing to send notification:', { message, target, oneSignalId, type, userId, coins });

      const notificationData = {
        app_id: ONESIGNAL_APP_ID,
        contents: { en: message },
        headings: { en: 'Vidalyzer Success! 🎯' },
      };
      if (oneSignalId) {
        notificationData.include_player_ids = [oneSignalId];
      } else {
        notificationData.included_segments = [target];
      }

      const response = await axios.post(
        'https://onesignal.com/api/v1/notifications',
        notificationData,
        {
          headers: {
            Authorization: `Basic ${ONESIGNAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.id) {
        console.log(`Notification sent successfully to ${oneSignalId || target}: ${message}`, {
          notificationId: response.data.id,
          recipients: response.data.recipients,
        });
        await saveNotificationToFirestore(message, type, userId, true);
        if (userId) {
          await updateNotificationTracking(userId, type);
        }
        return true;
      } else {
        console.error('Notification sent but no ID returned:', response.data);
        await saveNotificationToFirestore(message, type, userId, false);
        return false;
      }
    } catch (error) {
      console.error('Error sending notification (attempt ' + (i + 1) + '):', {
        message,
        target,
        oneSignalId,
        type,
        userId,
        error: error.response ? error.response.data : error.message,
        status: error.response ? error.response.status : null,
        stack: error.stack,
      });
      if (i < retries - 1 && error.response?.status === 429) {
        console.log(`Rate limited, retrying in ${i + 1}s...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } else {
        await saveNotificationToFirestore(message, type, userId, false);
        return false;
      }
    }
  }
  await saveNotificationToFirestore(message, type, userId, false);
  return false;
}

// Save notification to Firestore
async function saveNotificationToFirestore(message, type, userId, success) {
  try {
    const collectionName = `${type}_notifications`;
    const docId = new Date().toISOString().replace(/[:.]/g, '-');
    await db.collection(collectionName).doc(docId).set({
      message,
      type,
      userId: userId || null,
      timestamp: new Date().toISOString(),
      success,
    });
    console.log(`Notification saved to ${collectionName}/${docId}:`, { message, userId, success });
  } catch (error) {
    console.error(`Error saving notification to Firestore for ${type}:`, error.message, error.stack);
  }
}

// Check and update ad watch status
async function checkAdStatus(userId) {
  if (!userId) {
    console.error('Invalid userId in checkAdStatus');
    return null;
  }
  console.log(`Checking ad status for user: ${userId}`);
  const userRef = db.collection('users').doc(userId);
  const doc = await userRef.get();
  if (!doc.exists) {
    await userRef.set(
      {
        adsWatched: 0,
        lastAdTime: null,
        coins: 0,
        recentRewards: [],
        oneSignalId: '',
        adCooldownEndTime: null,
        firstLogin: true,
        adNotificationCount: 0,
        lastAdNotificationDate: '',
        welcomeSent: false,
        lastMotivationalSent: 0,
        lastSubscriptionSent: 0,
        lastCoinPurchaseSent: 0,
        lastCooldownSent: 0,
      },
      { merge: true }
    );
    console.log(`Initialized user document for ${userId}`);
    return {
      adsWatched: 0,
      lastAdTime: null,
      coins: 0,
      recentRewards: [],
      oneSignalId: '',
      adCooldownEndTime: null,
      firstLogin: true,
      adNotificationCount: 0,
      lastAdNotificationDate: '',
      welcomeSent: false,
      lastMotivationalSent: 0,
      lastSubscriptionSent: 0,
      lastCoinPurchaseSent: 0,
      lastCooldownSent: 0,
    };
  }
  const data = doc.data();
  console.log(`User data retrieved:`, { userId, adsWatched: data.adsWatched, oneSignalId: data.oneSignalId, adNotificationCount: data.adNotificationCount });
  return data;
}

// Award coins and handle rewards
async function awardCoins(userId) {
  console.log(`Awarding coins for user: ${userId}`);
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`awardCoins: Invalid user data for user ${userId}`);
    return { coins: 0, message: 'Invalid user data', error: 'User data not found' };
  }
  if (userData.adsWatched < ADS_TO_WATCH) {
    console.log(`awardCoins: Not enough ads watched for user ${userId}, adsWatched: ${userData.adsWatched}`);
    return { coins: 0, message: 'Watch 10 ads to earn coins!' };
  }

  try {
    const coins = Math.floor(Math.random() * (25 - 10 + 1)) + 10;
    const newCoins = userData.coins + coins;
    const rewards = userData.recentRewards || [];
    const newReward = {
      name: `${coins} Coins`,
      timestamp: new Date().toISOString()
    };
    rewards.unshift(newReward);
    if (rewards.length > 5) rewards.pop();

    const updateData = {
      adsWatched: 0,
      lastAdTime: new Date().toISOString(),
      adCooldownEndTime: Date.now() + COOLDOWN_MINUTES * 60 * 1000,
      coins: newCoins,
      recentRewards: rewards
    };

    console.log(`Attempting to update user ${userId} with data:`, updateData);
    await db.collection('users').doc(userId).update(updateData);
    console.log(`Successfully awarded ${coins} coins to user ${userId}`);

    // Send coin_purchase notification
    if (userData.oneSignalId && isValidOneSignalId(userData.oneSignalId) && (await canSendNotification(userId, 'coin_purchase'))) {
      const message = await generateNotificationMessage('coin_purchase', userId, coins);
      await saveNotificationToFirestore(message, 'coin_purchase', userId, false);
      const success = await sendNotification(message, null, userData.oneSignalId, 'coin_purchase', userId, coins);
      console.log(`Coin purchase notification ${success ? 'sent' : 'failed'} to ${userId}, message: ${message}`);
    }

    return { coins, message: `Earned ${coins} coins! Elevate your growth! 🎉` };
  } catch (error) {
    console.error(`Error awarding coins for user ${userId}:`, {
      message: error.message,
      code: error.code,
      stack: error.stack,
      userId,
      adsWatched: userData.adsWatched,
      coins: userData.coins
    });
    return {
      coins: 0,
      message: 'Failed to save reward. Please try again.',
      error: error.message || 'Unknown error saving reward'
    };
  }
}

// Schedule notifications for motivational and subscription
async function scheduleNotifications() {
  const notificationTypes = ['motivational', 'subscription'];
  const randomType = notificationTypes[Math.floor(Math.random() * notificationTypes.length)];
  console.log(`Scheduling ${randomType} notification at ${getIstTime()}`);

  cron.schedule('0 0 * * * *', async () => {
    console.log(`${randomType} notification triggered at ${getIstTime()}`);
    const usersSnapshot = await db.collection('users').where('oneSignalId', '!=', '').get();
    for (const doc of usersSnapshot.docs) {
      const userId = doc.id;
      const userData = doc.data();
      if (isValidOneSignalId(userData.oneSignalId) && (await canSendNotification(userId, randomType))) {
        const message = await generateNotificationMessage(randomType, userId);
        await saveNotificationToFirestore(message, randomType, userId, false);
        const success = await sendNotification(message, null, userData.oneSignalId, randomType, userId);
        console.log(`${randomType} notification ${success ? 'sent' : 'failed'} to ${userId}: ${message}`);
      }
    }
  }, { scheduled: true, timezone: 'Asia/Kolkata' });
}

// Reset ad notification counts daily
cron.schedule('0 0 0 * * *', async () => {
  console.log('Resetting ad notification counts at', getIstTime());
  const usersSnapshot = await db.collection('users').get();
  const batch = db.batch();
  usersSnapshot.forEach(doc => {
    const userRef = db.collection('users').doc(doc.id);
    batch.update(userRef, { adNotificationCount: 0, lastAdNotificationDate: '' });
  });
  await batch.commit();
  console.log('Ad notification counts reset for all users');
}, { scheduled: true, timezone: 'Asia/Kolkata' });

// API endpoints
app.post('/watch-ad', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    console.error('watch-ad: Missing userId');
    return res.status(400).send('User ID required');
  }
  console.log(`watch-ad endpoint called for user: ${userId}`);
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`watch-ad: Failed to access user data for ${userId}`);
    return res.status(500).send('Error accessing user data');
  }
  const now = new Date();
  const lastAdTime = userData.lastAdTime ? new Date(userData.lastAdTime) : null;
  const cooldownElapsed = !lastAdTime || (now - lastAdTime) / (1000 * 60) >= COOLDOWN_MINUTES;

  if (userData.adsWatched < ADS_TO_WATCH && cooldownElapsed) {
    await db.collection('users').doc(userId).update({
      adsWatched: userData.adsWatched + 1,
    });
    console.log(`Ad watched for user ${userId}: ${userData.adsWatched + 1}/${ADS_TO_WATCH}`);
    res.send({ message: `Ad ${userData.adsWatched + 1}/${ADS_TO_WATCH} watched! Grow soon!` });
  } else if (!cooldownElapsed) {
    console.log(`watch-ad: Cooldown active for user ${userId}`);
    res.status(429).send({ message: `Cooldown active. Wait ${COOLDOWN_MINUTES} minutes.` });
  } else {
    const { coins, message, error } = await awardCoins(userId);
    console.log(`watch-ad: Award result for ${userId}: ${message}, coins: ${coins}, error: ${error || 'none'}`);
    if (error) {
      res.status(500).send({ message, error });
    } else {
      res.send({ message, coins });
    }
  }
});

app.post('/buy-feature', async (req, res) => {
  const { userId, feature, quantity } = req.body;
  if (!userId || !feature || !quantity) {
    console.error('buy-feature: Missing parameters', { userId, feature, quantity });
    return res.status(400).send('User ID, feature, and quantity required');
  }
  console.log(`buy-feature endpoint called:`, { userId, feature, quantity });
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`buy-feature: Failed to access user data for ${userId}`);
    return res.status(500).send('Error accessing user data');
  }
  let cost = 0;
  switch (feature) {
    case 'instagram_followers':
      cost = quantity * 10;
      break;
    case 'instagram_likes':
      cost = quantity * 5;
      break;
    case 'youtube_subscribers':
      cost = quantity * 20;
      break;
    case 'youtube_likes':
      cost = quantity * 8;
      break;
    default:
      console.error(`buy-feature: Invalid feature ${feature} for user ${userId}`);
      return res.status(400).send('Invalid feature');
  }

  if (userData.coins >= cost) {
    await db.collection('users').doc(userId).update({
      coins: userData.coins - cost,
      recentRewards: [...(userData.recentRewards || []), { name: `${quantity} ${feature}`, timestamp: new Date().toISOString() }].slice(-5),
    });
    console.log(`buy-feature: Purchased ${quantity} ${feature} for user ${userId}, cost: ${cost}`);
    res.send({ message: `Bought ${quantity} ${feature} to skyrocket growth!` });
  } else {
    console.log(`buy-feature: Insufficient coins for user ${userId}, needed: ${cost}, available: ${userData.coins}`);
    res.status(402).send({ message: 'Need more coins to grow!' });
  }
});

app.post('/update-onesignal', async (req, res) => {
  const { userId, oneSignalId } = req.body;
  if (!userId || !oneSignalId) {
    console.error(`update-onesignal: Missing parameters: userId=${userId}, oneSignalId=${oneSignalId}`);
    return res.status(400).send('User ID and OneSignal ID required');
  }
  if (!isValidOneSignalId(oneSignalId)) {
    console.warn(`update-onesignal: Invalid oneSignalId format for user ${userId}: ${oneSignalId}`);
    return res.status(400).send('Invalid OneSignal ID format');
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    const currentData = userDoc.exists ? userDoc.data() : {};
    console.log(`Current oneSignalId for ${userId}: ${currentData.oneSignalId}`);

    if (oneSignalId && oneSignalId !== currentData.oneSignalId) {
      await userRef.set({ oneSignalId }, { merge: true });
      console.log(`update-onesignal: Updated oneSignalId for user ${userId} to ${oneSignalId}`);
    }

    if (userDoc.exists && userDoc.data().firstLogin && !(userDoc.data().welcomeSent || false)) {
      const welcomeMessage = await generateNotificationMessage('welcome', userId);
      await saveNotificationToFirestore(welcomeMessage, 'welcome', userId, false);
      const success = await sendNotification(welcomeMessage, null, oneSignalId, 'welcome', userId);
      console.log(`Welcome notification ${success ? 'sent' : 'failed'} to ${userId} on first login`);
      await userRef.update({ firstLogin: false, welcomeSent: true });
    }

    res.send({ message: 'OneSignal ID updated successfully' });
  } catch (error) {
    console.error(`update-onesignal: Error updating oneSignalId for user ${userId}:`, error.message, error.stack);
    res.status(500).send('Error updating OneSignal ID');
  }
});

app.post('/test-notification', async (req, res) => {
  const { userId, type = 'ad', coins = 0 } = req.body;
  if (!userId) {
    console.error('test-notification: Missing userId');
    return res.status(400).send('User ID required');
  }
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || !userDoc.data().oneSignalId) {
      console.error(`test-notification: User not found or no oneSignalId for ${userId}`);
      return res.status(404).send('User not found or no oneSignalId');
    }
    const oneSignalId = userDoc.data().oneSignalId;
    if (!isValidOneSignalId(oneSignalId)) {
      console.warn(`test-notification: Invalid oneSignalId format for ${userId}: ${oneSignalId}`);
      return res.status(400).send('Invalid oneSignalId format');
    }
    if (!(await canSendNotification(userId, type))) {
      console.log(`test-notification: Notification limit reached for ${userId}, type ${type}`);
      return res.status(429).send('Notification limit reached');
    }
    const message = await generateNotificationMessage(type, userId, coins);
    await saveNotificationToFirestore(message, type, userId, false);
    const success = await sendNotification(message, null, oneSignalId, type, userId, coins);
    res.send({
      message: success ? 'Notification sent successfully' : 'Failed to send notification',
      details: { userId, oneSignalId, message, type, coins },
    });
  } catch (error) {
    console.error('test-notification: Error:', error.message, error.stack);
    res.status(500).send('Error sending test notification');
  }
});

// Premium snapshot listener for subscription notifications
db.collection('Premium').onSnapshot(
  (snapshot) => {
    console.log('Premium snapshot triggered at', getIstTime(), 'changes:', snapshot.docChanges().length);
    if (snapshot.docChanges().length === 0) {
      console.log('No changes in Premium snapshot');
      return;
    }
    snapshot.docChanges().forEach(async (change) => {
      try {
        const data = change.doc.data();
        const userId = data.userId || change.doc.id;
        console.log('Processing Premium change:', { userId, type: change.type, data });
        if (!userId) {
          console.error('Invalid or missing userId in Premium snapshot:', change.doc.id, data);
          return;
        }

        const snapshotKey = `${userId}:${change.type}:${data.subscriptionType || 'unknown'}:${change.doc.id}`;
        const lastProcessed = processedSnapshots.get(snapshotKey);
        const now = Date.now();
        if (lastProcessed && now - lastProcessed < 300000) {
          console.log(`Skipping duplicate Premium snapshot for doc ${change.doc.id}, user ${userId}`);
          return;
        }
        processedSnapshots.set(snapshotKey, now);
        setTimeout(() => processedSnapshots.delete(snapshotKey), 300000);

        if (change.type === 'added' || (change.type === 'modified' && data.isPremiumUser)) {
          console.log(`Processing subscription for user ${userId}, type: ${data.subscriptionType || 'unknown'}`);
          if (!data.userId) {
            await db.collection('Premium').doc(change.doc.id).update({ userId });
            console.log(`Fixed missing userId for Premium doc ${change.doc.id}`);
          }

          const userDoc = await db.collection('users').doc(userId).get();
          if (userDoc.exists && userDoc.data().oneSignalId && isValidOneSignalId(userDoc.data().oneSignalId) && (await canSendNotification(userId, 'subscription'))) {
            const oneSignalId = userDoc.data().oneSignalId;
            const message = await generateNotificationMessage('subscription', userId);
            await saveNotificationToFirestore(message, 'subscription', userId, false);
            const success = await sendNotification(message, null, oneSignalId, 'subscription', userId);
            console.log(`Subscription notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}`);
          } else {
            console.warn(`No valid oneSignalId or limit reached for user ${userId}`, {
              userId,
              exists: userDoc.exists,
              oneSignalId: userDoc.data()?.oneSignalId,
            });
          }
        }
      } catch (error) {
        console.error('Error in Premium snapshot listener for doc', change.doc.id, ':', error.message, error.stack);
      }
    });
  },
  (error) => {
    console.error('Premium snapshot listener failed:', error.message, error.stack);
  }
);

// Users snapshot listener for cooldown and ad notifications
db.collection('users').onSnapshot(
  (snapshot) => {
    console.log('Users snapshot triggered at', getIstTime(), 'changes:', snapshot.docChanges().length);
    if (snapshot.docChanges().length === 0) {
      console.log('No changes in users snapshot');
      return;
    }
    snapshot.docChanges().forEach(async (change) => {
      try {
        const userId = change.doc.id;
        console.log('Processing user change:', { userId, type: change.type, data: change.doc.data() });
        if (!userId) {
          console.error('Invalid userId in users snapshot:', change.doc.id);
          return;
        }
        const userData = change.doc.data();
        const oneSignalId = userData.oneSignalId;

        // Schedule ad notifications (3 per day)
        if ((change.type === 'added' || change.type === 'modified') && userData.adNotificationCount < 3 && oneSignalId && isValidOneSignalId(oneSignalId) && (await canSendNotification(userId, 'ad'))) {
          const adNotificationInterval = Math.floor(Math.random() * (120 - 60 + 1)) + 60; // 1-2 hours
          setTimeout(async () => {
            if (await canSendNotification(userId, 'ad')) {
              const message = await generateNotificationMessage('ad', userId);
              await saveNotificationToFirestore(message, 'ad', userId, false);
              const success = await sendNotification(message, null, oneSignalId, 'ad', userId);
              console.log(`Ad notification ${success ? 'sent' : 'failed'} to ${userId}, count: ${userData.adNotificationCount + 1}`);
            }
          }, adNotificationInterval * 60 * 1000);
        }

        // Handle cooldown notifications
        if ((change.type === 'added' || change.type === 'modified') && userData.adCooldownEndTime && oneSignalId && isValidOneSignalId(oneSignalId)) {
          const now = Date.now();
          const cooldownEndTime = userData.adCooldownEndTime;
          const timeUntilCooldownEnds = cooldownEndTime - now;

          console.log(`Current time: ${now}, cooldownEndTime: ${cooldownEndTime}, timeUntilCooldownEnds: ${timeUntilCooldownEnds}ms`);
          if (timeUntilCooldownEnds > 0 && timeUntilCooldownEnds < 24 * 60 * 60 * 1000) {
            console.log(`Scheduling cooldown notification for ${userId} in ${timeUntilCooldownEnds / 1000} seconds`);
            setTimeout(async () => {
              const userDoc = await db.collection('users').doc(userId).get();
              if (userDoc.exists && userDoc.data().adCooldownEndTime <= Date.now() && userData.adsWatched >= ADS_TO_WATCH && (await canSendNotification(userId, 'cooldown'))) {
                const message = await generateNotificationMessage('cooldown', userId);
                await saveNotificationToFirestore(message, 'cooldown', userId, false);
                const success = await sendNotification(message, null, oneSignalId, 'cooldown', userId);
                console.log(`Cooldown notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}`);
                await db.collection('users').doc(userId).update({ adCooldownEndTime: null });
              } else {
                console.log(`Cooldown notification skipped for ${userId}: exists=${userDoc.exists}, currentTime=${Date.now()}, cooldownEndTime=${userDoc.data()?.adCooldownEndTime}, adsWatched=${userData.adsWatched}`);
              }
            }, timeUntilCooldownEnds);
          } else if (timeUntilCooldownEnds <= 0 && userData.adsWatched >= ADS_TO_WATCH && (await canSendNotification(userId, 'cooldown'))) {
            console.log(`Cooldown already expired for ${userId}, sending immediate notification`);
            const message = await generateNotificationMessage('cooldown', userId);
            await saveNotificationToFirestore(message, 'cooldown', userId, false);
            const success = await sendNotification(message, null, oneSignalId, 'cooldown', userId);
            console.log(`Immediate cooldown notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}, message: ${message}`);
            await db.collection('users').doc(userId).update({ adCooldownEndTime: null });
          }
        }
      } catch (error) {
        console.error('Error in users snapshot for user', change.doc.id, ':', error.message, error.stack);
      }
    });
  },
  (error) => {
    console.error('Users snapshot listener failed:', error.message, error.stack);
  }
);

app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.get('/ping', (req, res) => res.send('OK'));
try {
  app.listen(port, () => {
    console.log(`Server running on port ${port} at ${getIstTime()}`);
    scheduleNotifications();
  });
} catch (error) {
  console.error('Failed to start server:', error.message, error.stack);
  process.exit(1);
}

setInterval(() => {
  console.log(`Pinging self at ${getIstTime()} to keep instance alive`);
  axios
    .get(`${RENDER_URL}/ping`)
    .catch((err) => console.error('Ping failed:', err.message, err.stack));
}, 5 * 60 * 1000);

// Constants and helper functions
const ADS_TO_WATCH = 10;
const COOLDOWN_MINUTES = 15;
const processedSnapshots = new Map();

function isValidOneSignalId(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

process.env.TZ = 'Asia/Kolkata';
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RENDER_URL = process.env.RENDER_URL || 'https://vidalyzer-backend.onrender.com';

// Environment variable validation
if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY || !OPENAI_API_KEY || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Missing required environment variables:', {
    ONESIGNAL_APP_ID: !!ONESIGNAL_APP_ID,
    ONESIGNAL_API_KEY: !!ONESIGNAL_API_KEY,
    OPENAI_API_KEY: !!OPENAI_API_KEY,
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  });
  process.exit(1);
}

console.log('Server starting at', new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
console.log('Timezone:', process.env.TZ);