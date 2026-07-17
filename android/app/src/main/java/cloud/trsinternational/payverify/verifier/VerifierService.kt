package cloud.trsinternational.payverify.verifier

import android.Manifest
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

/**
 * The native replacement for the react-native-background-actions loop.
 *
 * WHY THIS EXISTS
 * ---------------
 * RNBackgroundActionsTask returns START_NOT_STICKY. When Android kills the
 * process on swipe-away, START_NOT_STICKY tells the system never to bring the
 * service back — polling stopped forever, last_seen_at went stale, and the
 * server flipped the device inactive after 10 minutes. This service:
 *   - returns START_STICKY, so Android restarts it after a process kill
 *   - runs in the :verifier process (see AndroidManifest), so swiping the app
 *     away kills only the RN process and leaves this one polling untouched
 *   - holds no state that RN owns, so it can start at BOOT_COMPLETED with no
 *     JS engine anywhere in sight
 *
 * THREADING
 * ---------
 * A HandlerThread + postDelayed loop, deliberately not coroutines: kotlinx
 * -coroutines only reaches this module transitively and this process is meant
 * to have zero React Native dependencies.
 */
class VerifierService : Service() {

    companion object {
        private const val TAG = "PVVerifier/Svc"

        const val ACTION_START = "cloud.trsinternational.payverify.verifier.START"
        const val ACTION_STOP  = "cloud.trsinternational.payverify.verifier.STOP"

        /** Broadcast to the main process so the RN bridge can show live status. */
        const val ACTION_STATUS = "cloud.trsinternational.payverify.verifier.STATUS"

        const val EXTRA_AUTH_KEY  = "auth_key"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_BASE_URL  = "base_url"

        /* ── Polling cadence ──
         *
         * Set both to 10_000 to reproduce the exact JS behaviour.
         *
         * The idle backoff is safe: the server only marks a device offline
         * after 10 minutes without contact (is_online = last_seen_at >
         * NOW() - INTERVAL '10 minutes'), and every poll doubles as the
         * heartbeat, so 30s idle leaves a 20x margin. Verification latency is
         * unaffected in practice — the moment anything is pending we're back to
         * 10s, and the SMS is matched from a 30-minute rescan window regardless.
         */
        const val ACTIVE_INTERVAL_MS = 10_000L
        const val IDLE_INTERVAL_MS   = 30_000L

        /** Go idle only after this long with nothing pending. */
        private const val IDLE_AFTER_MS = 2L * 60_000L

        /** Backoff when the wallet is empty — polling can't succeed until top-up. */
        private const val WALLET_EMPTY_INTERVAL_MS = 60_000L

        private const val SMS_WINDOW_MINUTES = 30   // must match Matcher.RECENT_MS
        private const val SMS_MAX_COUNT = 100

        fun start(ctx: Context, authKey: String, deviceId: String, baseUrl: String) {
            val i = Intent(ctx, VerifierService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_AUTH_KEY, authKey)
                putExtra(EXTRA_DEVICE_ID, deviceId)
                putExtra(EXTRA_BASE_URL, baseUrl)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            val i = Intent(ctx, VerifierService::class.java).apply { action = ACTION_STOP }
            try {
                ctx.startService(i)
            } catch (_: Throwable) {
                // Background-start restrictions can refuse this; stopService is
                // always allowed and reaches the same teardown.
                ctx.stopService(Intent(ctx, VerifierService::class.java))
            }
        }
    }

    private var worker: HandlerThread? = null
    private var handler: Handler? = null
    private var wakeLock: PowerManager.WakeLock? = null

    @Volatile private var running = false
    @Volatile private var authKey: String? = null
    @Volatile private var deviceId: String? = null
    @Volatile private var api: ApiClient? = null

    /** Last time we saw at least one pending verification — drives the backoff. */
    @Volatile private var lastPendingAt = 0L

    /* Status, mirrored out to JS via ACTION_STATUS broadcasts. */
    @Volatile private var matchedTotal = 0
    @Volatile private var lastCycleAt = 0L
    @Volatile private var lastNote: String? = null
    @Volatile private var walletEmpty = false

    /**
     * Guard against reporting the same verification twice within one cycle
     * sweep. Mirrors the module-level `inFlight` Set in verifyLoop.js. The
     * server is the real authority (UPDATE ... WHERE status='pending'), this
     * just avoids pointless duplicate round-trips.
     */
    private val inFlight = java.util.Collections.synchronizedSet(HashSet<String>())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        NotificationHelper.ensureChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // MUST be first: startForegroundService() gives us 5 seconds to call
        // startForeground() or the system throws ForegroundServiceDidNotStartInTime.
        startForeground(
            NotificationHelper.NOTIFICATION_ID,
            NotificationHelper.build(this, "EzyPay", "Starting payment monitoring…")
        )

        if (intent?.action == ACTION_STOP) {
            Log.i(TAG, "explicit stop")
            Prefs.setEnabled(this, false)
            stopLoop()
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        // Config resolution. Intent extras win because they're always fresh;
        // SharedPreferences is the fallback for the two cases where there is no
        // intent to read: a START_STICKY restart (Android redelivers a null
        // intent) and BOOT_COMPLETED. Cross-process staleness isn't a concern
        // there — those paths run in a newly spawned process that reads disk.
        val k = intent?.getStringExtra(EXTRA_AUTH_KEY)  ?: Prefs.authKey(this)
        val d = intent?.getStringExtra(EXTRA_DEVICE_ID) ?: Prefs.deviceId(this)
        val u = intent?.getStringExtra(EXTRA_BASE_URL)  ?: Prefs.baseUrl(this)

        if (k.isNullOrBlank() || d.isNullOrBlank() || u.isNullOrBlank()) {
            Log.w(TAG, "no config — nothing to do, stopping")
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        // An explicit start with extras may carry a NEW auth key (re-bind).
        if (intent?.getStringExtra(EXTRA_AUTH_KEY) != null) {
            Prefs.saveConfig(this, k, d, u)
        }
        Prefs.setEnabled(this, true)

        authKey = k
        deviceId = d
        api = ApiClient(u)

        startLoop()

        // The whole point: come back after a process kill.
        return START_STICKY
    }

    /* ────────────────────────── loop ────────────────────────── */

    private fun startLoop() {
        if (running) {
            Log.d(TAG, "loop already running")
            return
        }
        running = true

        acquireWakeLock()

        val t = HandlerThread("mp-verifier").apply { start() }
        worker = t
        handler = Handler(t.looper)
        handler?.post(tick)

        Log.i(TAG, "loop started")
    }

    private fun stopLoop() {
        running = false
        handler?.removeCallbacksAndMessages(null)
        try { worker?.quitSafely() } catch (_: Throwable) {}
        worker = null
        handler = null
        releaseWakeLock()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            var next = ACTIVE_INTERVAL_MS
            try {
                next = runCycle()
            } catch (t: Throwable) {
                // Nothing may kill this loop. That was the old design's failure
                // mode and it is the one thing this service must never do.
                Log.e(TAG, "cycle threw: ${t.javaClass.simpleName}: ${t.message}", t)
                lastNote = "error: ${t.message}"
            }
            if (running) handler?.postDelayed(this, next)
        }
    }

    /** @return delay in ms until the next cycle */
    private fun runCycle(): Long {
        val k = authKey ?: return IDLE_INTERVAL_MS
        val d = deviceId ?: return IDLE_INTERVAL_MS
        val client = api ?: return IDLE_INTERVAL_MS

        lastCycleAt = System.currentTimeMillis()

        // 1. Drain anything the network ate earlier, before doing new work.
        val flushed = ReportQueue.flush(this, client, k, d)
        if (flushed > 0) matchedTotal += flushed

        // 2. Poll. This doubles as the heartbeat that keeps the device online.
        val res = client.poll(k, d)

        if (res.isNetworkFailure) {
            lastNote = "offline — will retry"
            note("Offline · will retry", "Waiting for a network connection")
            return ACTIVE_INTERVAL_MS
        }

        if (res.isWalletEmpty) {
            walletEmpty = true
            lastNote = "wallet empty"
            note("Wallet empty", "Top up to resume auto-verifying payments")
            broadcastStatus()
            return WALLET_EMPTY_INTERVAL_MS
        }
        walletEmpty = false

        if (res.status == 401) {
            // Key is dead (unbound server-side). Retrying forever would be
            // pointless noise; shut down and let the UI re-bind.
            Log.w(TAG, "auth key rejected — stopping")
            lastNote = "device unbound"
            Prefs.setEnabled(this, false)
            broadcastStatus()
            stopLoop()
            stopForeground(true)
            stopSelf()
            return IDLE_INTERVAL_MS
        }

        if (!res.ok) {
            lastNote = "server error ${res.status}"
            return ACTIVE_INTERVAL_MS
        }

        val pending = mutableListOf<Verification>()
        res.body?.optJSONArray("verifications")?.let { arr ->
            for (i in 0 until arr.length()) {
                arr.optJSONObject(i)?.let { pending.add(Verification.fromJson(it)) }
            }
        }

        // 3. Permission gate. READ_SMS can be revoked while we run.
        if (!hasSmsPermission()) {
            lastNote = "sms permission not granted"
            note("Permission needed", "Allow SMS access so payments can auto-verify")
            broadcastStatus()
            return IDLE_INTERVAL_MS
        }

        if (pending.isEmpty()) {
            val idleFor = System.currentTimeMillis() - lastPendingAt
            lastNote = "no pending"
            note("EzyPay · Monitoring payments", monitoringText())
            broadcastStatus()
            return if (idleFor > IDLE_AFTER_MS) IDLE_INTERVAL_MS else ACTIVE_INTERVAL_MS
        }

        lastPendingAt = System.currentTimeMillis()

        // 4. Rescan the full window. Never filtered by last-seen id — see
        //    the note on Prefs.lastSeenSmsId for why that would break matching.
        val sms = SmsReader.listRecent(this, SMS_WINDOW_MINUTES, SMS_MAX_COUNT)
        sms.maxByOrNull { it.id }?.let { Prefs.setLastSeenSmsId(this, it.id) }

        var matchedThisCycle = 0

        for (v in pending) {
            if (v.verificationId.isBlank()) continue
            if (inFlight.contains(v.verificationId)) continue

            val m = Matcher.findMatch(v, sms)
            val hit = m.sms
            if (hit == null) {
                val top = m.reasonsTried.take(2).joinToString(" | ") { "${it.address}:${it.reason}" }
                lastNote = "${v.txnidSubmitted} → ${top.ifBlank { "no sms" }}"
                continue
            }

            inFlight.add(v.verificationId)
            try {
                val rep = client.report(k, d, v.verificationId, "success", hit.body)
                when {
                    rep.ok -> {
                        matchedThisCycle++
                        matchedTotal++
                        Log.i(TAG, "verified ${v.txnidSubmitted}")
                    }
                    // 404 = the foreground JS loop or an admin resolved it
                    // first. The server's exactly-once guard doing its job;
                    // count it as done, exactly as verifyLoop.js does.
                    rep.status == 404 -> {
                        matchedThisCycle++
                        Log.i(TAG, "${v.txnidSubmitted} already resolved elsewhere")
                    }
                    ReportQueue.isRetryable(rep.status) -> {
                        // Matched locally but couldn't deliver. This is the
                        // case that used to lose a payment outright.
                        ReportQueue.enqueue(this, v.verificationId, "success", hit.body)
                        Log.w(TAG, "queued report for ${v.txnidSubmitted} (status=${rep.status})")
                    }
                    else -> {
                        Log.w(TAG, "report ${v.txnidSubmitted} rejected: ${rep.status}")
                    }
                }
            } finally {
                inFlight.remove(v.verificationId)
            }
        }

        if (matchedThisCycle > 0) lastNote = "$matchedThisCycle matched"
        note("EzyPay · Monitoring payments", monitoringText())
        broadcastStatus()

        return ACTIVE_INTERVAL_MS
    }

    private fun monitoringText(): String {
        val q = ReportQueue.size(this)
        return when {
            q > 0 && matchedTotal > 0 -> "$matchedTotal verified · $q queued to send"
            q > 0                     -> "$q report(s) queued to send"
            matchedTotal > 0          -> "$matchedTotal payment(s) auto-verified"
            else                      -> "Watching wallet SMS to auto-verify payments"
        }
    }

    private fun note(title: String, text: String) = NotificationHelper.update(this, title, text)

    private fun hasSmsPermission(): Boolean =
        checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    /**
     * Push status to the main process. Context-registered receivers only, so
     * this reaches the RN bridge when the app is open and harmlessly goes
     * nowhere when it isn't — it never wakes the UI process.
     */
    private fun broadcastStatus() {
        try {
            val i = Intent(ACTION_STATUS).apply {
                setPackage(packageName)
                putExtra("running", running)
                putExtra("lastCycleAt", lastCycleAt)
                putExtra("matchedTotal", matchedTotal)
                putExtra("queued", ReportQueue.size(this@VerifierService))
                putExtra("walletEmpty", walletEmpty)
                putExtra("note", lastNote)
            }
            sendBroadcast(i)
        } catch (_: Throwable) {}
    }

    /* ────────────────────── wake lock ────────────────────── */

    /**
     * Held for the service lifetime. A 10s polling loop needs the CPU to be
     * awake; without this the Handler simply doesn't fire while the screen is
     * off. This is the service's main battery cost and is the reason the
     * battery-optimisation exemption prompt in src/lib/battery.js matters.
     */
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "EzyPay::Verifier").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "wake lock failed: ${t.message}")
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Throwable) {}
        wakeLock = null
    }

    /* ────────────────────── lifecycle ────────────────────── */

    /**
     * Fires when the user swipes the app out of Recents.
     *
     * With android:process=":verifier" this service isn't part of the activity's
     * task, so in the normal case this is never called at all — which is the
     * whole point of the process split. Kept as the safety net for a
     * same-process build (drop android:process and this is what saves you) and
     * for OEMs that route task removal differently.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(TAG, "task removed — scheduling self-restart")
        if (Prefs.isEnabled(this)) scheduleRestart(1_000L)
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        Log.i(TAG, "onDestroy (enabled=${Prefs.isEnabled(this)})")
        // Only fight back if the user didn't ask for this. An explicit stop
        // clears the enabled flag first, so this won't resurrect it.
        if (Prefs.isEnabled(this)) scheduleRestart(2_000L)
        stopLoop()
        super.onDestroy()
    }

    /**
     * Belt-and-braces restart via AlarmManager, on top of START_STICKY.
     * START_STICKY covers a process kill; this covers the cases where the
     * system drops the service without restarting it (some OEM policies).
     */
    private fun scheduleRestart(delayMs: Long) {
        try {
            val intent = Intent(this, BootReceiver::class.java).apply {
                action = BootReceiver.ACTION_RESTART
            }
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags = flags or PendingIntent.FLAG_IMMUTABLE
            }
            val pi = PendingIntent.getBroadcast(this, 1001, intent, flags)
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val at = System.currentTimeMillis() + delayMs

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // AllowWhileIdle so a Doze window can't swallow the recovery.
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "restart alarm failed: ${t.message}")
        }
    }
}
