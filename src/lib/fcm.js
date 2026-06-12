// Firebase Cloud Messaging helper. Lazily loaded so importing this file is
// always safe (no crash in Expo Go / web where the native module is absent).
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';
import { getOrCreateDeviceId } from './device';

let messaging = null;
try {
  messaging = require('@react-native-firebase/messaging').default;
} catch {
  messaging = null;
}

export function isFcmAvailable() {
  return Platform.OS === 'android' && !!messaging;
}

/**
 * Ask for notification permission (Android 13+ handled by the OS prompt) and
 * return the FCM registration token, or null if unavailable/denied.
 */
export async function getFcmToken() {
  if (!isFcmAvailable()) return null;
  try {
    // requestPermission is a no-op pre-Android-13; harmless to call.
    await messaging().requestPermission().catch(() => {});
    const token = await messaging().getToken();
    return token || null;
  } catch (e) {
    return null;
  }
}

/**
 * Handle an incoming FCM data message. If it's a "ping" from the server,
 * respond with a pong so the server knows we're alive.
 */
async function handleRemoteMessage(remoteMessage) {
  const data = remoteMessage?.data;
  if (!data || data.type !== 'ping') return;

  try {
    const authKey = await AsyncStorage.getItem('pv.auth_key');
    if (!authKey) return; // not bound yet — nothing to pong

    const deviceId = await getOrCreateDeviceId();
    await api.pong({
      auth_key: authKey,
      device_id: deviceId,
      ping_id: data.ping_id || '',
    });
  } catch {
    // Best-effort — never crash over a failed pong.
  }
}

/**
 * Register foreground + token-refresh handlers.
 * @param {(token:string)=>void} onToken  called when the token refreshes
 * @returns {()=>void} unsubscribe
 */
export function registerFcmHandlers(onToken) {
  if (!isFcmAvailable()) return () => {};
  const unsubs = [];

  // Token rotation — re-send to backend so pushes keep landing.
  unsubs.push(messaging().onTokenRefresh((t) => { if (t && onToken) onToken(t); }));

  // Foreground messages: handle ping and other data messages.
  unsubs.push(messaging().onMessage(async (remoteMessage) => {
    await handleRemoteMessage(remoteMessage);
  }));

  return () => unsubs.forEach((u) => { try { u(); } catch {} });
}

/**
 * Register the background message handler. This must be called at the
 * top level (outside of any component) so React Native Firebase can
 * invoke it when a message arrives while the app is killed/background.
 */
export function registerBackgroundHandler() {
  if (!isFcmAvailable()) return;
  try {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      await handleRemoteMessage(remoteMessage);
    });
  } catch {
    // Silently ignore if setBackgroundMessageHandler is not available.
  }
}
