package expo.modules.devicesecurity

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Port of the Capacitor DeviceSecurity.java check. Attendance is blocked while Developer Options is on, or while a
 * mock-location app is allowed, or the last GPS or network fix came from a mock provider.
 * Any read that fails is treated as blocked (fail closed). The server also refuses punches that report either flag.
 */
class DeviceSecurityModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("DeviceSecurity")

    Function("getStatus") {
      val context: Context = appContext.reactContext ?: return@Function failClosed()
      val developerOptions = isDeveloperOptionsEnabled(context)
      val mockLocation = mockLocationAllowed(context) || lastFixIsMock(context)
      mapOf(
        "developerOptions" to developerOptions,
        "mockLocation" to mockLocation,
        "blocked" to (developerOptions || mockLocation)
      )
    }
  }

  private fun failClosed(): Map<String, Any> =
    mapOf("developerOptions" to true, "mockLocation" to true, "blocked" to true)

  private fun isDeveloperOptionsEnabled(context: Context): Boolean {
    return try {
      Settings.Global.getInt(context.contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0
    } catch (e: RuntimeException) {
      true
    }
  }

  @Suppress("DEPRECATION") // ALLOW_MOCK_LOCATION is deprecated but still set by the system on older devices
  private fun mockLocationAllowed(context: Context): Boolean {
    return try {
      val value = Settings.Secure.getString(context.contentResolver, Settings.Secure.ALLOW_MOCK_LOCATION)
      !value.isNullOrEmpty() && value != "0"
    } catch (e: RuntimeException) {
      true
    }
  }

  private fun lastFixIsMock(context: Context): Boolean {
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      try {
        val fix: Location? = lm.getLastKnownLocation(provider)
        if (fix != null && isMockFix(fix)) return true
      } catch (e: SecurityException) {
        // Location permission not granted yet: nothing to check for this provider.
      } catch (e: IllegalArgumentException) {
        // Provider not available on this device.
      }
    }
    return false
  }

  @Suppress("DEPRECATION") // isFromMockProvider() is the pre-Android 12 equivalent of isMock()
  private fun isMockFix(fix: Location): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) fix.isMock else fix.isFromMockProvider
  }
}
