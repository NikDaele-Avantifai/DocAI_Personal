import { useState, useEffect, useCallback } from "react"
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import Layout from "./components/Layout"
import ProtectedRoute from "./components/ProtectedRoute"
import SearchModal from "./components/SearchModal"
import NotificationPanel from "./components/NotificationPanel"
import ChatBot from "./components/ChatBot"
import TourOverlay from "./components/TourOverlay"
import { TourProvider } from "./contexts/TourContext"
import { AuthProvider } from "./contexts/AuthContext"
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext"
import { useSessionTimeout } from "./hooks/useSessionTimeout"
import { SessionWarning } from "./components/SessionWarning"

import AdminDashboard from "./pages/AdminDashboard"
import LoginPage from "./pages/LoginPage"
import OverviewPage from "./pages/OverviewPage"
import ApprovalsPage from "./pages/ApprovalsPage"
import AuditPage from "./pages/AuditPage"
import PagesPage from "./pages/PagesPage"
import BatchPage from "./pages/BatchPage"
import DuplicatesPage from "./pages/DuplicatesPage"
import SettingsPage from "./pages/SettingsPage"
import UsagePage from "./pages/UsagePage"
import SettingsLayout from "./components/SettingsLayout"
import TeamPage from "./pages/settings/TeamPage"
import PrivacyPage from "./pages/settings/PrivacyPage"
import ProfilePage from "./pages/settings/ProfilePage"

/** Redirects to /settings if Confluence is not yet connected and onboarding is incomplete. */
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { workspace, isLoading } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (isLoading) return
    if (!workspace) return
    const exempt =
      location.pathname === "/settings" ||
      location.pathname.startsWith("/settings/") ||
      location.pathname === "/login"
    if (!workspace.confluence_connected && !workspace.onboarding_completed && !exempt) {
      navigate("/settings", { replace: true, state: { onboarding: true } })
    }
  }, [workspace, isLoading, location.pathname, navigate])

  return <>{children}</>
}

interface AppProps {
  /** True when Auth0 is not configured (local dev). All routes are accessible. */
  bypassAuth?: boolean
}

/**
 * Inner component that lives inside AuthProvider so it can call Auth0 hooks.
 * Owns session timeout state and wires up the warning banner.
 */
function AppContent({ bypassAuth }: { bypassAuth: boolean }) {
  const wrap = (el: React.ReactNode) =>
    bypassAuth ? <>{el}</> : <ProtectedRoute>{el}</ProtectedRoute>

  const [warningSeconds, setWarningSeconds] = useState<number | null>(null)

  const handleWarning = useCallback((seconds: number) => {
    setWarningSeconds(seconds)
  }, [])

  const handleDismissWarning = useCallback(() => {
    setWarningSeconds(null)
    // Dispatching activity resets the idle timer in the hook
    window.dispatchEvent(new MouseEvent('mousedown'))
  }, [])

  useSessionTimeout(handleWarning)

  return (
    <WorkspaceProvider>
      <TourProvider>
        <OnboardingGuard>
          <>
            <Routes>
              {/* Internal admin — no Auth0, no WorkspaceProvider */}
              <Route path="/admin" element={<AdminDashboard />} />

              {/* Public */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected — main app under Layout */}
              <Route element={wrap(<Layout />)}>
                <Route index element={<Navigate to="/overview" replace />} />
                <Route path="/overview"      element={<OverviewPage />} />
                <Route path="/dashboard"     element={<Navigate to="/overview" replace />} />
                <Route path="/pages"         element={<PagesPage />} />
                <Route path="/duplicates"    element={<DuplicatesPage />} />
                <Route path="/proposals"     element={<ApprovalsPage />} />
                <Route path="/approvals"     element={<Navigate to="/proposals" replace />} />
                <Route path="/audit"         element={<AuditPage />} />
                <Route path="/batch-rename"  element={<BatchPage />} />
                <Route path="/batch"         element={<Navigate to="/batch-rename" replace />} />
                {/* Legacy /usage redirect → settings/usage */}
                <Route path="/usage"         element={<Navigate to="/settings/usage" replace />} />
              </Route>

              {/* Protected — settings under SettingsLayout */}
              <Route element={wrap(<SettingsLayout />)}>
                <Route path="/settings"              element={<SettingsPage />} />
                <Route path="/settings/usage"        element={<UsagePage />} />
                <Route path="/settings/profile"      element={<ProfilePage />} />
                <Route path="/settings/team"         element={<TeamPage />} />
                <Route path="/settings/privacy"      element={<PrivacyPage />} />
                {/* /settings/preferences — removed from nav */}
                {/* /settings/analysis    — removed from nav */}
                <Route path="/settings/:tab"         element={<SettingsPage />} />
              </Route>
            </Routes>

            <TourOverlay />
            <SearchModal />
            <NotificationPanel />
            <ChatBot />
            <SessionWarning
              secondsLeft={warningSeconds}
              onDismiss={handleDismissWarning}
            />
          </>
        </OnboardingGuard>
      </TourProvider>
    </WorkspaceProvider>
  )
}

function App({ bypassAuth = false }: AppProps) {
  return (
    <AuthProvider bypass={bypassAuth}>
      <AppContent bypassAuth={bypassAuth} />
    </AuthProvider>
  )
}

export default App
