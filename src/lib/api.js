import Constants from 'expo-constants';

import { balanceBus, walletEmptyBus } from './bus';

const BASE_URL =
  Constants?.expoConfig?.extra?.API_BASE_URL ||
  'https://checkout.ezypay.it.com';

export const ADMIN_URL =
  Constants?.expoConfig?.extra?.ADMIN_URL ||
  'https://ezypay.it.com/login';

async function request(path, body, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // backend may occasionally return a non-JSON error
  }

  // Whenever the server tells us the current balance, fan it out.
  if (data && typeof data.balance !== 'undefined') {
    balanceBus.emit({
      balance: data.balance,
      fee: data.fee,
      threshold: data.threshold,
    });
  }

  // Wallet-empty signal: 402 + insufficient_balance from any APK endpoint
  // except those explicitly opting out (bind / unbind).
  if (
    res.status === 402 &&
    data &&
    data.insufficient_balance &&
    !opts.skipWalletCheck
  ) {
    walletEmptyBus.emit({
      balance: data.balance,
      fee: data.fee,
      threshold: data.threshold,
    });
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  bind: (payload) => request('/api/device/bind', payload, { skipWalletCheck: true }),
  unbind: (payload) => request('/api/device/unbind', payload, { skipWalletCheck: true }),
  heartbeat: (payload) => request('/api/device/heartbeat', payload),
  pong: (payload) => request('/api/device/pong', payload, { skipWalletCheck: true }),
  poll: (payload) => request('/api/device/poll', payload),
  report: (payload) => request('/api/device/report', payload),
  transactions: (payload) => request('/api/device/transactions', payload),
  verify: (payload) => request('/api/device/verify', payload),
};

export const API_BASE_URL = BASE_URL;
