import { NativeModules, Platform } from 'react-native';

let SmsAndroid  = null;
let lastError   = null;

function getModule() {
  if (Platform.OS !== 'android') {
    lastError = 'not android';
    return null;
  }
  if (SmsAndroid !== null) return SmsAndroid || null;

  try {
    let mod = require('react-native-get-sms-android');
    mod = (mod && mod.default) || mod;

    if (!mod || typeof mod.list !== 'function') {
      // Fall back to NativeModules in case the JS wrapper didn't re-export
      const nm = NativeModules?.SmsAndroid;
      if (nm && typeof nm.list === 'function') {
        SmsAndroid = nm;
        lastError = null;
        return nm;
      }
      lastError =
        `js module type=${typeof mod}; NativeModules.SmsAndroid=${nm ? 'present (no .list)' : 'undefined'}`;
      SmsAndroid = false;
      return null;
    }

    SmsAndroid = mod;
    lastError = null;
    return mod;
  } catch (e) {
    lastError = `require threw: ${e?.message || String(e)}`;
    SmsAndroid = false;
    return null;
  }
}

export function isSmsAvailable() {
  return !!getModule();
}

export function smsLastError() {
  // Ensure getModule has been invoked at least once
  if (SmsAndroid === null) getModule();
  return lastError;
}

export function listRecentSms({ minutes = 15, maxCount = 100 } = {}) {
  const mod = getModule();
  if (!mod) return Promise.resolve([]);

  const filter = {
    box: 'inbox',
    indexFrom: 0,
    maxCount,
    minDate: Date.now() - minutes * 60_000,
  };

  return new Promise((resolve) => {
    try {
      mod.list(
        JSON.stringify(filter),
        () => resolve([]),
        (_count, json) => {
          try {
            resolve(JSON.parse(json) || []);
          } catch {
            resolve([]);
          }
        }
      );
    } catch {
      resolve([]);
    }
  });
}
