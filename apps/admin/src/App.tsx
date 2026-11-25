import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { AdminOnly, Layout } from './components/Layout';
import { LoadingSkeleton, ToastProvider } from './components/ui';
import { AuditPage } from './pages/AuditPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NewsEventDetailPage } from './pages/NewsEventDetailPage';
import { NewsPage } from './pages/NewsPage';
import { OccurrencesPage } from './pages/OccurrencesPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';

// Telas com mapa (Leaflet) carregadas sob demanda: o pacote inicial fica menor.
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const OccurrenceDetailPage = lazy(() => import('./pages/OccurrenceDetailPage').then((m) => ({ default: m.OccurrenceDetailPage })));

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Não repete erros de permissão/validação; só falhas de rede/servidor.
        retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        refetchOnWindowFocus: true,
      },
    },
  });
}

export function AppRoutes() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={6} />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="occurrences" element={<OccurrencesPage />} />
        <Route path="occurrences/:id" element={<OccurrenceDetailPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="news/events/:id" element={<NewsEventDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="users" element={<AdminOnly><UsersPage /></AdminOnly>} />
        <Route path="audit" element={<AdminOnly><AuditPage /></AdminOnly>} />
        <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
        <Route path="*" element={<div className="page"><h1>Página não encontrada</h1></div>} />
      </Route>
    </Routes>
    </Suspense>
  );
}

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
