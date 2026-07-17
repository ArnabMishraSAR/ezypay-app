package cloud.trsinternational.payverify.verifier

import org.json.JSONObject

/**
 * One row from content://sms/inbox. Mirrors the shape react-native-get-sms-android
 * hands to JS, so Matcher.kt can be a line-by-line port of matcher.js.
 */
data class SmsMessage(
    val id: Long,
    val address: String,
    val body: String,
    /** Milliseconds since epoch, as recorded by the device on receipt. */
    val date: Long
)

/**
 * One pending verification from POST /api/device/poll.
 *
 * Field names mirror the server payload (device.controller.js poll()), not
 * Kotlin convention, to keep the mapping obvious when comparing against the
 * SQL that produces them.
 */
data class Verification(
    val verificationId: String,
    val txnidSubmitted: String,
    /** Kept as the raw JSON value: Postgres NUMERIC serialises as a String. */
    val amount: Any?,
    val customerPhone: String?,
    val provider: String?
) {
    companion object {
        /** org.json turns a JSON null into the string "null" via optString, so
         *  every nullable field is isNull()-checked before it's read. */
        private fun str(o: JSONObject, key: String): String? =
            if (o.isNull(key)) null else o.optString(key, "").ifBlank { null }

        fun fromJson(o: JSONObject): Verification = Verification(
            verificationId = o.optString("verification_id", ""),
            txnidSubmitted = o.optString("txnid_submitted", ""),
            // opt() not optString(): preserve number-vs-string so Matcher can
            // reproduce JS Number() semantics faithfully.
            amount         = if (o.isNull("amount")) null else o.opt("amount"),
            customerPhone  = str(o, "customer_phone"),
            provider       = str(o, "provider")
        )
    }
}
