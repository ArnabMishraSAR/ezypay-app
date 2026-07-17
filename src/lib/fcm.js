// Firebase Cloud Messaging helper. Lazily loaded so importing this file is
// always safe (no crash in Expo Go / web where the native module is absent).
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';
import { appUpdateBus } from './bus';
import { getOrCreateDeviceId } from './device';

let messaging = null;
try {
  messaging = require('@react-native-firebase/messaging').default;
} catch {
  messaging = null;
}

let Application = null;
try {
  Application = require('expo-application');
} catch {
  Application = null;
}

/**
 * Android versionCode of the installed build (nativeBuildVersion is a
 * string on Android, e.g. "13"), or null when unavailable.
 */
export function appVersionCode() {
  const n = Number(Application?.nativeBuildVersion);
  return Number.isInteger(n) && n > 0 ? n : null;
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
 * respond with a pong so the server knows we're alive. "app_update" messages
 * are surfaced in-app; anything else is ignored.
 */
async function handleRemoteMessage(remoteMessage) {
  const data = remoteMessage?.data;
  if (!data) return;

  if (data.type === 'app_update') {
    // Backgrounded apps already got the system-tray notification; this covers
    // the foreground case so the UI can show an update prompt if it wants to.
    appUpdateBus.emit({ latest: data.latest || '', url: data.url || '' });
    return;
  }

  if (data.type !== 'ping') return;

  try {
    const authKey = await AsyncStorage.getItem('pv.auth_key');
    if (!authKey) return; // not bound yet — nothing to pong

    const deviceId = await getOrCreateDeviceId();
    await api.pong({
      auth_key: authKey,
      device_id: deviceId,
      ping_id: data.ping_id || '',
      app_version: appVersionCode() || undefined, // dropped from JSON when null
    });
  } catch {
    // Best-effort — never crash over a failed pong.
  }
}

/** Tap on an "app update" notification → open the APK download link. */
function handleNotificationTap(remoteMessage) {
  const data = remoteMessage?.data;
  if (data?.type === 'app_update' && data.url) {
    Linking.openURL(String(data.url)).catch(() => {});
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

  // Update-notification taps: app brought back from background…
  unsubs.push(messaging().onNotificationOpenedApp(handleNotificationTap));
  // …or cold-started by the tap while killed.
  messaging().getInitialNotification().then(handleNotificationTap).catch(() => {});

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
