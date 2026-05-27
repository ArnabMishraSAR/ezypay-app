// Firebase Cloud Messaging helper. Lazily loaded so importing this file is
// always safe (no crash in Expo Go / web where the native module is absent).
import { Platform } from 'react-native';

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
 * Register foreground + token-refresh handlers.
 * @param {(token:string)=>void} onToken  called when the token refreshes
 * @returns {()=>void} unsubscribe
 */
export function registerFcmHandlers(onToken) {
  if (!isFcmAvailable()) return () => {};
  const unsubs = [];

  // Token rotation — re-send to backend so pushes keep landing.
  unsubs.push(messaging().onTokenRefresh((t) => { if (t && onToken) onToken(t); }));

  // Foreground messages: the OS won't auto-display a notification while the app
  // is in the foreground, but our verify loop already updates the UI, so we
  // just no-op here (could show an in-app toast later).
  unsubs.push(messaging().onMessage(async () => {}));

  return () => unsubs.forEach((u) => { try { u(); } catch {} });
}
