'use strict';

const webpush = require('web-push');
const logger = require('../logger');
const { db, isFirebaseConfigured } = require('../firebase');

const SUBSCRIPTIONS_COLLECTION = 'web_push_subscriptions';
const NOTIFICATION_LOGS_COLLECTION = 'notification_logs';

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

async function sendAlertToAll(payload, metadata = {}) {
  if (!hasVapidKeys) {
    logger.warn('Push notifications disabled - VAPID keys missing');
    return { sent: 0, failed: 0, skipped: true };
  }

  const subscriptions = await listSubscriptions();
  if (subscriptions.length === 0) {
    logger.info('No active subscriptions to send notifications');
    return { sent: 0, failed: 0, skipped: false };
  }

  let sent = 0;
  let failed = 0;
  const sendResults = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      sent += 1;
      
      sendResults.push({
        endpoint: subscription.endpoint,
        status: 'success',
        timestamp: new Date(),
      });
    } catch (err) {
      failed += 1;
      const statusCode = err && err.statusCode ? err.statusCode : null;

      logger.warn('Failed push delivery', {
        statusCode,
        endpoint: subscription.endpoint,
        error: err && err.message ? err.message : String(err),
      });

      sendResults.push({
        endpoint: subscription.endpoint,
        status: 'failed',
        errorCode: statusCode,
        error: err && err.message ? err.message : String(err),
        timestamp: new Date(),
      });

      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(subscription.endpoint);
      }
    }
  }

  // Save notification log asynchronously (fire-and-forget)
  (async () => {
    try {
      await saveNotificationLog({
        title: payload.title || 'Alerta IoT',
        body: payload.body || '',
        severity: payload.severity || 'medium',
        tag: payload.tag || 'iot-alert',
        sent,
        failed,
        total: subscriptions.length,
        metadata,
        sendResults,
      });
    } catch (logErr) {
      logger.error('Failed to save notification log', logErr && logErr.message ? logErr.message : String(logErr));
    }
  })();

  return { sent, failed, skipped: false };
}

async function saveNotificationLog(logData) {
  if (!isFirebaseConfigured || !db) {
    logger.warn('Cannot save notification log - Firebase not configured');
    return;
  }

  try {
    const log = {
      title: logData.title || 'Alerta IoT',
      body: logData.body || '',
      severity: logData.severity || 'medium',
      tag: logData.tag || 'iot-alert',
      sent: logData.sent || 0,
      failed: logData.failed || 0,
      total: logData.total || 0,
      leida: false,
      metadata: logData.metadata || {},
      sendResults: logData.sendResults || [],
      timestamp: new Date(),
      createdAt: new Date(),
    };

    const docRef = await db.collection(NOTIFICATION_LOGS_COLLECTION).add(log);
    logger.info('Notification log saved', { id: docRef.id, title: log.title, sent: log.sent });
    return docRef.id;
  } catch (error) {
    logger.error('Error saving notification log', error && error.stack ? error.stack : error);
    throw error;
  }
}

async function getNotificationHistory(options = {}) {
  if (!isFirebaseConfigured || !db) {
    logger.warn('Cannot fetch notification history - Firebase not configured');
    return [];
  }

  try {
    const {
      limit = 50,
      severity = null,
      status = null, // 'success', 'failed', 'partial'
      onlyUnread = false,
    } = options;

    let query = db.collection(NOTIFICATION_LOGS_COLLECTION).orderBy('timestamp', 'desc');

    if (onlyUnread) {
      query = query.where('leida', '==', false);
    }

    if (severity && severity !== 'all') {
      query = query.where('severity', '==', severity);
    }

    query = query.limit(limit);

    const snapshot = await query.get();
    const notifications = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp ? doc.data().timestamp.toDate() : null,
      createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : null,
    }));

    // Filter by status if provided
    if (status) {
      return notifications.filter((notif) => {
        if (status === 'success') return notif.failed === 0 && notif.sent > 0;
        if (status === 'failed') return notif.sent === 0;
        if (status === 'partial') return notif.failed > 0 && notif.sent > 0;
        return true;
      });
    }

    return notifications;
  } catch (error) {
    logger.error('Error fetching notification history', error && error.stack ? error.stack : error);
    return [];
  }
}

async function getNotificationStats(hours = 24) {
  if (!isFirebaseConfigured || !db) {
    return null;
  }

  try {
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const snapshot = await db.collection(NOTIFICATION_LOGS_COLLECTION)
      .where('timestamp', '>=', cutoffTime)
      .orderBy('timestamp', 'desc')
      .get();

    const notifications = snapshot.docs.map((doc) => doc.data());

    const stats = {
      total: notifications.length,
      leidas: notifications.filter((n) => n.leida).length,
      noleidas: notifications.filter((n) => !n.leida).length,
      porSeveridad: {
        critical: notifications.filter((n) => n.severity === 'critical').length,
        high: notifications.filter((n) => n.severity === 'high').length,
        medium: notifications.filter((n) => n.severity === 'medium').length,
        low: notifications.filter((n) => n.severity === 'low').length,
      },
      tasaExito: notifications.length > 0
        ? Math.round((notifications.reduce((sum, n) => sum + (n.sent || 0), 0) / 
                     (notifications.reduce((sum, n) => sum + (n.total || 0), 0) || 1)) * 100)
        : 0,
      horaInicio: cutoffTime,
      hora: new Date(),
    };

    return stats;
  } catch (error) {
    logger.error('Error calculating notification stats', error && error.stack ? error.stack : error);
    return null;
  }
}

async function markNotificationAsRead(notificationId) {
  if (!isFirebaseConfigured || !db) {
    return { ok: false };
  }

  try {
    await db.collection(NOTIFICATION_LOGS_COLLECTION).doc(notificationId).update({
      leida: true,
      leidaAt: new Date(),
    });
    return { ok: true };
  } catch (error) {
    logger.error('Error marking notification as read', error && error.stack ? error.stack : error);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  getPublicVapidKey,
  hasVapidKeys,
  saveSubscription,
  removeSubscription,
  sendAlertToAll,
  saveNotificationLog,
  getNotificationHistory,
  getNotificationStats,
  markNotificationAsRead,
};
