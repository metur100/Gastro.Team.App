import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius, space, type } from '@/lib/theme'
import { ApiError, NetworkError, errorMessage } from '@/lib/api'

export function Screen({ title, subtitle, children, refreshing, onRefresh, scroll = true, right }: {
  title?: string
  subtitle?: string
  children: ReactNode
  refreshing?: boolean
  onRefresh?: () => void
  scroll?: boolean
  right?: ReactNode
}) {
  const header = title ? (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={type.title} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={[type.muted, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  ) : null
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={[type.heading, { marginTop: space.xl, marginBottom: space.sm }]} accessibilityRole="header">{children}</Text>
}

type Variant = 'primary' | 'outline' | 'ghost' | 'danger'
export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, accessibilityLabel }: {
  title: string
  onPress: () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  icon?: keyof typeof Ionicons.glyphMap
  accessibilityLabel?: string
}) {
  const v = {
    primary: { bg: colors.brand, fg: '#fff', border: colors.brand },
    outline: { bg: colors.surface, fg: colors.ink, border: colors.lineStrong },
    ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent' },
    danger: { bg: colors.danger, fg: '#fff', border: colors.danger },
  }[variant]
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [styles.button, { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Ionicons name={icon} size={18} color={v.fg} /> : null}
      <Text style={{ color: v.fg, fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  )
}

export const TextField = forwardRef<TextInput, TextInputProps & { label: string; error?: string; hint?: string }>(
  ({ label, error, hint, style, ...props }, ref) => (
    <View style={{ marginBottom: space.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.inkFaint}
        style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
        {...props}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">{error}</Text>
      ) : hint ? (
        <Text style={[type.small, { marginTop: 4 }]}>{hint}</Text>
      ) : null}
    </View>
  ),
)
TextField.displayName = 'TextField'

const BADGE = {
  neutral: [colors.subtle, colors.inkMuted],
  brand: [colors.brandTint, colors.brand],
  success: [colors.successTint, colors.success],
  warning: [colors.warningTint, colors.warning],
  danger: [colors.dangerTint, colors.danger],
  info: [colors.infoTint, colors.info],
} as const
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: keyof typeof BADGE }) {
  const [bg, fg] = BADGE[tone]
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: active ? colors.ink : colors.inkMuted }}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function Loading({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.brand} />
      <Text style={[type.muted, { marginTop: space.sm }]}>{label}</Text>
    </View>
  )
}

export function EmptyState({ icon = 'file-tray-outline', title, text, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={22} color={colors.inkFaint} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{title}</Text>
      {text ? <Text style={[type.muted, { textAlign: 'center', marginTop: 4 }]}>{text}</Text> : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const forbidden = error instanceof ApiError && error.status === 403
  const offline = error instanceof NetworkError
  return (
    <View style={styles.center} accessibilityRole="alert">
      <View style={[styles.emptyIcon, { backgroundColor: colors.dangerTint }]}>
        <Ionicons name={forbidden ? 'lock-closed-outline' : offline ? 'cloud-offline-outline' : 'alert-circle-outline'} size={22} color={colors.danger} />
      </View>
      <Text style={[type.heading, { textAlign: 'center' }]}>{forbidden ? 'Kein Zugriff' : offline ? 'Keine Verbindung' : 'Laden fehlgeschlagen'}</Text>
      <Text style={[type.muted, { textAlign: 'center', marginTop: 4 }]}>{errorMessage(error)}</Text>
      {onRetry && !forbidden ? (
        <View style={{ marginTop: space.lg }}>
          <Button title="Erneut versuchen" variant="outline" icon="refresh" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  )
}

/** Inline feedback banner (success / error) that disappears after a few seconds. */
export function Banner({ message, tone = 'success', onHide }: { message: string | null; tone?: 'success' | 'danger' | 'info'; onHide?: () => void }) {
  const [visible, setVisible] = useState(Boolean(message))
  useEffect(() => {
    setVisible(Boolean(message))
    if (!message) return
    const t = setTimeout(() => {
      setVisible(false)
      onHide?.()
    }, 4500)
    return () => clearTimeout(t)
  }, [message, onHide])
  if (!visible || !message) return null
  const [bg, fg] = { success: [colors.successTint, colors.success], danger: [colors.dangerTint, colors.danger], info: [colors.infoTint, colors.info] }[tone]
  return (
    <View style={[styles.banner, { backgroundColor: bg }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: fg, fontWeight: '600' }}>{message}</Text>
    </View>
  )
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={type.muted}>{label}</Text>
      {typeof value === 'string' ? <Text style={[type.body, { flexShrink: 1, textAlign: 'right' }]}>{value}</Text> : value}
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl * 2 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, gap: space.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg },
  button: { minHeight: 46, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: space.md, fontSize: 16, color: colors.ink },
  error: { color: colors.danger, fontSize: 13, fontWeight: '600', marginTop: 4 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.md, padding: 3, marginBottom: space.lg },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  banner: { borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.sm, gap: space.md },
})
