// HolyOS PWA sklad — hlavní router
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './auth/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DebugSyncPage from './pages/DebugSyncPage';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import ReceivePage from './pages/ReceivePage';
import IssuePage from './pages/IssuePage';
import TransferPage from './pages/TransferPage';
import InventoryListPage from './pages/InventoryListPage';
import InventoryDetailPage from './pages/InventoryDetailPage';
import InventoryCountPage from './pages/InventoryCountPage';
import PickingListPage from './pages/PickingListPage';
import PickingDetailPage from './pages/PickingDetailPage';
import PickingPickPage from './pages/PickingPickPage';

export default function App() {
  return (
    <>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/receive"
        element={
          <ProtectedRoute>
            <ReceivePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/issue"
        element={
          <ProtectedRoute>
            <IssuePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transfer"
        element={
          <ProtectedRoute>
            <TransferPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory"
        element={
          <ProtectedRoute>
            <InventoryListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/:id"
        element={
          <ProtectedRoute>
            <InventoryDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/inventory/:id/items/:itemId"
        element={
          <ProtectedRoute>
            <InventoryCountPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/picking"
        element={
          <ProtectedRoute>
            <PickingListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/picking/:id"
        element={
          <ProtectedRoute>
            <PickingDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/picking/:id/items/:itemId"
        element={
          <ProtectedRoute>
            <PickingPickPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/debug"
        element={
          <ProtectedRoute>
            <DebugSyncPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <PwaUpdatePrompt />
    </>
  );
}
