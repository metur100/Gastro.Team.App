import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/display'
import { LocationProvider, useAuth } from '@/lib/auth'

const page = (loader: () => Promise<{ default: () => ReactNode }>) => {
  const C = lazy(loader)
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  )
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="GastroTeam wird geladen …" />
    </div>
  )
}

/** Requires a session; users without any restaurant are sent to onboarding. */
function RequireAuth() {
  const { status, me } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'anonymous') {
    const next = location.pathname + location.search
    return <Navigate to={`/anmelden${next !== '/' ? `?weiter=${encodeURIComponent(next)}` : ''}`} replace />
  }
  if (me && !me.currentTenant && !location.pathname.startsWith('/onboarding') && !location.pathname.startsWith('/einladung') && !location.pathname.startsWith('/plattform'))
    return <Navigate to="/onboarding" replace />
  return (
    <LocationProvider>
      <Outlet />
    </LocationProvider>
  )
}

function PublicOnly() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') {
    const next = new URLSearchParams(location.search).get('weiter')
    return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} replace />
  }
  return <Outlet />
}

const router = createBrowserRouter(
  [
    {
      element: <PublicOnly />,
      children: [
        { path: '/anmelden', element: page(() => import('@/features/auth/LoginPage')) },
        { path: '/registrieren', element: page(() => import('@/features/auth/RegisterPage')) },
        { path: '/passwort-vergessen', element: page(() => import('@/features/auth/ForgotPasswordPage')) },
      ],
    },
    // Reachable with or without a session.
    { path: '/email-bestaetigen', element: page(() => import('@/features/auth/VerifyEmailPage')) },
    { path: '/passwort-zuruecksetzen', element: page(() => import('@/features/auth/ResetPasswordPage')) },
    { path: '/einladung/:token', element: page(() => import('@/features/auth/InvitationPage')) },
    {
      element: <RequireAuth />,
      children: [
        { path: '/onboarding', element: page(() => import('@/features/onboarding/OnboardingPage')) },
        {
          element: <AppShell />,
          children: [
            { index: true, element: page(() => import('@/features/dashboard/HomePage')) },
            { path: '/schichtplan', element: page(() => import('@/features/schedule/SchedulePage')) },
            { path: '/meine-schichten', element: page(() => import('@/features/my-shifts/MyShiftsPage')) },
            { path: '/mitarbeiter', element: page(() => import('@/features/employees/EmployeesPage')) },
            { path: '/mitarbeiter/:id', element: page(() => import('@/features/employees/EmployeeDetailPage')) },
            { path: '/verfuegbarkeit', element: page(() => import('@/features/availability/AvailabilityPage')) },
            { path: '/urlaub', element: page(() => import('@/features/leave/LeavePage')) },
            { path: '/schichttausch', element: page(() => import('@/features/swaps/SwapsPage')) },
            { path: '/benachrichtigungen', element: page(() => import('@/features/notifications/NotificationsPage')) },
            { path: '/auswertungen', element: page(() => import('@/features/reports/ReportsPage')) },
            { path: '/standorte', element: page(() => import('@/features/locations/LocationsPage')) },
            { path: '/einstellungen', element: page(() => import('@/features/settings/SettingsPage')) },
            { path: '/profil', element: page(() => import('@/features/profile/ProfilePage')) },
            { path: '/plattform', element: page(() => import('@/features/platform/PlatformPage')) },
            { path: '*', element: page(() => import('@/features/NotFoundPage')) },
          ],
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
)

export default function App() {
  return <RouterProvider router={router} />
}
