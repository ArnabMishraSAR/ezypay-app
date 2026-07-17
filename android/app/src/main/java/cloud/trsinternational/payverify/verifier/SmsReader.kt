package cloud.trsinternational.payverify.verifier

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.util.Log

/**
 * Reads content://sms/inbox.
 *
 * Replaces listRecentSms() in src/lib/sms.js and keeps its exact semantics:
 * a rolling window of the last N minutes, newest first, capped at maxCount.
 *
 * On the deliberate absence of a high-water mark: see the long note on
 * Prefs.lastSeenSmsId. In short — the SMS lands on this phone the moment money
 * arrives, but the verification only becomes pending once the customer types
 * the TxnID into checkout, which is always later. Filtering by "SMS newer than
 * the last one I processed" would therefore discard the evidence before the
 * question was asked, and every payment would fail to verify. Rescanning the
 * window is the correct design, not an oversight. It costs ~100 rows every
 * cycle, which is nothing next to the network round-trip.
 */
object SmsReader {
    private const val TAG = "PVVerifier/Sms"

    private val INBOX: Uri = Uri.parse("content://sms/inbox")

    private val COLS = arrayOf("_id", "address", "body", "date")

    /**
     * @param minutes  window size; callers use 30 to match matcher.js RECENT_MS
     * @param maxCount hard cap, mirroring the JS maxCount: 100
     */
    fun listRecent(ctx: Context, minutes: Int = 30, maxCount: Int = 100): List<SmsMessage> {
        val minDate = System.currentTimeMillis() - minutes * 60_000L
        val out = ArrayList<SmsMessage>(maxCount)

        var cursor: Cursor? = null
        try {
            cursor = ctx.contentResolver.query(
                INBOX,
                COLS,
                "date >= ?",
                arrayOf(minDate.toString()),
                "date DESC"
            )

            if (cursor == null) {
                // Null (rather than empty) means the provider refused us —
                // almost always READ_SMS revoked while the service was running.
                Log.w(TAG, "inbox query returned null cursor (READ_SMS revoked?)")
                return emptyList()
            }

            val iId   = cursor.getColumnIndex("_id")
            val iAddr = cursor.getColumnIndex("address")
            val iBody = cursor.getColumnIndex("body")
            val iDate = cursor.getColumnIndex("date")

            // Cap in code rather than via "LIMIT" in sortOrder: the LIMIT trick
            // works on AOSP's SMS provider but is not contractual, and some OEM
            // providers reject it outright.
            while (cursor.moveToNext() && out.size < maxCount) {
                out.add(
                    SmsMessage(
                        id      = if (iId   >= 0) cursor.getLong(iId)     else 0L,
                        address = if (iAddr >= 0) cursor.getString(iAddr) ?: "" else "",
                        body    = if (iBody >= 0) cursor.getString(iBody) ?: "" else "",
                        date    = if (iDate >= 0) cursor.getLong(iDate)   else 0L
                    )
                )
            }
        } catch (t: Throwable) {
            // SecurityException (permission revoked mid-flight) or an OEM
            // provider quirk. Never let this kill the polling loop.
            Log.w(TAG, "inbox query failed: ${t.message}")
            return emptyList()
        } finally {
            try { cursor?.close() } catch (_: Throwable) {}
        }

        return out
    }
}
