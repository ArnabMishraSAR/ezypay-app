package cloud.trsinternational.payverify.verifier

import android.content.Context
import android.content.SharedPreferences

/**
 * Config + durable state for the verifier service.
 *
 * Why this exists at all: the session (auth key, device id) lives in
 * AsyncStorage, which is a SQLite DB owned by the React Native runtime. At
 * BOOT_COMPLETED — and on any START_STICKY restart — RN is not running, so
 * AsyncStorage is unreadable. The service needs its own copy on plain disk.
 *
 * Cross-process caveat: SharedPreferences caches per-process and is NOT
 * multi-process coherent. The service runs in :verifier while the RN bridge
 * runs in the main process. So:
 *   - the bridge writes with commit() (synchronous) BEFORE starting the service
 *   - explicit starts also carry the config as Intent extras (always fresh)
 *   - these values are the fallback for boot / sticky restarts, where the
 *     :verifier process is brand new and therefore reads straight from disk
 * See VerifierService.onStartCommand for how the two are reconciled.
 */
object Prefs {
    private const val FILE = "payverify_verifier"

    private const val K_AUTH_KEY   = "auth_key"
    private const val K_DEVICE_ID  = "device_id"
    private const val K_BASE_URL   = "base_url"
    private const val K_ENABLED    = "enabled"
    private const val K_QUEUE      = "report_queue"
    private const val K_LAST_SMS   = "last_seen_sms_id"

    private fun sp(ctx: Context): SharedPreferences =
        ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * Persist the config. Uses commit() rather than apply() on purpose: the
     * caller starts the :verifier process immediately afterwards, and that new
     * process reads this file from disk. apply() is async and would race.
     */
    fun saveConfig(ctx: Context, authKey: String, deviceId: String, baseUrl: String) {
        sp(ctx).edit()
            .putString(K_AUTH_KEY, authKey)
            .putString(K_DEVICE_ID, deviceId)
            .putString(K_BASE_URL, baseUrl.trimEnd('/'))
            .commit()
    }

    fun authKey(ctx: Context): String?  = sp(ctx).getString(K_AUTH_KEY, null)
    fun deviceId(ctx: Context): String? = sp(ctx).getString(K_DEVICE_ID, null)
    fun baseUrl(ctx: Context): String?  = sp(ctx).getString(K_BASE_URL, null)

    /**
     * "The user wants the service on." Distinct from "the service is running" —
     * this is what BootReceiver consults to decide whether to come back after a
     * reboot. Cleared only by an explicit stop (or unbind), never by a crash.
     */
    fun setEnabled(ctx: Context, on: Boolean) {
        sp(ctx).edit().putBoolean(K_ENABLED, on).commit()
    }

    fun isEnabled(ctx: Context): Boolean = sp(ctx).getBoolean(K_ENABLED, false)

    /** Wipes the session but leaves nothing behind that could re-auth. */
    fun clear(ctx: Context) {
        sp(ctx).edit()
            .remove(K_AUTH_KEY)
            .remove(K_DEVICE_ID)
            .putBoolean(K_ENABLED, false)
            .remove(K_QUEUE)
            .commit()
    }

    /* ── Report retry queue (see ReportQueue.kt) ── */

    fun readQueue(ctx: Context): String = sp(ctx).getString(K_QUEUE, "[]") ?: "[]"

    fun writeQueue(ctx: Context, json: String) {
        sp(ctx).edit().putString(K_QUEUE, json).commit()
    }

    /* ── Last seen SMS _id ──
     *
     * DISPLAY ONLY. This is deliberately never used to filter which SMS get
     * matched. Matching always rescans the full 30-minute window, because the
     * SMS reliably lands on this phone BEFORE the customer submits the TxnID
     * that makes the verification pending — a high-water mark would skip past
     * the evidence before there was anything to match it against, and every
     * payment would silently fail to verify.
     *
     * Duplicate protection is the server's job and it already does it:
     *   - report updates WHERE status='pending' -> second report gets 404
     *   - uniq_tx_merchant_txnid_success -> a TxnID can be success only once
     * Keep this value for notification text and nothing else.
     */
    fun lastSeenSmsId(ctx: Context): Long = sp(ctx).getLong(K_LAST_SMS, 0L)

    fun setLastSeenSmsId(ctx: Context, id: Long) {
        sp(ctx).edit().putLong(K_LAST_SMS, id).apply()
    }
}
