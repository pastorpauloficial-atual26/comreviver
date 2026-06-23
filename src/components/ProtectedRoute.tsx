import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, carregando } = useAuth()

  if (carregando) {
    return (
      <div className="tela-centralizada">
        <div className="spinner" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}
