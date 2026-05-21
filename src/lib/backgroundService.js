// Foreground-service runner. Keeps the verify cycle alive when the app is
// minimized or the screen is off, using react-native-background-actions.
import { Platform } from 'react-native';

import { runVerifyCycle } from './verifyLoop';

let BackgroundService = null;
try {
  BackgroundService = require('react-native-background-actions').default;
} catch {
  BackgroundService = null;   // not available in Expo Go / web
}

const POLL_MS = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The long-running task: loop until the service is stopped.
async function task(taskData) {
  const authKey = taskData?.authKey;
  let lastMatched = 0;
  while (BackgroundService && BackgroundService.isRunning()) {
    try {
      const res = await runVerifyCycle(authKey);
      if (res?.matchedIds?.length) {
        lastMatched += res.matchedIds.length;
        try {
          await BackgroundService.updateNotification({
            taskDesc: `${lastMatched} payment(s) auto-verified`,
          });
        } catch {}
      }
    } catch {
      // swallow — never let the loop die
    }
    await sleep(POLL_MS);
  }
}

const baseOptions = {
  taskName: 'EzyPayMonitor',
  taskTitle: 'EzyPay · Monitoring payments',
  taskDesc: 'Watching wallet SMS to auto-verify payments',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#7c3aed',
  linkingURI: 'payverify://',
};

export function isServiceSupported() {
  return Platform.OS === 'android' && !!BackgroundService;
}

export function isServiceRunning() {
  return !!(BackgroundService && BackgroundService.isRunning());
}

export async function startVerifyService(authKey) {
  if (!isServiceSupported() || !authKey) return false;
  try {
    if (BackgroundService.isRunning()) {
      // already running — refresh the auth key by restarting
      await BackgroundService.stop();
    }
    await BackgroundService.start(task, {
      ...baseOptions,
      parameters: { authKey },
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function stopVerifyService() {
  if (!isServiceSupported()) return;
  try {
    if (BackgroundService.isRunning()) await BackgroundService.stop();
  } catch {}
}
