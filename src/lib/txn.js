// Defensive helpers for /api/device/transactions response shape

export function normalizeStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'success' || v === 'paid' || v === 'approved') return 'success';
  if (v === 'failed'  || v === 'rejected' || v === 'declined') return 'failed';
  if (v === 'pending' || v === 'awaiting') return 'pending';
  return v || 'unknown';
}

export function extractList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.transactions || res.items || res.data || [];
}

export function txnDate(t) {
  const raw = t?.created_at || t?.createdAt || t?.verified_at || t?.updated_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function gatewayKey(t) {
  const p = t?.provider || '';
  const v = t?.variant ? `·${t.variant}` : '';
  const a = t?.account_number ? ` (${t.account_number})` : '';
  return `${p}${v}${a}`.trim() || 'unknown';
}

export function withinDays(d, days) {
  if (!d) return false;
  if (days === Infinity) return true;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return d >= cutoff;
}

export function isToday(d) {
  if (!d) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth()    === now.getMonth() &&
    d.getDate()     === now.getDate()
  );
}
