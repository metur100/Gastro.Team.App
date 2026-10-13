import { Redirect } from 'expo-router'
import { View } from 'react-native'
import { useAuth } from '@/lib/auth'
import { Loading } from '@/components/ui'
import { colors } from '@/lib/theme'

export default function Index() {
  const { status } = useAuth()
  if (status === 'loading')
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.canvas }}>
        <Loading label="GastroTeam wird geladen …" />
      </View>
    )
  return <Redirect href={status === 'authenticated' ? '/heute' : '/login'} />
}
