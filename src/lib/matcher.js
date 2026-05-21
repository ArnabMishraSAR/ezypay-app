// SMS matching rules — implements docs/APK_API.md §3 with real-world
// tolerances for BD wallet formats (NAGAD, bKash, Rocket/16216, upay, NexusPay).

const RECENT_MS = 30 * 60_000;  // bumped from 15min: tolerates brief offline

// STRICT sender allowlist per provider. SMS from any other sender is
// rejected even if TxnID + amount match — this is the primary defense
// against forged SMS sent from personal mobile numbers.
const SENDER_HINTS = {
  bkash:  ['bkash'],
  nagad:  ['nagad'],
  rocket: ['16216', 'rocket', 'nexus'],
  upay:   ['upay'],
};

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Amount must appear *next to* a currency keyword.
// Handles: "Tk 1900.00", "Tk100.00", "Tk. 100.00", "Tk1,000.00", "BDT 50", "Rs.1",
// "Amount: Tk 1900.00", "₹500". Rejects bare numbers from dates/TxnIDs/balances.
function bodyContainsAmount(body, amount) {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return false;

  const cleaned = String(body).replace(/,/g, '');  // drop thousands separators
  const variants = new Set([amt.toFixed(2), String(Math.round(amt)), String(amt)]);

  const currencyClass =
    '(?:tk\\.?|bdt|inr|rs\\.?|amount\\s*:?|received\\s+tk\\.?|\\u20b9)';

  for (const v of variants) {
    const re = new RegExp(
      `${currencyClass}\\s*${escapeRegex(v)}(?!\\d)`,
      'i'
    );
    if (re.test(cleaned)) return true;
  }
  return false;
}

// Phone match is *bonus only* now — wallet SMS commonly mask the customer
// phone (`0188***2351`, `0172XXXX198`, `A/C ***513`), so making it required
// rejects valid matches. We trust TxnID + Amount + Recency.
function phoneAppearsInBody(body, customerPhone) {
  if (!customerPhone) return null;       // not provided
  const digits = digitsOnly(customerPhone);
  if (digits.length < 8) return null;
  if (digitsOnly(body).includes(digits.slice(-8))) return true;
  // Also accept partial (first-4 + last-4) for masked SMS
  const first4 = digits.slice(0, 4);
  const last4  = digits.slice(-4);
  const bd     = digitsOnly(body);
  if (bd.includes(first4) && bd.includes(last4)) return true;
  return false;
}

export function senderHintMatches(provider, address) {
  if (!provider || !address) return false;
  const hints = SENDER_HINTS[String(provider).toLowerCase()];
  if (!hints) return false;
  const a = String(address).toLowerCase();
  return hints.some((h) => a.includes(h));
}

// True when we know how to validate the provider's sender. If false, we
// have no allowlist to enforce — fall back to soft behavior.
function hasKnownSenderHints(provider) {
  if (!provider) return false;
  return Boolean(SENDER_HINTS[String(provider).toLowerCase()]);
}

export function matchSmsDetailed(verification, sms) {
  if (!verification || !sms) return { ok: false, reason: 'no input' };

  const age = Date.now() - Number(sms.date || 0);
  if (age < 0 || age > RECENT_MS) return { ok: false, reason: 'too old' };

  const body  = String(sms.body || '').toLowerCase();
  const txnid = String(verification.txnid_submitted || '').toLowerCase().trim();
  if (!txnid)                    return { ok: false, reason: 'no txnid in verification' };
  if (txnid.length < 6)          return { ok: false, reason: 'txnid too short' };
  if (!body.includes(txnid))     return { ok: false, reason: 'txnid not in body' };

  if (!bodyContainsAmount(body, verification.amount)) {
    return { ok: false, reason: 'amount not in body' };
  }

  // STRICT sender allowlist — anti-forgery.
  // Reject SMS not from the provider's official sender ID.
  if (hasKnownSenderHints(verification.provider)) {
    if (!senderHintMatches(verification.provider, sms.address)) {
      return {
        ok: false,
        reason: `sender ${sms.address || '?'} not allowed for ${verification.provider}`,
      };
    }
  }

  return {
    ok: true,
    phoneMatch:  phoneAppearsInBody(body, verification.customer_phone),
    senderMatch: true,
  };
}

export function matchSms(verification, sms) {
  return matchSmsDetailed(verification, sms).ok;
}

export function findMatch(verification, smsList) {
  if (!Array.isArray(smsList) || smsList.length === 0) {
    return { sms: null, reasonsTried: [] };
  }
  // Prefer newer SMS first. With strict sender check enforced inside
  // matchSmsDetailed, the first SMS to pass all checks is the right one.
  const sorted = [...smsList].sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
  const reasons = [];
  for (const s of sorted) {
    const r = matchSmsDetailed(verification, s);
    if (r.ok) return { sms: s, reasonsTried: reasons };
    reasons.push({ address: s.address, reason: r.reason });
  }
  return { sms: null, reasonsTried: reasons };
}
