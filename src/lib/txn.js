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

// A Date's local calendar day as YYYY-MM-DD — no timezone conversion, so it
// matches withinDays()'s local-midnight cutoff and, on a Bangladesh device,
// the REPORT_TZ days the backend filters on.
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Turn a date preset into the {from,to} the backend understands, so the query
// covers the whole window instead of the newest page. 'all' (or anything
// without a day count) yields no bounds. Mirrors withinDays: `to` is today,
// `from` is (days-1) back, both inclusive.
export function presetRange(preset) {
  const days = { today: 1, '7d': 7, '30d': 30 }[preset];
  if (!days) return {};
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: ymdLocal(from), to: ymdLocal(to) };
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
