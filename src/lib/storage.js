import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY = 'pv.auth_key';
const MERCHANT_NAME = 'pv.merchant_name';

export const session = {
  async load() {
    const [authKey, merchantName] = await Promise.all([
      AsyncStorage.getItem(AUTH_KEY),
      AsyncStorage.getItem(MERCHANT_NAME),
    ]);
    return { authKey, merchantName };
  },
  async save({ authKey, merchantName }) {
    await AsyncStorage.multiSet([
      [AUTH_KEY, authKey || ''],
      [MERCHANT_NAME, merchantName || ''],
    ]);
  },
  async clear() {
    await AsyncStorage.multiRemove([AUTH_KEY, MERCHANT_NAME]);
  },
};
