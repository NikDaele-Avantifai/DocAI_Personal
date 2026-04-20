import { createContext, useContext, useState, useEffect, useCallback } from "react"
import { apiClient } from "@/lib/api"
import { useAuth } from "./AuthContext"

interface Workspace {
  id: string
  owner_sub: string
  owner_email: string | null
  confluence_base_url: string | null
  confluence_email: string | null
  confluence_connected: boolean
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

interface WorkspaceContextValue {
  workspace: Workspace | null
  isLoading: boolean
  refetch: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  isLoading: true,
  refetch: async () => {},
})

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { isTokenReady } = useAuth()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const data = await apiClient.get("/api/workspace/").then(r => r.data)
      setWorkspace(data)
    } catch {
      setWorkspace(null)
    }
  }, [])

  useEffect(() => {
    if (!isTokenReady) return
    setIsLoading(true)
    refetch().finally(() => setIsLoading(false))
  }, [isTokenReady, refetch])

  return (
    <WorkspaceContext.Provider value={{ workspace, isLoading, refetch }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
