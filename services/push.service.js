'use strict';

const webpush = require('web-push');
const logger = require('../logger');
const { db, isFirebaseConfigured } = require('../firebase');

const SUBSCRIPTIONS_COLLECTION = 'web_push_subscriptions';

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

const hasVapidKeys = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (hasVapidKeys) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  logger.warn('VAPID keys missing. Push notifications are disabled. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.');
}

function getPublicVapidKey() {
  return VAPID_PUBLIC_KEY;
}

function getSubscriptionId(subscription) {
  const endpoint = subscription && subscription.endpoint ? subscription.endpoint : '';
  return Buffer.from(endpoint).toString('base64url');
}

async function saveSubscription(subscription) {
  if (!hasVapidKeys) {
    return { ok: false, reason: 'push_disabled' };
  }

  if (!isFirebaseConfigured || !db) {
    return { ok: false, reason: 'firebase_not_configured' };
  }

  const id = getSubscriptionId(subscription);
  if (!id) {
    return { ok: false, reason: 'invalid_subscription' };
  }

  await db.collection(SUBSCRIPTIONS_COLLECTION).doc(id).set({
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    updatedAt: new Date(),
  }, { merge: true });

  return { ok: true };
}

async function removeSubscription(endpoint) {
  if (!endpoint || !isFirebaseConfigured || !db) {
    return;
  }

  const id = Buffer.from(endpoint).toString('base64url');
  await db.collection(SUBSCRIPTIONS_COLLECTION).doc(id).delete();
}

async function listSubscriptions() {
  if (!isFirebaseConfigured || !db) {
    return [];
  }

  const snapshot = await db.collection(SUBSCRIPTIONS_COLLECTION).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((s) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
}

async function sendAlertToAll(payload) {
  if (!hasVapidKeys) {
    return { sent: 0, failed: 0, skipped: true };
  }

  const subscriptions = await listSubscriptions();
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, skipped: false };
  }

  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
    } catch (err) {
      failed += 1;
      const statusCode = err && err.statusCode ? err.statusCode : null;

      logger.warn('Failed push delivery', {
        statusCode,
        endpoint: subscription.endpoint,
        error: err && err.message ? err.message : String(err),
      });

      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(subscription.endpoint);
      }
    }
  }

  return { sent, failed, skipped: false };
}

module.exports = {
  getPublicVapidKey,
  hasVapidKeys,
  saveSubscription,
  removeSubscription,
  sendAlertToAll,
};
