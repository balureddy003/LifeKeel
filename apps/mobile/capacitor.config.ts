import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Thin native shell — `server.url` points at the deployed PWA rather than
 * bundling apps/web's `out/` export, so ship-web and ship-app can never
 * drift apart. The trade-off is deliberate: the shell can't render the
 * app fully offline (the service worker inside the WKWebView still caches
 * the app shell, so real-world offline behaviour is closer than it looks),
 * and what the shell buys is exactly what the PWA can't do — APNs push on
 * iOS, native camera quality, and biometric unlock via the plugins below.
 */
const config: CapacitorConfig = {
  appId: 'uk.co.lifekeel.app',
  appName: 'LifeKeel',
  // webDir is required by the CLI even though server.url wins at runtime —
  // `cap sync` copies it but it is never served. Keep it minimal.
  webDir: 'www',
  server: {
    // Canonical entry point. server.url is build-time config, so every launch
    // starts here; apps/web's NativeRegionGate then redirects a Slovenian
    // user to app.lifekeel.si (accounts and sessions are per TLD).
    // LIFEKEEL_WEB_URL points a test build at staging; unset, it is production.
    url: process.env['LIFEKEEL_WEB_URL'] || 'https://app.lifekeel.co.uk',
    // Local page (copied into www by the prepare scripts) shown when the site cannot be reached.
    errorPath: 'offline.html',
    // Keep OAuth and deep links inside the shell instead of kicking out
    // to Safari — auth flows bounce through the API domain.
    allowNavigation: [
      'app.lifekeel.co.uk',
      'api.lifekeel.co.uk',
      'app.lifekeel.si',
      'api.lifekeel.si',
      // Only the API host this build talks to, never every Cloud Run
      // service (R34). Set when the API isn't on an api.lifekeel.* domain.
      ...(process.env['LIFEKEEL_WEB_URL'] ? [new URL(process.env['LIFEKEEL_WEB_URL']).host] : []),
      ...(process.env['LIFEKEEL_API_HOST'] ? [process.env['LIFEKEEL_API_HOST']] : []),
    ],
  },
  ios: {
    contentInset: 'never',
    scheme: 'LifeKeel',
    // The page's own background (light theme), so there is no black or white flash before it paints.
    backgroundColor: '#FDFCF9',
  },
  plugins: {
    SplashScreen: {
      // The branded launch screen stays up until the web app calls hide() (NativeRegionGate), with a
      // timer as the backstop so a page that never loads cannot leave it up.
      launchShowDuration: 4000,
      launchAutoHide: true,
      launchFadeOutDuration: 200,
      backgroundColor: '#FDFCF9',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    BiometricAuth: {
      // Face ID usage description (iOS) — androidSubtitle handled by plugin UI.
      iosBiometryLocalizedReason: 'Unlock LifeKeel to see your family\u2019s data',
    },
  },
}

export default config
