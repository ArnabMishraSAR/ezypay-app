package cloud.trsinternational.payverify.verifier

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import cloud.trsinternational.payverify.R

/**
 * The persistent foreground notification.
 *
 * Built on the platform Notification API rather than androidx NotificationCompat
 * so the :verifier process pulls in nothing from React Native's dependency
 * graph. See the note in ApiClient for the reasoning.
 */
object NotificationHelper {

    const val CHANNEL_ID = "payverify_verifier"
    const val NOTIFICATION_ID = 4711   // must be non-zero for startForeground

    private const val CHANNEL_NAME = "Payment monitoring"
    private const val CHANNEL_DESC = "Shows while EzyPay is watching wallet SMS to auto-verify payments."

    /**
     * IMPORTANCE_LOW: ongoing, visible, but silent. IMPORTANCE_DEFAULT would
     * make the phone chime on every notification update — and this one updates
     * on every polling cycle.
     */
    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = CHANNEL_DESC
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(channel)
    }

    /**
     * Tapping the notification reopens the app. Resolved by intent rather than
     * by hardcoding MainActivity, so this file stays valid if Expo renames the
     * launcher activity on a future prebuild.
     */
    private fun contentIntent(ctx: Context): PendingIntent? {
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        // Required from API 31; harmless to add from 23 onward.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags = flags or PendingIntent.FLAG_IMMUTABLE
        }
        return PendingIntent.getActivity(ctx, 0, launch, flags)
    }

    @Suppress("DEPRECATION")   // pre-O Builder ctor; minSdk is below 26
    fun build(ctx: Context, title: String, text: String): Notification {
        ensureChannel(ctx)

        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(ctx, CHANNEL_ID)
        } else {
            Notification.Builder(ctx)
        }

        b.setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_verify)
            .setOngoing(true)                       // not swipe-dismissable
            .setOnlyAlertOnce(true)                 // updates must never re-alert
            .setContentIntent(contentIntent(ctx))
            .setStyle(Notification.BigTextStyle().bigText(text))

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b.setColor(Color.parseColor("#7c3aed"))  // matches the old service's accent
        } else {
            b.setPriority(Notification.PRIORITY_LOW)
        }

        return b.build()
    }

    /**
     * Updates the existing notification in place. No-op'd by the system if the
     * user revoked POST_NOTIFICATIONS on Android 13+ — which does NOT stop the
     * service, it just hides it.
     */
    fun update(ctx: Context, title: String, text: String) {
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, build(ctx, title, text))
        } catch (_: Throwable) {
            // Never let a notification failure take down the polling loop.
        }
    }
}
