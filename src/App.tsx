import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CaptureFlow from './pages/CaptureFlow'
import RelatorioDetalhe from './pages/RelatorioDetalhe'
import Financeiro from './pages/Financeiro'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/captura"
        element={
          <ProtectedRoute>
            <CaptureFlow />
          </ProtectedRoute>
        }
      />
      <Route
        path="/relatorio/:id"
        element={
          <ProtectedRoute>
            <RelatorioDetalhe />
          </ProtectedRoute>
        }
      />
      <Route
        path="/financeiro"
        element={
          <ProtectedRoute>
            <Financeiro />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
