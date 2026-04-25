import { useRole } from '@/contexts/WorkspaceContext'

interface AdminOnlyProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function AdminOnly({ children, fallback = null }: AdminOnlyProps) {
  const { isAdmin } = useRole()
  if (!isAdmin) return <>{fallback}</>
  return <>{children}</>
}

export function useAdminAction() {
  const { isAdmin } = useRole()
  return {
    disabled: !isAdmin,
    title: isAdmin ? undefined : "Admin access required",
  }
}
