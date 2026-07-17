package cloud.trsinternational.payverify.verifier

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers VerifierModule with the RN bridge.
 *
 * Not autolinked — this is app-local native code, not an npm package — so it
 * must be added by hand in MainApplication.getPackages(). See the
 * `add(VerifierPackage())` line there.
 *
 * createNativeModules is marked deprecated upstream in favour of
 * BaseReactPackage/getModule, but that path is part of the new architecture and
 * this app runs newArchEnabled=false. The legacy hook is the correct one here.
 */
@Suppress("DEPRECATION")
class VerifierPackage : ReactPackage {

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(VerifierModule(reactContext))

    // Signature must match ReactPackage.kt exactly: List<ViewManager<in Nothing, in Nothing>>.
    // We contribute no views.
    override fun createViewManagers(
        reactContext: ReactApplicationContext
    ): List<ViewManager<in Nothing, in Nothing>> = emptyList()
}
