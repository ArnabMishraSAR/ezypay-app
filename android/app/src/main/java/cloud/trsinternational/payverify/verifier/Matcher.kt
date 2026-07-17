package cloud.trsinternational.payverify.verifier

import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/**
 * Literal port of src/lib/matcher.js.
 *
 * SECURITY-CRITICAL. This is the anti-forgery gate: it is what stops someone
 * texting "You received Tk 500, TxnID ABC123" from a personal number and having
 * the phone auto-approve a real order. Any behavioural drift between this file
 * and matcher.js is a security bug, not a cosmetic one — the JS copy still runs
 * in the foreground (HomeScreen), so the two must agree.
 *
 * If you change matcher.js, change this file in the same commit.
 */
object Matcher {

    /** Mirrors RECENT_MS. This is the customer's budget for pasting the TxnID. */
    const val RECENT_MS = 30L * 60_000L

    /**
     * STRICT sender allowlist per provider. SMS from any other sender is
     * rejected even if TxnID + amount match.
     */
    private val SENDER_HINTS: Map<String, List<String>> = mapOf(
        "bkash"  to listOf("bkash"),
        "nagad"  to listOf("nagad"),
        "rocket" to listOf("16216", "rocket", "nexus"),
        "upay"   to listOf("upay")
    )

    /** Mirrors matcher.js escapeRegex — same character class. */
    private fun escapeRegex(s: String): String =
        s.replace(Regex("""[.*+?^${'$'}{}()|\[\]\\]""")) { "\\" + it.value }

    private fun digitsOnly(s: String?): String =
        (s ?: "").replace(Regex("\\D"), "")

    /**
     * Reproduces JavaScript's Number -> String conversion.
     *
     * This is the one place a naive port silently diverges. In JS,
     * String(500) is "500"; in Kotlin, (500.0).toString() is "500.0" — which
     * would never appear in an SMS, quietly dropping one of the three amount
     * variants matcher.js tries. Amounts arrive from Postgres NUMERIC as JSON
     * strings ("500.00"), so this path is hit on every single match.
     */
    private fun jsNumberToString(d: Double): String {
        if (d.isNaN() || d.isInfinite()) return d.toString()
        // JS prints integral values without a fractional part.
        if (d == floor(d) && abs(d) < 1e21) return d.toLong().toString()
        return d.toString()
    }

    /**
     * Amount must appear *next to* a currency keyword, so bare numbers from
     * dates / TxnIDs / balances don't count as a match.
     * Mirrors bodyContainsAmount().
     */
    private fun bodyContainsAmount(body: String, amountRaw: Any?): Boolean {
        val amt = toDouble(amountRaw) ?: return false
        if (amt <= 0.0) return false

        val cleaned = body.replace(",", "")   // drop thousands separators

        // Same three variants matcher.js builds, in the same order.
        val variants = linkedSetOf(
            String.format(Locale.US, "%.2f", amt),        // amt.toFixed(2)
            Math.round(amt).toString(),                   // String(Math.round(amt))
            jsNumberToString(amt)                         // String(amt)
        )

        val currencyClass =
            """(?:tk\.?|bdt|inr|rs\.?|amount\s*:?|received\s+tk\.?|₹)"""

        for (v in variants) {
            val re = Regex(
                "$currencyClass\\s*${escapeRegex(v)}(?!\\d)",
                RegexOption.IGNORE_CASE
            )
            if (re.containsMatchIn(cleaned)) return true
        }
        return false
    }

    /**
     * Bonus signal only — wallet SMS commonly mask the customer phone
     * (0188***2351), so a required match would reject valid payments.
     * Returns null when not determinable. Mirrors phoneAppearsInBody().
     */
    private fun phoneAppearsInBody(body: String, customerPhone: String?): Boolean? {
        if (customerPhone.isNullOrBlank()) return null
        val digits = digitsOnly(customerPhone)
        if (digits.length < 8) return null

        val bd = digitsOnly(body)
        if (bd.contains(digits.takeLast(8))) return true

        val first4 = digits.take(4)
        val last4 = digits.takeLast(4)
        if (bd.contains(first4) && bd.contains(last4)) return true
        return false
    }

    fun senderHintMatches(provider: String?, address: String?): Boolean {
        if (provider.isNullOrBlank() || address.isNullOrBlank()) return false
        val hints = SENDER_HINTS[provider.lowercase()] ?: return false
        val a = address.lowercase()
        return hints.any { a.contains(it) }
    }

    private fun hasKnownSenderHints(provider: String?): Boolean {
        if (provider.isNullOrBlank()) return false
        return SENDER_HINTS.containsKey(provider.lowercase())
    }

    data class Result(
        val ok: Boolean,
        val reason: String? = null,
        val phoneMatch: Boolean? = null,
        val senderMatch: Boolean = false
    )

    /**
     * Mirrors matchSmsDetailed(). Check order is preserved exactly so that the
     * rejection reasons reported in logs line up with the JS implementation.
     */
    fun matchSmsDetailed(v: Verification, sms: SmsMessage, now: Long = System.currentTimeMillis()): Result {
        val age = now - sms.date
        if (age < 0 || age > RECENT_MS) return Result(false, "too old")

        val body = sms.body.lowercase()
        val txnid = v.txnidSubmitted.lowercase().trim()

        if (txnid.isEmpty())        return Result(false, "no txnid in verification")
        if (txnid.length < 6)       return Result(false, "txnid too short")
        if (!body.contains(txnid))  return Result(false, "txnid not in body")

        if (!bodyContainsAmount(body, v.amount)) {
            return Result(false, "amount not in body")
        }

        // STRICT sender allowlist — anti-forgery.
        if (hasKnownSenderHints(v.provider)) {
            if (!senderHintMatches(v.provider, sms.address)) {
                return Result(false, "sender ${sms.address.ifBlank { "?" }} not allowed for ${v.provider}")
            }
        }

        return Result(
            ok = true,
            phoneMatch = phoneAppearsInBody(body, v.customerPhone),
            senderMatch = true
        )
    }

    data class Attempt(val address: String, val reason: String)
    data class Match(val sms: SmsMessage?, val reasonsTried: List<Attempt>)

    /**
     * Mirrors findMatch(): newest SMS first; with the strict sender check
     * enforced inside matchSmsDetailed, the first SMS to pass every check is
     * the right one.
     */
    fun findMatch(v: Verification, smsList: List<SmsMessage>, now: Long = System.currentTimeMillis()): Match {
        if (smsList.isEmpty()) return Match(null, emptyList())

        val sorted = smsList.sortedByDescending { it.date }
        val reasons = mutableListOf<Attempt>()
        for (s in sorted) {
            val r = matchSmsDetailed(v, s, now)
            if (r.ok) return Match(s, reasons)
            reasons.add(Attempt(s.address, r.reason ?: "?"))
        }
        return Match(null, reasons)
    }

    /**
     * Postgres NUMERIC comes back as a JSON string ("500.00"), but a hand-rolled
     * payload could carry a number. Accept both, like JS Number() does.
     */
    private fun toDouble(raw: Any?): Double? = when (raw) {
        null       -> null
        is Number  -> raw.toDouble()
        is String  -> raw.trim().toDoubleOrNull()
        else       -> raw.toString().trim().toDoubleOrNull()
    }
}
