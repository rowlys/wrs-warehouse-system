import { Navigate, Route, Routes } from 'react-router'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { DocumentCreatePage } from './pages/DocumentCreatePage'
import { DocumentDetailPage } from './pages/DocumentDetailPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { InventoryPage } from './pages/InventoryPage'
import { LoginPage } from './pages/LoginPage'
import { ProductsPage } from './pages/ProductsPage'
import { TransactionsPage } from './pages/TransactionsPage'

// Spec §1.3 routes.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/receiving" element={<DocumentsPage />} />
          <Route path="/receiving/new" element={<DocumentCreatePage />} />
          <Route path="/receiving/:id" element={<DocumentDetailPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/transactions" element={<TransactionsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/receiving" replace />} />
    </Routes>
  )
}
