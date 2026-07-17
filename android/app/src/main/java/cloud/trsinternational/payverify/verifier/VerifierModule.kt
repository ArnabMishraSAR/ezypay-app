package cloud.trsinternational.payverify.verifier

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * RN <-> native bridge. Legacy bridge module, not a TurboModule: this app runs
 * newArchEnabled=false (see gradle.properties / app.json), so the codegen path
 * isn't available. Functionally identical for start / stop / status.
 *
 * JS is deliberately limited to three things — start, stop, observe. All SMS
 * reading, matching and reporting happens in :verifier, with no JS involvement,
 * so it keeps working after the RN runtime is gone.
 */
class VerifierModule(private val reactCtx: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactCtx) {

    companion object {
        const val NAME = "EzyPayVerifier"
        private const val TAG = "PVVerifier/Bridge"
        private const val EVENT = "EzyPayVerifierStatus"
    }

    override fun getName(): String = NAME

    /** Last status pushed from the :verifier process. */
    private var cached: WritableMap? = null
    private var receiver: BroadcastReceiver? = null

    override fun initialize() {
        super.initialize()
        registerStatusReceiver()
    }

    /**
     * The service lives in another process, so its in-memory counters can't be
     * read directly and SharedPreferences wouldn't be coherent across the two.
     * Instead :verifier broadcasts after each cycle and we cache the latest.
     */
    private fun registerStatusReceiver() {
        if (receiver != null) return

        val r = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent == null) return
                val m = Arguments.createMap().apply {
                    putBoolean("running", intent.getBooleanExtra("running", false))
                    putDouble("lastCycleAt", intent.getLongExtra("lastCycleAt", 0L).toDouble())
                    putInt("matchedTotal", intent.getIntExtra("matchedTotal", 0))
                    putInt("queued", intent.getIntExtra("queued", 0))
                    putBoolean("walletEmpty", intent.getBooleanExtra("walletEmpty", false))
                    putString("note", intent.getStringExtra("note"))
                }
                cached = m.copy()
                emit(m)
            }
        }

        val filter = IntentFilter(VerifierService.ACTION_STATUS)
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                // Not required at targetSdk 33, but explicit is correct and
                // keeps this valid if the target is ever raised.
                reactCtx.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                reactCtx.registerReceiver(r, filter)
            }
            receiver = r
        } catch (t: Throwable) {
            Log.w(TAG, "receiver registration failed: ${t.message}")
        }
    }

    private fun emit(m: WritableMap) {
        try {
            if (!reactCtx.hasActiveReactInstance()) return
            reactCtx
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(EVENT, m)
        } catch (_: Throwable) {
            // JS is gone (app backgrounded/killed) — the service carries on.
        }
    }

    override fun invalidate() {
        try { receiver?.let { reactCtx.unregisterReceiver(it) } } catch (_: Throwable) {}
        receiver = null
        super.invalidate()
    }

    /**
     * Works for our own services even though getRunningServices is deprecated
     * for inspecting other apps. This is the only reliable cross-process
     * "is it alive?" check available without binding.
     */
    @Suppress("DEPRECATION")
    private fun isServiceRunning(): Boolean = try {
        val am = reactCtx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        am.getRunningServices(Int.MAX_VALUE)
            .any { it.service.className == VerifierService::class.java.name }
    } catch (t: Throwable) {
        Log.w(TAG, "getRunningServices failed: ${t.message}")
        false
    }

    /* ────────────────────── JS API ────────────────────── */

    /**
     * Starts the native foreground service.
     *
     * @param authKey  the merchant's device_auth_key
     * @param deviceId the id from getOrCreateDeviceId()
     * @param baseUrl  API_BASE_URL from expo-constants
     *
     * The config is persisted (synchronously — see Prefs.saveConfig) before the
     * service starts, so the freshly spawned :verifier process reads it from
     * disk, and so BootReceiver can restart everything with no JS present.
     */
    @ReactMethod
    fun start(authKey: String?, deviceId: String?, baseUrl: String?, promise: Promise) {
        try {
            if (authKey.isNullOrBlank() || deviceId.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                promise.resolve(false)
                return
            }
            Prefs.saveConfig(reactCtx, authKey, deviceId, baseUrl)
            Prefs.setEnabled(reactCtx, true)
            VerifierService.start(reactCtx, authKey, deviceId, baseUrl)
            promise.resolve(true)
        } catch (t: Throwable) {
            Log.e(TAG, "start failed: ${t.message}", t)
            promise.reject("E_START", t.message, t)
        }
    }

    /** Stops the service and clears the enabled flag so boot won't revive it. */
    @ReactMethod
    fun stop(promise: Promise) {
        try {
            Prefs.setEnabled(reactCtx, false)
            VerifierService.stop(reactCtx)
            promise.resolve(true)
        } catch (t: Throwable) {
            Log.e(TAG, "stop failed: ${t.message}", t)
            promise.reject("E_STOP", t.message, t)
        }
    }

    /**
     * Wipes the stored session. Call on unbind — otherwise BootReceiver would
     * happily restart a service holding a revoked auth key.
     */
    @ReactMethod
    fun clearSession(promise: Promise) {
        try {
            VerifierService.stop(reactCtx)
            Prefs.clear(reactCtx)
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("E_CLEAR", t.message, t)
        }
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val running = isServiceRunning()
            val m = cached?.copy() ?: Arguments.createMap()
            // Live process check beats the cached flag: the cache can be stale
            // if the service died between broadcasts.
            m.putBoolean("running", running)
            m.putBoolean("enabled", Prefs.isEnabled(reactCtx))
            m.putInt("queuedNow", ReportQueue.size(reactCtx))
            promise.resolve(m)
        } catch (t: Throwable) {
            promise.reject("E_STATUS", t.message, t)
        }
    }

    /* Required by NativeEventEmitter; the receiver above does the real work. */
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Double) {}
}
