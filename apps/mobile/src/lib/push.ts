import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { api } from './api'

let currentToken: string | null = null

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

export type PushState = 'registered' | 'denied' | 'unsupported' | 'not-configured' | 'error'

/**
 * Registers the device for push notifications if possible. Requires a physical device, a development or
 * production build (not Expo Go on Android) and an EAS project id. Failures never block the app.
 */
export async function registerForPush(): Promise<PushState> {
  try {
    if (!Device.isDevice) return 'unsupported'
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId
    if (!projectId) return 'not-configured'
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Allgemein', importance: Notifications.AndroidImportance.DEFAULT })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return 'denied'
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data
    await api.post('/me/push-devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' })
    currentToken = token
    return 'registered'
  } catch {
    return 'error'
  }
}

export async function unregisterPush() {
  if (!currentToken) return
  try {
    await api.del(`/me/push-devices?token=${encodeURIComponent(currentToken)}`)
  } catch {
    // ignore: the server removes stale tokens when delivery fails
  } finally {
    currentToken = null
  }
}

/** Maps web routes contained in notification links to app routes. */
export function routeForLink(link: string | null | undefined): string {
  if (!link) return '/benachrichtigungen'
  if (link.startsWith('/meine-schichten') || link.startsWith('/schichtplan')) return '/schichten'
  if (link.startsWith('/urlaub')) return '/anfragen?tab=urlaub'
  if (link.startsWith('/schichttausch')) return '/anfragen?tab=tausch'
  return '/heute'
}
