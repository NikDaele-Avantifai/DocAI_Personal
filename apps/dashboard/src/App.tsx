import { Routes, Route, Navigate } from "react-router-dom"
import Layout from "./components/Layout"
import SearchModal from "./components/SearchModal"
import NotificationPanel from "./components/NotificationPanel"
import ChatBot from "./components/ChatBot"

// Pages
import OverviewPage from "./pages/OverviewPage"
import ApprovalsPage from "./pages/ApprovalsPage"
import AuditPage from "./pages/AuditPage"
import PagesPage from "./pages/PagesPage"
import BatchPage from "./pages/BatchPage"
import DuplicatesPage from "./pages/DuplicatesPage"
import SettingsPage from "./pages/SettingsPage"

function App() {
  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview"    element={<OverviewPage />} />
          <Route path="/dashboard"   element={<Navigate to="/overview" replace />} />
          <Route path="/pages"       element={<PagesPage />} />
          <Route path="/duplicates"  element={<DuplicatesPage />} />
          <Route path="/proposals"   element={<ApprovalsPage />} />
          <Route path="/approvals"   element={<Navigate to="/proposals" replace />} />
          <Route path="/audit"       element={<AuditPage />} />
          <Route path="/batch-rename" element={<BatchPage />} />
          <Route path="/batch"       element={<Navigate to="/batch-rename" replace />} />
          <Route path="/settings"    element={<SettingsPage />} />
          <Route path="/settings/:tab" element={<SettingsPage />} />
        </Route>
      </Routes>

      {/* Global overlays — rendered outside Layout so they sit above everything */}
      <SearchModal />
      <NotificationPanel />
      <ChatBot />
    </>
  )
}

export default App
