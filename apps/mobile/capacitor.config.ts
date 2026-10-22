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
    url: 'https://app.lifekeel.co.uk',
    // Keep OAuth and deep links inside the shell instead of kicking out
    // to Safari — auth flows bounce through the API domain.
    allowNavigation: [
      'app.lifekeel.co.uk',
      'api.lifekeel.co.uk',
      'app.lifekeel.si',
      'api.lifekeel.si',
      // Only the API host this build talks to, never every Cloud Run
      // service (R34). Set when the API isn't on an api.lifekeel.* domain.
      ...(process.env['LIFEKEEL_API_HOST'] ? [process.env['LIFEKEEL_API_HOST']] : []),
    ],
  },
  ios: {
    contentInset: 'never',
    scheme: 'LifeKeel',
  },
  plugins: {
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
