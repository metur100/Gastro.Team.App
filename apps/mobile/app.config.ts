import type { ExpoConfig, ConfigContext } from 'expo/config'

/**
 * Values marked REPLACE must be confirmed before a store release (see docs/STORE_RELEASE.md):
 * bundle identifier / package name, EAS project id, associated domain for universal links.
 */
const APP_VARIANT = process.env.APP_VARIANT ?? 'production'
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://gastroteam.runasp.net'
const BUNDLE_ID = process.env.GT_BUNDLE_ID ?? 'de.gastroteam.app' // REPLACE if a different identifier is registered
const suffix = APP_VARIANT === 'production' ? '' : `.${APP_VARIANT}`

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_VARIANT === 'production' ? 'GastroTeam' : `GastroTeam (${APP_VARIANT})`,
  slug: 'gastroteam',
  scheme: 'gastroteam',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#f6f6f4',
  ios: {
    bundleIdentifier: `${BUNDLE_ID}${suffix}`,
    supportsTablet: false,
    buildNumber: '1',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
    // associatedDomains: ['applinks:app.gastroteam.de'], // REPLACE when a domain with apple-app-site-association exists
  },
  android: {
    package: `${BUNDLE_ID}${suffix}`,
    versionCode: 1,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#0c6358' },
    permissions: ['POST_NOTIFICATIONS'],
    blockedPermissions: ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, resizeMode: 'contain', backgroundColor: '#0c6358' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#0c6358' }],
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiUrl: API_URL,
    appVariant: APP_VARIANT,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined, // REPLACE via env after `eas init`
  },
})
