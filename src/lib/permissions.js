import { PermissionsAndroid, Platform } from 'react-native';

export async function checkSmsPermissions() {
  if (Platform.OS !== 'android') return false;
  try {
    const [read, receive] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS),
    ]);
    return read && receive;
  } catch {
    return false;
  }
}

export async function requestSmsPermissions() {
  if (Platform.OS !== 'android') return false;
  const res = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  const G = PermissionsAndroid.RESULTS.GRANTED;
  return (
    res[PermissionsAndroid.PERMISSIONS.READ_SMS] === G &&
    res[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === G
  );
}

export async function requestNotificationPermission() {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 33) return true;
  try {
    const r = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
