package cloud.trsinternational.payverify

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.Process

import cloud.trsinternational.payverify.verifier.VerifierPackage

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())

              // App-local native code, so autolinking never sees it. Exposes
              // NativeModules.EzyPayVerifier (start / stop / getStatus).
              add(VerifierPackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()

    // The verifier foreground service runs in its own process (:verifier, see
    // AndroidManifest) so that swiping the app out of Recents kills only the UI
    // process and leaves SMS polling untouched.
    //
    // Application.onCreate runs in EVERY process of the app, including that
    // one. Without this guard the service process would boot a second, entirely
    // pointless React Native + Expo runtime: double the memory, a second Hermes
    // VM, and Expo module initialisation with no Activity to attach to. The
    // service deliberately depends on nothing from RN, so it needs none of it.
    //
    // (Firebase is unaffected: it initialises via FirebaseInitProvider, a
    // ContentProvider, and providers without android:process only instantiate
    // in the default process — so :verifier never pulls Firebase in either.)
    if (!isMainProcess()) return

    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // Guarded for the same reason as onCreate: in :verifier the Expo dispatcher
    // was never initialised, so handing it a config change would blow up.
    if (!isMainProcess()) return
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  /**
   * True only in the app's default process. The service process is named
   * "<package>:verifier"; the main one is exactly the package name.
   */
  private fun isMainProcess(): Boolean {
    val name = currentProcessName() ?: return true   // unknown: assume main
    return name == packageName
  }

  private fun currentProcessName(): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      // Application.getProcessName() is a STATIC method added in API 28 —
      // qualify it so it doesn't get mistaken for an instance member.
      return Application.getProcessName()
    }
    return try {
      val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val pid = Process.myPid()
      am.runningAppProcesses?.firstOrNull { it.pid == pid }?.processName
    } catch (e: Throwable) {
      null
    }
  }
}
