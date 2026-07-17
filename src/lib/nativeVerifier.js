// Thin wrapper over the native EzyPayVerifier module (Kotlin).
//
// The native side owns the entire verify cycle: it polls /api/device/poll,
// reads content://sms/inbox, matches, and reports — all inside a foreground
// service in its own :verifier process. None of that depends on this JS
// runtime, which is the whole point: when the user swipes the app away, the
// RN process dies and the service keeps going.
//
// JS is limited to three verbs: start, stop, observe.
//
// See android/app/src/main/java/cloud/trsinternational/payverify/verifier/
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

const Native = Platform.OS === 'android' ? NativeModules.EzyPayVerifier : null;

const EVENT = 'EzyPayVerifierStatus';

let emitter = null;
function getEmitter() {
  if (!Native) return null;
  if (!emitter) emitter = new NativeEventEmitter(Native);
  return emitter;
}

/** False on iOS, web, or an older build that predates the native module. */
export function isNativeVerifierAvailable() {
  return !!Native;
}

/**
 * Start the native foreground service.
 *
 * All three arguments are persisted natively (SharedPreferences) so the service
 * can restart itself at BOOT_COMPLETED, when there is no JS engine to ask.
 *
 * @returns {Promise<boolean>} true if the service was asked to start
 */
export async function startNative(authKey, deviceId, baseUrl) {
  if (!Native || !authKey || !deviceId || !baseUrl) return false;
  try {
    return await Native.start(authKey, deviceId, baseUrl);
  } catch {
    return false;
  }
}

/** Stop the service and clear the "user wants this on" flag (so boot won't revive it). */
export async function stopNative() {
  if (!Native) return false;
  try {
    return await Native.stop();
  } catch {
    return false;
  }
}

/**
 * Stop AND wipe the stored auth key. Use on unbind — otherwise the phone keeps
 * a revoked key on disk and BootReceiver would restart the service with it.
 */
export async function clearNativeSession() {
  if (!Native) return false;
  try {
    return await Native.clearSession();
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<{
 *   running: boolean, enabled: boolean, walletEmpty: boolean,
 *   matchedTotal: number, queued: number, queuedNow: number,
 *   lastCycleAt: number, note: string|null
 * }>}
 */
export async function getNativeStatus() {
  if (!Native) {
    return { running: false, enabled: false, walletEmpty: false, matchedTotal: 0, queued: 0, queuedNow: 0, lastCycleAt: 0, note: null };
  }
  try {
    return await Native.getStatus();
  } catch {
    return { running: false, enabled: false, walletEmpty: false, matchedTotal: 0, queued: 0, queuedNow: 0, lastCycleAt: 0, note: null };
  }
}

/**
 * Live status pushed from the service after each polling cycle.
 *
 * Only delivers while this process is alive — the service broadcasts to the
 * main process, and when the app is swiped away there's nobody listening. That
 * is expected; the service carries on regardless.
 *
 * @param {(status: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribeNativeStatus(fn) {
  const em = getEmitter();
  if (!em) return () => {};
  const sub = em.addListener(EVENT, fn);
  return () => {
    try { sub.remove(); } catch {}
  };
}
