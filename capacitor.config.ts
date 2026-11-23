import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native shell for the Dotinout employee app (Android and iOS).
 *
 * Dotinout is a server-rendered Next.js app with cookie sessions and server-only data access, so the native
 * apps load the hosted web app instead of a bundled copy of it. Set CAPACITOR_SERVER_URL to the public https URL
 * of the deployment before running `npx cap sync` (for example https://app.dotinout.com).
 *
 * `webDir` points at a small offline placeholder shell (mobile-www/). Capacitor requires it to contain an
 * index.html to create the native projects; it is only shown if the server URL is not configured.
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

if (serverUrl && !/^https:\/\//i.test(serverUrl) && !/^http:\/\/(localhost|10\.0\.2\.2)(:\d+)?/i.test(serverUrl)) {
  throw new Error('CAPACITOR_SERVER_URL must be an https:// URL in production builds.');
}

const config: CapacitorConfig = {
  appId: 'com.dotinout.app',
  appName: 'dotinout',
  webDir: 'mobile-www',
  server: {
    androidScheme: 'https',
    ...(serverUrl
      ? {
          url: serverUrl,
          // Plain http is only ever allowed for a local development server (emulator uses 10.0.2.2).
          cleartext: serverUrl.startsWith('http://'),
        }
      : {}),
  },
  plugins: {
    SplashScreen: {
      // The splash stays until the app's first screen has painted (NativeBootstrap hides it). It never auto-hides early.
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#4F46E5',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
  android: {
    // Brand colour behind the WebView until the first page paints, so the launch never shows a black frame.
    backgroundColor: '#4F46E5',
    // Keep the Android WebView from being debugged in production builds.
    webContentsDebuggingEnabled: false,
    // The server uses this token to allow employee attendance and leave only inside the mobile app.
    appendUserAgent: 'DotinoutNative/1',
  },
  ios: {
    backgroundColor: '#4F46E5',
    contentInset: 'automatic',
    scrollEnabled: true,
    appendUserAgent: 'DotinoutNative/1',
  },
};

export default config;
