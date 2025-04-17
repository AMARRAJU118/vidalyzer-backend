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
  console.error('Firebase initialization failed:', error.message);
  process.exit(1);
}
const db = getFirestore();

// Environment variables with validation
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || 'd2288872-b12c-4974-af8c-e98665ea2564';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RAILWAY_URL = process.env.RAILWAY_URL || 'https://vidalyzer-backend-production.up.railway.app';

if (!ONESIGNAL_API_KEY) {
  console.error('ONESIGNAL_API_KEY is required but not set. Exiting.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required but not set. Exiting.');
  process.exit(1);
}
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Firebase credentials incomplete. Exiting.');
  process.exit(1);
}

// Ad and coin tracking constants
const ADS_TO_WATCH = 10;
const COOLDOWN_MINUTES = 15;

// Track processed snapshots
const processedSnapshots = new Map();

// Validate oneSignalId format (UUID-like)
function isValidOneSignalId(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

// Log server startup and timezone
console.log('Server starting at', new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
console.log('Timezone:', process.env.TZ || 'Not set');

// Generate notification message with varied tones
async function generateNotificationMessage(type = 'ad', userId = null) {
  console.log(`Generating notification for type: ${type}, userId: ${userId || 'none'}`);
  try {
    let prompt;
    const tones = ['friend', 'girlfriend', 'boyfriend'];
    const randomTone = tones[Math.floor(Math.random() * tones.length)];

    switch (type) {
      case 'ad':
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user to watch ads for coins to grow YouTube/Instagram. Examples: Friend: "Yo, watch ads & boost your Insta!", Girlfriend: "Babe, ads = coins for your reels! 😘", Boyfriend: "Hey, watch ads to grow big! 💪"`;
        break;
      case 'cooldown':
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user noting ad cooldown is over. Examples: Friend: "Cooldown done! Watch ads now! 😎", Girlfriend: "Sweetie, ads are back! Go for it! 💖", Boyfriend: "Cooldown over, champ! Ads time! 🏆"`;
        break;
      case 'motivational':
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user to motivate daily app use or content creation for YouTube/Instagram SEO. Examples: Friend: "Uploaded a vid today? Use Vidalyzer! 🚀", Girlfriend: "Hey love, post a reel & boost SEO! 😍", Boyfriend: "Man, use Vidalyzer for epic YouTube growth! 🔥"`;
        break;
      case 'subscription':
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user celebrating a new subscription. Examples: Friend: "Yo, you're premium now! Rock it! 🎉", Girlfriend: "OMG babe, premium vibes! So proud! 😘", Boyfriend: "Premium status, bro! You're a star! 🌟"`;
        break;
      case 'coin_purchase':
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user celebrating coin purchases. Examples: Friend: "Nice! Coins for your growth! 🙌", Girlfriend: "Sweetie, those coins are 🔥! Love it!", Boyfriend: "Coins grabbed, dude! Let's grow! 💪"`;
        break;
      default:
        prompt = `Generate a ${randomTone}-style push notification (max 50 chars) for an Indian Vidalyzer user to motivate app use. Examples: Friend: "Let's grow your channel today! 😎", Girlfriend: "Hey cutie, boost your reels now! 🥰", Boyfriend: "Get on Vidalyzer, king! Skyrocket! 🚀"`;
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
    const message = response.data.choices[0].message.content.trim();
    console.log(`Generated message for ${type}: ${message}`);
    return message.length <= 50 ? message : message.substring(0, 50).trim() + '…';
  } catch (error) {
    console.error(`Error generating notification for type ${type}:`, error.response ? error.response.data : error.message);
    const fallbacks = {
      ad: ['Yo, watch ads & boost your Insta!', 'Babe, ads = coins for your reels! 😘', 'Hey, watch ads to grow big! 💪'],
      cooldown: ['Cooldown done! Watch ads now! 😎', 'Sweetie, ads are back! Go for it! 💖', 'Cooldown over, champ! Ads time! 🏆'],
      motivational: ['Uploaded a vid today? Use Vidalyzer! 🚀', 'Hey love, post a reel & boost SEO! 😍', 'Man, use Vidalyzer for epic YouTube growth! 🔥'],
      subscription: ['Yo, you’re premium now! Rock it! 🎉', 'OMG babe, premium vibes! So proud! 😘', 'Premium status, bro! You’re a star! 🌟'],
      coin_purchase: ['Nice! Coins for your growth! 🙌', 'Sweetie, those coins are 🔥! Love it!', 'Coins grabbed, dude! Let’s grow! 💪'],
    };
    const fallback = fallbacks[type] ? fallbacks[type][Math.floor(Math.random() * fallbacks[type].length)] : 'Hey cutie, boost your reels now! 🥰';
    console.log(`Using fallback message for ${type}: ${fallback}`);
    return fallback;
  }
}

// Send push notification via OneSignal
async function sendNotification(message, target = 'All', oneSignalId = null) {
  try {
    if (!ONESIGNAL_API_KEY) throw new Error('ONESIGNAL_API_KEY is not set');
    if (oneSignalId && !isValidOneSignalId(oneSignalId)) {
      console.warn(`Invalid oneSignalId format: ${oneSignalId}`);
      return false;
    }
    console.log('Attempting to send notification:', { message, target, oneSignalId });
    const notificationData = {
      app_id: ONESIGNAL_APP_ID,
      contents: { en: message },
      headings: { en: 'Vidalyzer Boost! 🎉' },
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
    console.log(`Notification sent successfully to ${oneSignalId || target}: ${message}`, response.data);
    return true;
  } catch (error) {
    console.error('Error sending notification:', {
      message,
      target,
      oneSignalId,
      error: error.response ? error.response.data : error.message,
    });
    return false;
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
      { adsWatched: 0, lastAdTime: null, coins: 0, recentRewards: [], oneSignalId: '' },
      { merge: true }
    );
    console.log(`Initialized user document for ${userId}`);
    return { adsWatched: 0, lastAdTime: null, coins: 0, recentRewards: [], oneSignalId: '' };
  }
  const data = doc.data();
  console.log(`User data retrieved:`, { userId, adsWatched: data.adsWatched, oneSignalId: data.oneSignalId });
  return data;
}

// Award coins and handle rewards
async function awardCoins(userId) {
  console.log(`Awarding coins for user: ${userId}`);
  const userData = await checkAdStatus(userId);
  if (!userData) return { coins: 0, message: 'Invalid user data' };
  if (userData.adsWatched >= ADS_TO_WATCH) {
    const coins = Math.floor(Math.random() * (25 - 10 + 1)) + 10;
    const newCoins = userData.coins + coins;
    const rewards = userData.recentRewards || [];
    rewards.unshift({ name: `${coins} Coins`, timestamp: new Date().toISOString() });
    if (rewards.length > 5) rewards.pop();

    await db.collection('users').doc(userId).update({
      adsWatched: 0,
      lastAdTime: new Date().toISOString(),
      adCooldownEndTime: Date.now() + COOLDOWN_MINUTES * 60 * 1000,
      coins: newCoins,
      recentRewards: rewards,
    });
    console.log(`Awarded ${coins} coins to user ${userId}`);
    return { coins, message: `Wow! Earned ${coins} coins to grow! 🎉` };
  }
  return { coins: 0, message: 'Watch 10 ads to grow your channels!' };
}

// Schedule notifications for IST
const getIstTime = () => new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

// Test cron to verify OneSignal (every 5 minutes)
cron.schedule('*/5 * * * *', async () => {
  console.log('Test cron triggered at', getIstTime());
  const success = await sendNotification('Test notification from Vidalyzer!', 'Active Users');
  console.log(`Test notification ${success ? 'sent' : 'failed'} at ${getIstTime()}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

// Schedule ad notifications: 10 AM, 2 PM, 6 PM IST
cron.schedule('0 10 * * *', async () => {
  console.log('Ad cron (10 AM) triggered at', getIstTime());
  const adMessage = await generateNotificationMessage('ad');
  const success = await sendNotification(adMessage, 'Active Users');
  console.log(`Ad notification ${success ? 'sent' : 'failed'} at ${getIstTime()}: ${adMessage}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

cron.schedule('0 14 * * *', async () => {
  console.log('Ad cron (2 PM) triggered at', getIstTime());
  const adMessage = await generateNotificationMessage('ad');
  const success = await sendNotification(adMessage, 'Active Users');
  console.log(`Ad notification ${success ? 'sent' : 'failed'} at ${getIstTime()}: ${adMessage}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

cron.schedule('0 18 * * *', async () => {
  console.log('Ad cron (6 PM) triggered at', getIstTime());
  const adMessage = await generateNotificationMessage('ad');
  const success = await sendNotification(adMessage, 'Active Users');
  console.log(`Ad notification ${success ? 'sent' : 'failed'} at ${getIstTime()}: ${adMessage}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

// Schedule motivational notifications: 9 AM, 4 PM IST
cron.schedule('0 9 * * *', async () => {
  console.log('Motivational cron (9 AM) triggered at', getIstTime());
  const motivationalMessage = await generateNotificationMessage('motivational');
  const success = await sendNotification(motivationalMessage, 'Active Users');
  console.log(`Motivational notification ${success ? 'sent' : 'failed'} at ${getIstTime()}: ${motivationalMessage}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

cron.schedule('0 16 * * *', async () => {
  console.log('Motivational cron (4 PM) triggered at', getIstTime());
  const motivationalMessage = await generateNotificationMessage('motivational');
  const success = await sendNotification(motivationalMessage, 'Active Users');
  console.log(`Motivational notification ${success ? 'sent' : 'failed'} at ${getIstTime()}: ${motivationalMessage}`);
}, { scheduled: true, timezone: 'Asia/Kolkata' });

// API endpoint to track ad watching
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
    const { coins, message } = await awardCoins(userId);
    console.log(`watch-ad: Award result for ${userId}: ${message}, coins: ${coins}`);
    res.send({ message, coins });
  }
});

// API endpoint to spend coins
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
    case 'followers':
      cost = quantity * 10;
      break;
    case 'subscribers':
      cost = quantity * 20;
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

// API endpoint to update oneSignalId
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
    console.log(`update-onesignal: Updated oneSignalId for user ${userId}: ${oneSignalId}`);
    res.send({ message: 'OneSignal ID updated successfully' });
  } catch (error) {
    console.error(`update-onesignal: Error updating oneSignalId for user ${userId}:`, error.message);
    res.status(500).send('Error updating OneSignal ID');
  }
});

// Firestore listener for new subscriptions
db.collection('Premium').onSnapshot(
  (snapshot) => {
    console.log('Premium snapshot triggered at', getIstTime(), 'changes:', snapshot.docChanges().length);
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
          if (userDoc.exists && userDoc.data().oneSignalId && isValidOneSignalId(userDoc.data().oneSignalId)) {
            const oneSignalId = userDoc.data().oneSignalId;
            const message = await generateNotificationMessage('subscription');
            const success = await sendNotification(message, null, oneSignalId);
            console.log(`Subscription notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}`);
          } else {
            console.warn(`No valid oneSignalId found for user ${userId}`, {
              userId,
              exists: userDoc.exists,
              oneSignalId: userDoc.data()?.oneSignalId,
            });
          }
        }
      } catch (error) {
        console.error('Error in Premium snapshot listener for doc', change.doc.id, ':', error.message);
      }
    });
  },
  (error) => {
    console.error('Premium snapshot listener failed:', error.message);
  }
);

// Firestore listener for coin purchases and cooldown
db.collection('users').onSnapshot(
  (snapshot) => {
    console.log('Users snapshot triggered at', getIstTime(), 'changes:', snapshot.docChanges().length);
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

        if (change.type === 'modified') {
          const oldData = change.oldIndex !== -1 ? snapshot.docs[change.oldIndex].data() : {};
          if (userData.coins > (oldData.coins || 0) && !userData.lastAdTime && oneSignalId && isValidOneSignalId(oneSignalId)) {
            const message = await generateNotificationMessage('coin_purchase');
            const success = await sendNotification(message, null, oneSignalId);
            console.log(`Coin purchase notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}`);
          }
        }

        if ((change.type === 'added' || change.type === 'modified') && userData.adCooldownEndTime && oneSignalId && isValidOneSignalId(oneSignalId)) {
          const now = Date.now();
          const cooldownEndTime = userData.adCooldownEndTime;
          const timeUntilCooldownEnds = cooldownEndTime - now;

          if (timeUntilCooldownEnds > 0 && timeUntilCooldownEnds < 24 * 60 * 60 * 1000) {
            console.log(`Scheduling cooldown notification for ${userId} in ${timeUntilCooldownEnds / 1000} seconds`);
            setTimeout(async () => {
              const userDoc = await db.collection('users').doc(userId).get();
              if (userDoc.exists && userDoc.data().adCooldownEndTime <= Date.now()) {
                const message = await generateNotificationMessage('cooldown');
                const success = await sendNotification(message, null, oneSignalId);
                console.log(`Cooldown notification ${success ? 'sent' : 'failed'} to ${userId}, oneSignalId: ${oneSignalId}`);
              } else {
                console.log(`Cooldown notification skipped for ${userId}: userDoc exists=${userDoc.exists}, cooldownEndTime=${userDoc.data()?.adCooldownEndTime}`);
              }
            }, timeUntilCooldownEnds);
          }
        }
      } catch (error) {
        console.error('Error in users snapshot for user', change.doc.id, ':', error.message);
      }
    });
  },
  (error) => {
    console.error('Users snapshot listener failed:', error.message);
  }
);

// Start server with health check
app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.get('/ping', (req, res) => res.send('OK'));
try {
  app.listen(port, () => {
    console.log(`Server running on port ${port} at ${getIstTime()}`);
  });
} catch (error) {
  console.error('Failed to start server:', error.message);
  process.exit(1);
}

// Keep server alive (ping every 5 minutes)
setInterval(() => {
  console.log(`Pinging self at ${getIstTime()} to keep instance alive`);
  axios
    .get(`${RAILWAY_URL}/ping`)
    .catch((err) => console.error('Ping failed:', err.message));
}, 5 * 60 * 1000);