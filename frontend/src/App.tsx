import { Title } from '@mantine/core'
import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { LoginPage } from './pages/LoginPage'
import { ProductsPage } from './pages/ProductsPage'

// Spec §1.3 routes. Pages of later tasks are placeholders until those tasks land.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/receiving" element={<Title order={2}>Receiving documents</Title>} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/inventory" element={<Title order={2}>Inventory</Title>} />
          <Route path="/inventory/transactions" element={<Title order={2}>Transactions</Title>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/receiving" replace />} />
    </Routes>
  )
}
