package cloud.trsinternational.payverify.verifier

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable retry queue for reports that matched locally but couldn't be
 * delivered — no network, server down, or the merchant's wallet was empty at
 * that moment.
 *
 * This is the piece that actually protects a verification from being lost, and
 * it is why the service needs no SMS-level dedupe: matching is cheap and
 * repeatable, but a *delivered* report is the only thing that can't be redone.
 *
 * Survives process death and reboot (persisted via Prefs), so a match found
 * seconds before the user swiped the app away still lands.
 */
object ReportQueue {
    private const val TAG = "PVVerifier/Queue"

    /** Cap so a long outage can't grow the prefs file without bound. */
    private const val MAX_ITEMS = 50

    /** Give up after this long; a verification this stale is a human's problem. */
    private const val MAX_AGE_MS = 24L * 60 * 60 * 1000

    private const val MAX_ATTEMPTS = 12

    data class Item(
        val verificationId: String,
        val result: String,
        val matchedSms: String?,
        val createdAt: Long,
        val attempts: Int,
        val nextAttemptAt: Long
    )

    /**
     * Should a failed report be retried, or is this status final?
     *
     * Terminal — drop:
     *   2xx  delivered
     *   400  malformed; retrying can't fix it
     *   401  auth key is dead; every retry would fail identically
     *   404  "not found or already resolved" — the foreground JS loop or an
     *        admin got there first. This is the server's exactly-once guard
     *        firing, and it means the job is DONE, not failed.
     *   409  TxnID already marked paid on another order (uniq index, 23505).
     *        Anti-replay working as designed.
     *
     * Retryable — keep:
     *   0    never reached the server (offline / DNS / TLS / timeout)
     *   402  wallet empty right now; will deliver once the merchant tops up
     *   429  rate limited
     *   5xx  server-side blip
     */
    fun isRetryable(status: Int): Boolean = when {
        status == 0            -> true
        status == 402          -> true
        status == 429          -> true
        status in 500..599     -> true
        else                   -> false
    }

    private fun backoffMs(attempts: Int): Long {
        // 10s, 20s, 40s ... capped at 10 min.
        val base = 10_000L shl minOf(attempts, 6)
        return minOf(base, 10L * 60_000L)
    }

    fun size(ctx: Context): Int = read(ctx).size

    fun read(ctx: Context): MutableList<Item> {
        val out = mutableListOf<Item>()
        try {
            val arr = JSONArray(Prefs.readQueue(ctx))
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                out.add(
                    Item(
                        verificationId = o.optString("id"),
                        result         = o.optString("result", "success"),
                        matchedSms     = if (o.isNull("sms")) null else o.optString("sms", null),
                        createdAt      = o.optLong("at", 0L),
                        attempts       = o.optInt("n", 0),
                        nextAttemptAt  = o.optLong("next", 0L)
                    )
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "queue unreadable, dropping: ${t.message}")
            return mutableListOf()
        }
        return out
    }

    private fun write(ctx: Context, items: List<Item>) {
        val arr = JSONArray()
        for (it in items.take(MAX_ITEMS)) {
            arr.put(JSONObject().apply {
                put("id", it.verificationId)
                put("result", it.result)
                if (it.matchedSms != null) put("sms", it.matchedSms)
                put("at", it.createdAt)
                put("n", it.attempts)
                put("next", it.nextAttemptAt)
            })
        }
        Prefs.writeQueue(ctx, arr.toString())
    }

    /** Adds a report, or refreshes the one already queued for this verification. */
    fun enqueue(ctx: Context, verificationId: String, result: String, matchedSms: String?) {
        val items = read(ctx)
        val now = System.currentTimeMillis()

        val existing = items.indexOfFirst { it.verificationId == verificationId }
        if (existing >= 0) {
            val prev = items[existing]
            items[existing] = prev.copy(
                attempts = prev.attempts + 1,
                nextAttemptAt = now + backoffMs(prev.attempts + 1)
            )
        } else {
            if (items.size >= MAX_ITEMS) {
                // Oldest first: a fresh match is likelier to still be actionable.
                items.removeAt(0)
            }
            items.add(
                Item(
                    verificationId = verificationId,
                    result = result,
                    matchedSms = matchedSms,
                    createdAt = now,
                    attempts = 1,
                    nextAttemptAt = now + backoffMs(1)
                )
            )
        }
        write(ctx, items)
    }

    fun remove(ctx: Context, verificationId: String) {
        val items = read(ctx)
        items.removeAll { it.verificationId == verificationId }
        write(ctx, items)
    }

    /**
     * Delivers everything that's due. Called at the top of each cycle, before
     * polling, so a recovered network drains the backlog immediately.
     *
     * @return number of reports successfully resolved (delivered or found to be
     *         already-resolved server-side)
     */
    fun flush(ctx: Context, api: ApiClient, authKey: String, deviceId: String): Int {
        val items = read(ctx)
        if (items.isEmpty()) return 0

        val now = System.currentTimeMillis()
        val keep = mutableListOf<Item>()
        var resolved = 0

        for (item in items) {
            // Expired or exhausted — stop burning battery on it.
            if (now - item.createdAt > MAX_AGE_MS || item.attempts >= MAX_ATTEMPTS) {
                Log.w(TAG, "dropping stale report ${item.verificationId} after ${item.attempts} attempts")
                continue
            }
            // Not due yet — respect the backoff.
            if (now < item.nextAttemptAt) {
                keep.add(item)
                continue
            }

            val res = api.report(authKey, deviceId, item.verificationId, item.result, item.matchedSms)

            if (res.ok || !isRetryable(res.status)) {
                // Delivered, or terminal (404 already-resolved / 409 replay-blocked).
                // Either way this verification needs nothing further from us.
                if (res.ok) resolved++
                Log.i(TAG, "report ${item.verificationId} settled (status=${res.status})")
                continue
            }

            keep.add(
                item.copy(
                    attempts = item.attempts + 1,
                    nextAttemptAt = now + backoffMs(item.attempts + 1)
                )
            )
        }

        write(ctx, keep)
        return resolved
    }
}
