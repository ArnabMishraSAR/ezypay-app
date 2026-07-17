// App-facing control surface for the background verify service.
//
// The exported API is unchanged from the react-native-background-actions
// version so App.js didn't have to move — but the implementation underneath is
// now entirely native (Kotlin foreground service, own :verifier process).
//
// WHY THE REWRITE
// ---------------
// react-native-background-actions ran the 10s verify loop in this JS runtime,
// and its service returned START_NOT_STICKY. Swiping the app out of Recents
// killed the process, and START_NOT_STICKY told Android never to bring it back.
// Polling stopped for good, so payments silently stopped auto-verifying until
// someone reopened the app. Nothing in JS could fix that, because the fix has to
// survive the JS engine's death.
//
// NOTE — this is NOT the same as the device going "offline". In this app
// is_online is driven by the FCM ping/pong loop (see fcm.js, and the server's
// services/ping.js: is_online = last_ping_ack >= last_ping_sent_at), and that
// already survives the app being killed, because @react-native-firebase wakes a
// Headless JS handler to answer the ping. So a swiped-away phone kept *looking*
// healthy on the dashboard while quietly verifying nothing — which is the more
// dangerous failure, and why this was worth fixing properly.
//
// FCM is untouched by this change. The two are independent: FCM answers "is this
// phone alive?"; the native service does the actual SMS verification.
//
// The native service polls, reads SMS, matches and reports on its own. It needs
// nothing from this file after start().
import { Platform } from 'react-native';

import { API_BASE_URL } from './api';
import { getOrCreateDeviceId } from './device';
import {
  clearNativeSession,
  getNativeStatus,
  isNativeVerifierAvailable,
  startNative,
  stopNative,
  subscribeNativeStatus,
} from './nativeVerifier';

export function isServiceSupported() {
  return Platform.OS === 'android' && isNativeVerifierAvailable();
}

/**
 * NOTE: async now (it was sync under react-native-background-actions).
 * The service lives in another process, so "is it running" is a real IPC
 * question rather than an in-memory flag.
 */
export async function isServiceRunning() {
  if (!isServiceSupported()) return false;
  const s = await getNativeStatus();
  return !!s.running;
}

/**
 * Start the native service. Signature is deliberately unchanged — device id and
 * base URL are resolved here rather than pushed onto callers.
 *
 * Safe to call repeatedly: a start carrying a new auth key just re-configures
 * the running service.
 */
export async function startVerifyService(authKey) {
  if (!isServiceSupported() || !authKey) return false;
  try {
    const deviceId = await getOrCreateDeviceId();
    return await startNative(authKey, deviceId, API_BASE_URL);
  } catch {
    return false;
  }
}

/** Stop the service. Also clears the flag BootReceiver checks after a reboot. */
export async function stopVerifyService() {
  if (!isServiceSupported()) return;
  try {
    await stopNative();
  } catch {}
}

/**
 * Stop AND wipe the natively-stored auth key.
 *
 * Use this on unbind, not stopVerifyService: the key is mirrored into
 * SharedPreferences so the service can restart at boot without a JS engine, and
 * a revoked key must not be left on disk for BootReceiver to pick up.
 */
export async function clearVerifierSession() {
  if (!isServiceSupported()) return;
  try {
    await clearNativeSession();
  } catch {}
}

/**
 * Subscribe to live service status (fires once per polling cycle while the app
 * is open). Returns an unsubscribe function.
 *
 * @param {(s: {running: boolean, matchedTotal: number, queued: number,
 *             walletEmpty: boolean, lastCycleAt: number, note: string|null}) => void} fn
 */
export function subscribeServiceStatus(fn) {
  return subscribeNativeStatus(fn);
}

export { getNativeStatus as getServiceStatus };
