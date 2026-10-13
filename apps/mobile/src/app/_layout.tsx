import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { ApiError } from '@/lib/api'
import { AuthProvider } from '@/lib/auth'
import { routeForLink } from '@/lib/push'
import { colors } from '@/lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
  },
})

function useNotificationNavigation() {
  useEffect(() => {
    const open = (data: unknown) => {
      const link = (data as { link?: string } | undefined)?.link
      router.push(routeForLink(link) as never)
    }
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data))
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data))
    return () => sub.remove()
  }, [])
}

export default function RootLayout() {
  useNotificationNavigation()
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerTintColor: colors.brand,
              headerTitleStyle: { color: colors.ink },
              headerStyle: { backgroundColor: colors.surface },
              contentStyle: { backgroundColor: colors.canvas },
              headerBackTitle: 'Zurück',
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="passwort-vergessen" options={{ title: 'Passwort vergessen' }} />
            <Stack.Screen name="einladung/[token]" options={{ title: 'Einladung' }} />
            <Stack.Screen name="schicht/[id]" options={{ title: 'Schicht' }} />
            <Stack.Screen name="benachrichtigungen" options={{ title: 'Benachrichtigungen' }} />
            <Stack.Screen name="urlaub-neu" options={{ title: 'Neuer Antrag', presentation: 'modal' }} />
          </Stack>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}
