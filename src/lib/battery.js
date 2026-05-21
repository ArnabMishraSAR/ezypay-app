// Battery-optimization exemption helper. Aggressive OEM battery managers
// (Samsung, Oppo, Vivo, Xiaomi) kill foreground services unless the app is
// whitelisted. We can't toggle this programmatically, but we can deep-link the
// user to the right settings screen.
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let IntentLauncher = null;
try {
  IntentLauncher = require('expo-intent-launcher');
} catch {
  IntentLauncher = null;
}

const ASKED_KEY = 'pv.battery_prompted';

export async function alreadyPromptedBattery() {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function markBatteryPrompted() {
  try { await AsyncStorage.setItem(ASKED_KEY, '1'); } catch {}
}

// Opens the system "battery optimization" list so the user can set PayVerify to
// "Not optimized" / "Unrestricted". Falls back gracefully if unavailable.
export async function openBatterySettings() {
  if (Platform.OS !== 'android' || !IntentLauncher) return false;
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'
    );
    return true;
  } catch {
    try {
      // Fallback to generic battery saver settings
      await IntentLauncher.startActivityAsync('android.settings.BATTERY_SAVER_SETTINGS');
      return true;
    } catch {
      return false;
    }
  }
}
