const express = require('express');
const axios = require('axios');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = express();
app.use(express.json());
const port = process.env.PORT || 10000;

// Constants
const ADS_TO_WATCH = 10;
const COOLDOWN_MINUTES = 15;

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

// Helper to get IST time
const getIstTime = () => new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

// Firestore trigger to ensure oneSignalId is set
db.collection('users').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(change => {
    if (change.type === 'added' && !change.doc.data().oneSignalId) {
      const userId = change.doc.id;
      console.log(`Detecting missing oneSignalId for user ${userId} at ${getIstTime()}`);
      const oneSignalId = `simulated-${userId}-${Date.now()}`; // Placeholder
      db.collection('users').doc(userId).set({ oneSignalId }, { merge: true })
        .then(() => console.log(`Set oneSignalId ${oneSignalId} for ${userId}`))
        .catch(err => console.error(`Failed to set oneSignalId for ${userId}:`, err));
    }
  });
});

// Send push notification via OneSignal with retry mechanism
async function sendNotification(message, oneSignalId, userId, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!process.env.ONESIGNAL_API_KEY || !process.env.ONESIGNAL_APP_ID) {
        throw new Error('OneSignal credentials are not set');
      }
      if (!isValidOneSignalId(oneSignalId)) {
        console.warn(`Invalid oneSignalId format: ${oneSignalId} for user ${userId}`);
        return false;
      }
      console.log('Preparing to send notification:', { message, oneSignalId, userId });

      const notificationData = {
        app_id: process.env.ONESIGNAL_APP_ID,
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
            Authorization: `Basic ${process.env.ONESIGNAL_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.data.id) {
        console.log(`Notification sent to ${oneSignalId}: ${message}`, {
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
      console.error('Error sending notification (attempt ' + (i + 1) + '):', {
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
    await userRef.set({
      adsWatched: 0,
      coins: 0,
      adCooldownEndTime: 0,
      recentRewards: [],
      oneSignalId: '',
    }, { merge: true });
    console.log(`Initialized user document for ${userId}`);
    return {
      adsWatched: 0,
      coins: 0,
      adCooldownEndTime: 0,
      recentRewards: [],
      oneSignalId: '',
    };
  }
  const data = doc.data();
  console.log(`User data retrieved:`, { userId, adsWatched: data.adsWatched, oneSignalId: data.oneSignalId });
  return data;
}

// Award reward (coins or voucher)
async function awardReward(userId) {
  console.log(`Awarding reward for user: ${userId}`);
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`awardReward: Invalid user data for user ${userId}`);
    return { message: 'Invalid user data', error: 'User data not found' };
  }
  if (userData.adsWatched < ADS_TO_WATCH) {
    console.log(`awardReward: Not enough ads watched for user ${userId}, adsWatched: ${userData.adsWatched}`);
    return { message: `Watch ${ADS_TO_WATCH - userData.adsWatched} more ads!` };
  }

  try {
    const rewardType = Math.floor(Math.random() * 100);
    let rewardMessage;
    let voucherUrl = null;
    let coins = userData.coins;

    if (rewardType < 60) {
      const vouchers = [
        { name: 'Denim Jackets Under Rs 399', url: 'https://fktr.in/KxfRFR9' },
        { name: 'Upto 75% Off (AJIOMANIA SALE)', url: 'https://ajiio.in/yEpPt6V' },
        { name: 'Men\'s Shirts Under Rs 399', url: 'https://myntr.it/oOKAo5S' },
        { name: 'Men\'s Cargos Under Rs 499', url: 'https://fktr.in/8GhVuyO' },
      ];
      const selectedVoucher = vouchers[Math.floor(Math.random() * vouchers.length)];
      rewardMessage = `Voucher: ${selectedVoucher.name}`;
      voucherUrl = selectedVoucher.url;
    } else {
      const coinType = Math.floor(Math.random() * 100);
      let coinsToAdd;
      if (coinType < 30) coinsToAdd = 5;
      else if (coinType < 80) coinsToAdd = 4;
      else coinsToAdd = 3;
      coins += coinsToAdd;
      rewardMessage = `${coinsToAdd} Coins`;
    }

    const rewards = userData.recentRewards || [];
    const newReward = { name: rewardMessage };
    if (voucherUrl) newReward.url = voucherUrl;
    rewards.unshift(newReward);
    if (rewards.length > 5) rewards.pop();

    const updateData = {
      adsWatched: 0,
      adCooldownEndTime: Date.now() + COOLDOWN_MINUTES * 60 * 1000,
      coins,
      recentRewards: rewards,
    };

    console.log(`Attempting to save reward for ${userId}:`, updateData);
    await db.collection('users').doc(userId).update(updateData);
    console.log(`Successfully awarded ${rewardMessage} to user ${userId}`);

    return { message: `Earned ${rewardMessage}! Elevate your growth! 🎉`, reward: rewardMessage, url: voucherUrl };
  } catch (error) {
    console.error(`Error awarding reward for ${userId}:`, error.message, error.stack);
    return { message: 'Failed to save reward. Please try again.', error: error.message };
  }
}

// NEW: Check for expired cooldowns and send notifications
async function checkCooldowns() {
  try {
    const now = Date.now();
    console.log(`Checking for expired cooldowns at ${getIstTime()}`);
    
    // Query users with active cooldowns (adCooldownEndTime > 0) that have expired (adCooldownEndTime <= now)
    const querySnapshot = await db.collection('users')
      .where('adCooldownEndTime', '>', 0)
      .where('adCooldownEndTime', '<=', now)
      .get();

    console.log(`Found ${querySnapshot.size} users with expired cooldowns`);

    for (const doc of querySnapshot.docs) {
      const userId = doc.id;
      const userData = doc.data();
      const { oneSignalId, adCooldownEndTime } = userData;

      if (!oneSignalId) {
        console.warn(`No oneSignalId for user ${userId}, skipping notification`);
        continue;
      }

      // Double-check cooldown expiration to avoid race conditions
      if (adCooldownEndTime > now) {
        console.log(`Cooldown for ${userId} not yet expired, skipping`);
        continue;
      }

      const message = 'Timer ended! Continue watching ads to earn coins! 🎉';
      const notificationSent = await sendNotification(message, oneSignalId, userId);

      if (notificationSent) {
        // Reset adCooldownEndTime to prevent repeated notifications
        await db.collection('users').doc(userId).update({
          adCooldownEndTime: 0,
          lastCooldownNotification: new Date().toISOString(), // Track when notification was sent
        });
        console.log(`Cooldown notification sent and adCooldownEndTime reset for ${userId}`);
      } else {
        console.error(`Failed to send cooldown notification for ${userId}`);
      }
    }
  } catch (error) {
    console.error('Error in checkCooldowns:', error.message, error.stack);
  }
}

// API endpoints
app.post('/watch-ad', async (req, res) => {
  const { userId } = req.body;
  if (!userId) {
    console.error('watch-ad: Missing userId');
    return res.status(400).send('User ID required');
  }
  console.log(`watch-ad endpoint called for ${userId}`);
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`watch-ad: Failed to access user data for ${userId}`);
    return res.status(500).send('Error accessing user data');
  }
  const now = Date.now();
  const cooldownElapsed = userData.adCooldownEndTime <= now;

  if (userData.adsWatched < ADS_TO_WATCH && cooldownElapsed) {
    await db.collection('users').doc(userId).update({ adsWatched: userData.adsWatched + 1 });
    console.log(`Ad watched for ${userId}: ${userData.adsWatched + 1}/${ADS_TO_WATCH}`);
    res.send({ message: `Ad ${userData.adsWatched + 1}/${ADS_TO_WATCH} watched! Grow soon!` });
  } else if (!cooldownElapsed) {
    console.log(`watch-ad: Cooldown active for ${userId}`);
    res.status(429).send({ message: `Cooldown active. Wait ${Math.ceil((userData.adCooldownEndTime - now) / 60000)} minutes.` });
  } else {
    const { message, reward, url, error } = await awardReward(userId);
    console.log(`watch-ad: Award result for ${userId}: ${message}, error: ${error || 'none'}`);
    if (error) res.status(500).send({ message, error });
    else res.send({ message, reward, url });
  }
});

app.post('/buy-feature', async (req, res) => {
  const { userId, feature, quantity } = req.body;
  if (!userId || !feature || !quantity) {
    console.error('buy-feature: Missing parameters', { userId, feature, quantity });
    return res.status(400).send('User ID, feature, and quantity required');
  }
  console.log(`buy-feature called for ${userId}:`, { feature, quantity });
  const userData = await checkAdStatus(userId);
  if (!userData) {
    console.error(`buy-feature: Failed to access user data for ${userId}`);
    return res.status(500).send('Error accessing user data');
  }
  let cost = 0;
  switch (feature) {
    case 'instagram_followers': cost = quantity * 10; break;
    case 'instagram_likes': cost = quantity * 5; break;
    case 'youtube_subscribers': cost = quantity * 20; break;
    case 'youtube_likes': cost = quantity * 8; break;
    default: return res.status(400).send('Invalid feature');
  }

  if (userData.coins >= cost) {
    const rewards = userData.recentRewards || [];
    rewards.unshift({ name: `${quantity} ${feature}` });
    if (rewards.length > 5) rewards.pop();
    await db.collection('users').doc(userId).update({ coins: userData.coins - cost, recentRewards: rewards });
    console.log(`Purchased ${quantity} ${feature} for ${userId}, cost: ${cost}`);
    res.send({ message: `Bought ${quantity} ${feature} to skyrocket growth!` });
  } else {
    console.log(`buy-feature: Insufficient coins for ${userId}, needed: ${cost}, available: ${userData.coins}`);
    res.status(402).send({ message: 'Need more coins to grow!' });
  }
});

app.post('/update-onesignal', async (req, res) => {
  const { userId, oneSignalId } = req.body;
  if (!userId || !oneSignalId) {
    console.error(`update-onesignal: Missing parameters: ${userId}, ${oneSignalId}`);
    return res.status(400).send('User ID and OneSignal ID required');
  }
  if (!isValidOneSignalId(oneSignalId)) {
    console.warn(`update-onesignal: Invalid oneSignalId for ${userId}: ${oneSignalId}`);
    return res.status(400).send('Invalid OneSignal ID format');
  }
  console.log(`update-onesignal called for ${userId} with ${oneSignalId}`);
  try {
    await db.collection('users').doc(userId).set({ oneSignalId }, { merge: true });
    console.log(`Updated oneSignalId for ${userId} to ${oneSignalId}`);
    res.send({ message: 'OneSignal ID updated successfully' });
  } catch (error) {
    console.error(`update-onesignal error for ${userId}:`, error.message, error.stack);
    res.status(500).send('Error updating OneSignal ID');
  }
});

app.get('/', (req, res) => res.send('Vidalyzer Backend Running'));
app.get('/ping', (req, res) => res.status(200).send('OK'));

// NEW: Run cooldown check every minute
setInterval(checkCooldowns, 60 * 1000); // Check every 60 seconds

try {
  app.listen(port, () => console.log(`Server on port ${port} at ${getIstTime()}`));
} catch (error) {
  console.error('Server start failed:', error.message, error.stack);
  process.exit(1);
}

setInterval(() => {
  console.log(`Pinging self at ${getIstTime()}`);
  axios.get(`http://localhost:${port}/ping`).catch(err => console.error('Ping failed:', err.message));
}, 5 * 60 * 1000);

function isValidOneSignalId(id) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return typeof id === 'string' && uuidRegex.test(id);
}

process.env.TZ = 'Asia/Kolkata';
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY || !process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  console.error('Missing env vars:', { ONESIGNAL_APP_ID, ONESIGNAL_API_KEY, FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID });
  process.exit(1);
}

console.log('Server starting at', getIstTime());