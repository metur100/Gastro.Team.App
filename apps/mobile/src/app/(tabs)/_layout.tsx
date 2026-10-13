import type { ColorValue } from 'react-native'
import { Redirect, Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth, usePermissions } from '@/lib/auth'
import { colors } from '@/lib/theme'

type IconName = keyof typeof Ionicons.glyphMap

export default function TabsLayout() {
  const { status } = useAuth()
  const p = usePermissions()
  if (status === 'anonymous') return <Redirect href="/login" />
  const icon = (name: IconName) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color} size={size} />
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="heute" options={{ title: 'Heute', tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="schichten" options={{ title: 'Schichten', tabBarIcon: icon('calendar-outline'), href: p.employeeId ? undefined : null }} />
      <Tabs.Screen
        name="verfuegbarkeit"
        options={{ title: 'Verfügbarkeit', tabBarIcon: icon('time-outline'), href: p.employeeId && p.hasFeature('Availability') ? undefined : null }}
      />
      <Tabs.Screen name="anfragen" options={{ title: 'Anfragen', tabBarIcon: icon('swap-horizontal-outline') }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  )
}
