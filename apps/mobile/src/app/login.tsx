import { KeyboardAvoidingView, Platform, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '@/lib/auth'
import { colors, space, type } from '@/lib/theme'
import { Screen } from '@/components/ui'
import { LoginForm } from '@/components/LoginForm'

export default function LoginScreen() {
  const { signIn } = useAuth()
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ alignItems: 'flex-start', marginTop: space.xxl, marginBottom: space.xl }}>
          <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="calendar" size={24} color="#fff" />
          </View>
          <Text style={[type.title, { marginTop: space.lg }]} accessibilityRole="header">Willkommen bei GastroTeam</Text>
          <Text style={[type.muted, { marginTop: space.xs }]}>Melden Sie sich mit Ihrem Konto an. Ihre Leitung lädt Sie per Link ein.</Text>
        </View>
        <LoginForm
          onSubmit={async (email, password) => {
            await signIn(email, password)
            router.replace('/heute')
          }}
          onForgot={() => router.push('/passwort-vergessen')}
        />
      </Screen>
    </KeyboardAvoidingView>
  )
}
