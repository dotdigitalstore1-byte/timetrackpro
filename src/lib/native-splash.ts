/**
 * Inline script for the native apps. It hides the native splash (indigo, with the logo) once the server-rendered
 * word animation is on screen, instead of waiting for the JavaScript bundle to load and hydrate. Two animation frames
 * are waited for so the overlay has been painted first, so there is no gap between the logo and the word.
 * Capacitor injects its bridge into the WebView, so window.Capacitor is available for the hosted app. If it is not
 * (for example in a browser), the script does nothing and NativeBootstrap hides the splash after hydration instead.
 */
export const HIDE_NATIVE_SPLASH_SCRIPT =
  "requestAnimationFrame(function(){requestAnimationFrame(function(){try{" +
  "var s=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.SplashScreen;" +
  "if(s&&s.hide){s.hide({fadeOutDuration:250});}" +
  "}catch(e){}});});";
