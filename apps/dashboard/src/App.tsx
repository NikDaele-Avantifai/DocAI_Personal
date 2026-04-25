import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom"
import { useEffect } from "react"
import Layout from "./components/Layout"
import ProtectedRoute from "./components/ProtectedRoute"
import SearchModal from "./components/SearchModal"
import NotificationPanel from "./components/NotificationPanel"
import ChatBot from "./components/ChatBot"
import TourOverlay from "./components/TourOverlay"
import { TourProvider } from "./contexts/TourContext"
import { AuthProvider } from "./contexts/AuthContext"
import { WorkspaceProvider, useWorkspace } from "./contexts/WorkspaceContext"

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

function App({ bypassAuth = false }: AppProps) {
  const wrap = (el: React.ReactNode) =>
    bypassAuth ? <>{el}</> : <ProtectedRoute>{el}</ProtectedRoute>

  return (
    <AuthProvider bypass={bypassAuth}>
      <WorkspaceProvider>
        <TourProvider>
          <OnboardingGuard>
            <>
              <Routes>
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
                  <Route path="/settings/team"         element={<TeamPage />} />
                  <Route path="/settings/:tab"         element={<SettingsPage />} />
                </Route>
              </Routes>

              <TourOverlay />
              <SearchModal />
              <NotificationPanel />
              <ChatBot />
            </>
          </OnboardingGuard>
        </TourProvider>
      </WorkspaceProvider>
    </AuthProvider>
  )
}

export default App
