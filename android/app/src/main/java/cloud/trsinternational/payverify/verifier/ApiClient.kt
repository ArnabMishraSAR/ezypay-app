package cloud.trsinternational.payverify.verifier

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/**
 * Talks to the same APK-facing endpoints src/lib/api.js uses.
 *
 * Deliberately built on HttpURLConnection rather than OkHttp: OkHttp only
 * reaches us as a transitive dependency of react-android, and this code runs in
 * the :verifier process where React Native is never loaded. Depending on RN's
 * dependency graph from a process that deliberately excludes RN is asking for a
 * NoClassDefFoundError the first time RN reshuffles its deps. The platform
 * client is enough for one small JSON POST every 10s and keeps connections
 * alive between cycles on its own.
 */
class ApiClient(private val baseUrl: String) {

    companion object {
        private const val TAG = "PVVerifier/Api"
        private const val CONNECT_TIMEOUT_MS = 10_000
        private const val READ_TIMEOUT_MS    = 15_000
    }

    /**
     * @param status  HTTP status, or 0 when the request never completed
     *                (no network, DNS failure, timeout, TLS error)
     * @param body    parsed JSON body, or null
     */
    data class Response(val status: Int, val body: JSONObject?) {
        val ok: Boolean get() = status in 200..299
        /** True when the request never reached the server — safe to retry. */
        val isNetworkFailure: Boolean get() = status == 0
        /** Mirrors the 402 + insufficient_balance contract in walletGuard.js. */
        val isWalletEmpty: Boolean get() =
            status == 402 && body?.optBoolean("insufficient_balance", false) == true
    }

    private fun post(path: String, payload: JSONObject): Response {
        var conn: HttpURLConnection? = null
        try {
            val url = URL("$baseUrl$path")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
                // Let the platform pool connections across polling cycles.
                setRequestProperty("Connection", "keep-alive")
            }

            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

            val status = conn.responseCode

            // Error responses come off errorStream, not inputStream. The server
            // puts meaningful JSON in its 402/404/409 bodies, so read both.
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let { s ->
                BufferedReader(InputStreamReader(s, Charsets.UTF_8)).use { it.readText() }
            } ?: ""

            val json = try {
                if (text.isBlank()) null else JSONObject(text)
            } catch (_: Throwable) {
                null   // backend may occasionally return a non-JSON error
            }

            return Response(status, json)
        } catch (t: Throwable) {
            // No network / DNS / TLS / timeout. status=0 marks it retryable.
            Log.w(TAG, "POST $path failed: ${t.javaClass.simpleName}: ${t.message}")
            return Response(0, null)
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) {}
        }
    }

    /**
     * POST /api/device/poll — returns pending verifications AND touches
     * last_seen_at server-side, which is what keeps the device marked online
     * (is_online = last_seen_at > NOW() - 10 min). Every successful poll is
     * therefore also the heartbeat.
     */
    fun poll(authKey: String, deviceId: String): Response =
        post("/api/device/poll", JSONObject().apply {
            put("auth_key", authKey)
            put("device_id", deviceId)
        })

    /**
     * POST /api/device/report.
     *
     * Note the server's exactly-once guarantee: the UPDATE is scoped
     * WHERE status='pending', so a racing report from the foreground JS loop
     * loses and gets a 404. That is expected and benign — see ReportQueue for
     * which statuses are terminal vs retryable.
     */
    fun report(
        authKey: String,
        deviceId: String,
        verificationId: String,
        result: String,
        matchedSms: String?
    ): Response =
        post("/api/device/report", JSONObject().apply {
            put("auth_key", authKey)
            put("device_id", deviceId)
            put("verification_id", verificationId)
            put("result", result)
            if (matchedSms != null) put("matched_sms", matchedSms)
        })
}
