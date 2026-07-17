// Canonical verify cycle: poll → read SMS → match → report.
// Shared by the foreground UI (HomeScreen) and the background foreground-service
// so there is exactly one implementation of the matching logic.

import { api } from './api';
import { getOrCreateDeviceId } from './device';
import { checkSmsPermissions } from './permissions';
import { isSmsAvailable, listRecentSms, smsLastError } from './sms';
import { findMatch } from './matcher';

// Module-level guard so the same verification isn't reported twice within this
// JS runtime.
//
// It does NOT cover the native verifier service — that runs in a separate
// process and keeps its own in-flight set. That overlap is safe and deliberate:
// /api/device/report updates WHERE status='pending', so whichever side reports
// first wins and the other gets a 404, which is handled below as
// already-resolved. The fee is debited inside the winning branch only, so a
// double report can never double-charge.
const inFlight = new Set();

/**
 * Run one full verify cycle.
 * @returns {Promise<{
 *   pending: Array, matchedIds: string[], smsCount: number,
 *   note: string|null, permsOk: boolean, smsAvailable: boolean,
 *   balance?: number, error: string|null
 * }>}
 */
export async function runVerifyCycle(authKey) {
  if (!authKey) return empty('no auth key');

  let device_id;
  try {
    device_id = await getOrCreateDeviceId();
  } catch (e) {
    return empty('device id error');
  }

  // 1. Poll
  let pending = [];
  try {
    const res = await api.poll({ auth_key: authKey, device_id });
    pending = res?.verifications || [];
  } catch (e) {
    return { ...empty(e?.message || 'poll failed'), };
  }

  // 2. Permission / module gate
  const permsOk = await checkSmsPermissions();
  const smsAvailable = isSmsAvailable();
  if (!permsOk || !smsAvailable) {
    return {
      pending,
      matchedIds: [],
      smsCount: 0,
      permsOk,
      smsAvailable,
      note: !permsOk ? 'sms permission not granted' : `sms reader: ${smsLastError() || 'unavailable'}`,
      error: null,
    };
  }

  if (!pending.length) {
    return { pending: [], matchedIds: [], smsCount: 0, permsOk, smsAvailable, note: 'no pending', error: null };
  }

  // 3. Read inbox + match + report
  const sms = await listRecentSms({ minutes: 30, maxCount: 100 });
  const matchedIds = [];
  const reasons = [];

  for (const v of pending) {
    if (inFlight.has(v.verification_id)) continue;
    const { sms: hit, reasonsTried } = findMatch(v, sms);
    if (!hit) {
      const top = (reasonsTried || []).slice(0, 2).map((r) => `${r.address || '?'}:${r.reason}`).join(' | ');
      reasons.push(`${v.txnid_submitted} → ${top || 'no sms'}`);
      continue;
    }

    inFlight.add(v.verification_id);
    try {
      await api.report({
        auth_key: authKey,
        device_id,
        verification_id: v.verification_id,
        result: 'success',
        matched_sms: hit.body,
      });
      matchedIds.push(v.verification_id);
    } catch (e) {
      if (e?.status === 404) matchedIds.push(v.verification_id); // already resolved elsewhere
      // other errors: leave pending, retry next cycle
    } finally {
      inFlight.delete(v.verification_id);
    }
  }

  const remaining = pending.filter((v) => !matchedIds.includes(v.verification_id));
  return {
    pending: remaining,
    matchedIds,
    smsCount: sms.length,
    permsOk,
    smsAvailable,
    note: matchedIds.length ? `${matchedIds.length} matched` : (reasons[0] || null),
    error: null,
  };
}

function empty(error) {
  return {
    pending: [], matchedIds: [], smsCount: 0,
    permsOk: false, smsAvailable: false, note: null, error,
  };
}
