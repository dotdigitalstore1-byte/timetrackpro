package com.dotinout.app;

import android.content.ContentResolver;
import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native device checks for punch-in, exposed to the web app as window.TimeTrackNative
 * (see src/lib/device-security.ts on the web side).
 *
 * Attendance is blocked while either of these is true:
 *  - Developer Options is switched on.
 *  - A mock-location (fake GPS) app is allowed, or the last GPS or network fix came from a mock provider.
 *
 * Android does not let an app switch these off, so the web app only shows the block and asks the employee to
 * turn them off. The server also refuses punches that report either flag.
 */
public class DeviceSecurity {

    private static final String FAIL_CLOSED = "{\"blocked\":true,\"developerOptions\":true,\"mockLocation\":true}";

    private final Context context;

    public DeviceSecurity(Context context) {
        this.context = context.getApplicationContext();
    }

    /** True when Developer Options is switched on in Android Settings. */
    @JavascriptInterface
    public boolean isDeveloperOptionsEnabled() {
        try {
            ContentResolver cr = context.getContentResolver();
            return Settings.Global.getInt(cr, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 0;
        } catch (RuntimeException e) {
            return true; // cannot read the setting: treat as on (fail closed)
        }
    }

    /** True when a mock-location app is allowed, or the latest location fix came from a mock provider. */
    @JavascriptInterface
    public boolean isMockLocation() {
        return mockLocationAllowed() || lastFixIsMock();
    }

    /** JSON: {"blocked":bool,"developerOptions":bool,"mockLocation":bool}. Used by the web app on launch and before each punch. */
    @JavascriptInterface
    public String securityStatus() {
        boolean developerOptions = isDeveloperOptionsEnabled();
        boolean mockLocation = isMockLocation();
        JSONObject status = new JSONObject();
        try {
            status.put("developerOptions", developerOptions);
            status.put("mockLocation", mockLocation);
            status.put("blocked", developerOptions || mockLocation);
            return status.toString();
        } catch (JSONException e) {
            return FAIL_CLOSED;
        }
    }

    @SuppressWarnings("deprecation") // ALLOW_MOCK_LOCATION is deprecated but still set by the system on older devices
    private boolean mockLocationAllowed() {
        try {
            String value = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ALLOW_MOCK_LOCATION);
            return value != null && !value.isEmpty() && !"0".equals(value);
        } catch (RuntimeException e) {
            return true; // cannot read the setting: treat as allowed (fail closed)
        }
    }

    private boolean lastFixIsMock() {
        LocationManager lm = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return false;
        String[] providers = {LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER};
        for (String provider : providers) {
            try {
                Location fix = lm.getLastKnownLocation(provider);
                if (fix != null && isMockFix(fix)) return true;
            } catch (SecurityException | IllegalArgumentException e) {
                // Location permission not granted yet, or provider unavailable: nothing to check here.
            }
        }
        return false;
    }

    @SuppressWarnings("deprecation") // isFromMockProvider() is the pre-Android 12 equivalent of isMock()
    private static boolean isMockFix(Location fix) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? fix.isMock() : fix.isFromMockProvider();
    }
}
