const express = require('express');
const axios = require('axios');
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

// Send push notification via OneSignal with retry mechanism
async function sendNotification(message, oneSignalId, userId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!ONESIGNAL_API_KEY || !ONESIGNAL_APP_ID) {
        throw new Error('OneSignal credentials are not set');
      }
      if (!isValidOneSignalId(oneSignalId)) {
        console.warn(`Invalid oneSignalId format: ${oneSignalId}`);
        return false;
      }
      console.log('Preparing to send cooldown notification:', { message, oneSignalId, userId });

      const notificationData = {
        app_id: ONESIGNAL_APP_ID,
        contents: { en: message },
        headings: { en: 'Vidalyzer Alert! ⏰' },
        android_accent_color: 'FF0000',
        android_channel_id: 'fcm_default_channel',
        ios_sound: 'default',
        android_sound: 'default',
        android_vibrate: [0, 1000, 1000, 1000],
        small_icon: 'ic_notification',
        large_icon: 'ic_notification_large',
        include_player_ids: [oneSignalId],
      };

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
        console.log(`Cooldown notification sent to ${oneSignalId}: ${message}`, {
          notificationId: response.data.id,
          recipients: response.data.recipients,
        });
        await saveNotificationToFirestore(message, 'cooldown', userId, true);
        return true;
      } else {
        console.error('Notification sent but no ID returned:', response.data);
        await saveNotificationToFirestore(message, 'cooldown', userId, false);
        return false;
      }
    } catch (error) {
      console.error('Error sending cooldown notification (attempt ' + (i + 1) + '):', {
        message,
        oneSignalId,
        userId,
        error: error.response ? error.response.data : error.message,
        status: error.response ? error.response.status : null,
        stack: error.stack,
      });
      if (i < retries - 1 && error.response?.status === 429) {
        console.log(`Rate limited, retrying in ${i + 1}s...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } else {
        await saveNotificationToFirestore(message, 'cooldown', userId, false);
        return false;
      }
    }
  }
  await saveNotificationToFirestore(message, 'cooldown', userId, false);
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
    };
  }
  const data = doc.data();
  console.log(`User data retrieved:`, { userId, adsWatched: data.adsWatched, oneSignalId: data.oneSignalId });
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
      timestamp: new Date().toISOString(),
    };
    rewards.unshift(newReward);
    if (rewards.length > 5) rewards.pop();

    const updateData = {
      adsWatched: 0,
      lastAdTime: new Date().toISOString(),
      adCooldownEndTime: Date.now() + COOLDOWN_MINUTES * 60 * 1000,
      coins: newCoins,
      recentRewards: rewards,
    };

    console.log(`Attempting to update user ${userId} with data:`, updateData);
    await db.collection('users').doc(userId).update(updateData);
    console.log(`Successfully awarded ${coins} coins to user ${userId}`);

    return { coins, message: `Earned ${coins} coins! Elevate your growth! 🎉` };
  } catch (error) {
    console.error(`Error awarding coins for user ${userId}:`, {
      message: error.message,
      code: error.code,
      stack: error.stack,
      userId,
      adsWatched: userData.adsWatched,
      coins: userData.coins,
    });
    return {
      coins: 0,
      message: 'Failed to save reward. Please try again.',
      error: error.message || 'Unknown error saving reward',
    };
  }
}

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
      adsWatched: user    userData.adsWatched + 1,
      lastAdTime: new Date().toISOString(),
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
    await db.collection('users').doc(userId).set({ oneSignalId }, { merge: true });
    console.log(`update-onesignal: Updated oneSignalId for user ${userId} to ${oneSignalId}`);
    res.send({ message: 'OneSignal ID updated successfully' });
  } catch (error) {
    console.error(`update-onesignal: Error updating oneSignalId for user ${userId}:`, error.message, error.stack);
    res.status(500).send('Error updating OneSignal ID');
  }
});

// Users snapshot listener for cooldown notifications
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
        console.log('Processing user change:', { userId, type: change.type });
        if (!userId) {
          console.error('Invalid userId in users snapshot:', change.doc.id);
          return;
        }
        const userData = change.doc.data();
        const oneSignalId = userData.oneSignalId;

        // Handle cooldown notifications
        if ((change.type === 'added' || change.type === 'modified') && userData.adCooldownEndTime && oneSignalId && isValidOneSignalId(oneSignalId)) {
          const now = Date.now();
          const cooldownEndTime = userData.adCooldownEndTime;
          const timeUntilCooldownEnds = cooldownEndTime - now;

          if (timeUntilCooldownEnds > 0 && timeUntilCooldownEnds < 24 * 60 * 60 * 1000) {
            console.log(`Scheduling cooldown notification for ${userId} in ${timeUntilCooldownEnds / 1000} seconds`);
            setTimeout(async () => {
              const userDoc = await db.collection('users').doc(userId).get();
              if (userDoc.exists && userDoc.data().adCooldownEndTime <= Date.now()) {
                const message = 'Cooldown over! Watch ads to earn coins now! ⏰';
                await saveNotificationToFirestore(message, 'cooldown', userId, false);
                const success = await sendNotification(message, oneSignalId, userId);
                console.log(`Cooldown notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}, message: ${message}`);
                await db.collection('users').doc(userId).update({ adCooldownEndTime: null });
              }
            }, timeUntilCooldownEnds);
          } else if (timeUntilCooldownEnds <= 0 && userData.adsWatched >= ADS_TO_WATCH) {
            console.log(`Cooldown already expired for ${userId}, sending immediate notification`);
            const message = 'Cooldown over! Watch ads to earn coins now! ⏰';
            await saveNotificationToFirestore(message, 'cooldown', userId, false);
            const success = await sendNotification(message, oneSignalId, userId);
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
const COOLDOWN_MINUTES = 12;

function isValidOneSignalId(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

process.env.TZ = 'Asia/Kolkata';
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const RENDER_URL = process.env.RENDER_URL || 'https://vidalyzer-backend.onrender.com';

// Environment variable validation
if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Missing required environment variables:', {
    ONESIGNAL_APP_ID: !!ONESIGNAL_APP_ID,
    ONESIGNAL_API_KEY: !!ONESIGNAL_API_KEY,
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  });
  process.exit(1);
}

console.log('Server starting at', new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
console.log('Timezone:', process.env.TZ);