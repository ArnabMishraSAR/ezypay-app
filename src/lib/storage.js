import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_KEY      = 'pv.auth_key';
const MERCHANT_NAME = 'pv.merchant_name';
const BINDER_NAME   = 'pv.binder_name';
const TELEGRAM      = 'pv.telegram';
const WHATSAPP      = 'pv.whatsapp';

export const session = {
  async load() {
    const [authKey, merchantName, binderName, telegram, whatsapp] = await Promise.all([
      AsyncStorage.getItem(AUTH_KEY),
      AsyncStorage.getItem(MERCHANT_NAME),
      AsyncStorage.getItem(BINDER_NAME),
      AsyncStorage.getItem(TELEGRAM),
      AsyncStorage.getItem(WHATSAPP),
    ]);
    return { authKey, merchantName, binderName, telegram, whatsapp };
  },
  async save({ authKey, merchantName, binderName, telegram, whatsapp }) {
    await AsyncStorage.multiSet([
      [AUTH_KEY, authKey || ''],
      [MERCHANT_NAME, merchantName || ''],
      [BINDER_NAME, binderName || ''],
      [TELEGRAM, telegram || ''],
      [WHATSAPP, whatsapp || ''],
    ]);
  },
  async clear() {
    await AsyncStorage.multiRemove([AUTH_KEY, MERCHANT_NAME, BINDER_NAME, TELEGRAM, WHATSAPP]);
  },
};
