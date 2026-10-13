export const colors = {
  canvas: '#f6f6f4',
  surface: '#ffffff',
  subtle: '#f1f1ee',
  line: '#e5e4df',
  lineStrong: '#d4d3cc',
  ink: '#1c1b18',
  inkMuted: '#57554f',
  inkFaint: '#85837b',
  brand: '#0c6358',
  brandLight: '#0f7a6a',
  brandTint: '#effaf7',
  brandTintStrong: '#d5f2ea',
  danger: '#c2362b',
  dangerTint: '#fef2f2',
  warning: '#9a5b05',
  warningTint: '#fff8eb',
  info: '#1f4fa8',
  infoTint: '#eff5ff',
  success: '#15703f',
  successTint: '#ecfaf1',
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const radius = { sm: 6, md: 10, lg: 14 }

export const type = {
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 15, color: colors.ink },
  muted: { fontSize: 14, color: colors.inkMuted },
  small: { fontSize: 12, color: colors.inkFaint },
}
