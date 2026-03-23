import { Routes, Route, Navigate } from "react-router-dom"
import DashboardPage from "./pages/DashboardPage"
import ApprovalsPage from "./pages/ApprovalsPage"
import AuditPage from "./pages/AuditPage"
import Layout from "./components/Layout"

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Route>
    </Routes>
  )
}

export default App
