package cloud.trsinternational.payverify.verifier

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Brings the verifier back after a reboot, an app update, or a service kill.
 *
 * This is the piece that makes the service durable across the events that
 * previously required the user to manually reopen the app. It runs with no
 * React Native anywhere — everything it needs comes from Prefs, which is
 * exactly why the session is mirrored out of AsyncStorage.
 *
 * Starting a foreground service from BOOT_COMPLETED is permitted (boot is an
 * explicit exemption from the background-start restrictions), and at
 * targetSdk 33 we're also outside Android 14's FGS-type start restrictions.
 *
 * OEM caveat: on Xiaomi / Oppo / Vivo / Realme / Huawei, BOOT_COMPLETED is not
 * delivered at all unless the user has enabled Autostart for the app. No API
 * can work around that — it's why src/lib/battery.js prompts the user.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PVVerifier/Boot"

        /** Fired by VerifierService.scheduleRestart via AlarmManager. */
        const val ACTION_RESTART = "cloud.trsinternational.payverify.verifier.RESTART"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.i(TAG, "received $action")

        val relevant = when (action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            ACTION_RESTART -> true
            // Non-standard boot broadcasts used by some HTC/Xiaomi ROMs.
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> true
            else -> false
        }
        if (!relevant) return

        // The user's intent, not the service's last known state. An explicit
        // stop (or unbind) clears this, so we never resurrect something the
        // user switched off.
        if (!Prefs.isEnabled(context)) {
            Log.i(TAG, "not enabled — staying off")
            return
        }

        val authKey  = Prefs.authKey(context)
        val deviceId = Prefs.deviceId(context)
        val baseUrl  = Prefs.baseUrl(context)

        if (authKey.isNullOrBlank() || deviceId.isNullOrBlank() || baseUrl.isNullOrBlank()) {
            Log.w(TAG, "enabled but config missing — cannot start")
            return
        }

        try {
            VerifierService.start(context, authKey, deviceId, baseUrl)
            Log.i(TAG, "service start requested")
        } catch (t: Throwable) {
            // ForegroundServiceStartNotAllowedException can still surface here
            // on some OEM builds. Nothing useful to do but not crash.
            Log.e(TAG, "could not start service: ${t.javaClass.simpleName}: ${t.message}")
        }
    }
}
