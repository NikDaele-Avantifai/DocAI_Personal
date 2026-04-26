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

export function EditorOnly({ children, fallback = null }: AdminOnlyProps) {
  const { isEditor } = useRole()
  if (!isEditor) return <>{fallback}</>
  return <>{children}</>
}

export function useAdminAction() {
  const { isAdmin } = useRole()
  return {
    disabled: !isAdmin,
    title: isAdmin ? undefined : "Admin access required",
  }
}

export function useEditorAction() {
  const { isEditor } = useRole()
  return {
    disabled: !isEditor,
    title: isEditor ? undefined : "Editor or Admin access required",
  }
}
