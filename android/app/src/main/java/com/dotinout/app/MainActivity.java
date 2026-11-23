package com.dotinout.app;

import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onPause() {
        // WebView writes cookies to disk asynchronously. Flushing when the app goes to the background keeps the
        // sign-in cookie if the app is later swiped away from Recent Apps, so the employee stays signed in.
        CookieManager.getInstance().flush();
        super.onPause();
    }
}
