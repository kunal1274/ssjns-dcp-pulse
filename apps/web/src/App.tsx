import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import { HomePage, Layout } from './components/Layout';
import { AccessDeniedPage, ProfilePage } from './pages/AccountPages';
import { RolesPage, UsersPage } from './pages/AdminPages';
import {
  ForgotPasswordPage,
  LoginPage,
  SessionExpiredPage,
  SetPasswordPage,
} from './pages/AuthPages';
import {
  AlertDetailPage,
  AlertRulesPage,
  AlertsPage,
  CorrectiveActionDetailPage,
  CorrectiveActionsPage,
} from './pages/AlertPages';
import { BudgetPage } from './pages/BudgetPage';
import { ImportBatchPage, ImportsPage } from './pages/ImportsPage';
import { ReportsPage } from './pages/ReportsPage';
import { DashboardPage, Scheme360Page } from './pages/DashboardPages';
import { FinancePage, ProgressPage, VerificationQueuePage } from './pages/FinancePages';
import { SchemeCreatePage, SchemeDetailPage, SchemeListPage } from './pages/SchemesPages';
import { StatusPage } from './StatusPage';

// MapLibre is large; load it only when the map is opened.
const GisPage = lazy(() => import('./pages/GisPage').then((m) => ({ default: m.GisPage })));

const perm = (any: string[], el: React.ReactNode) => (
  <RequirePermission any={any}>{el}</RequirePermission>
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
      <Route path="/accept-invite" element={<SetPasswordPage mode="invite" />} />
      <Route path="/session-expired" element={<SessionExpiredPage />} />
      <Route path="/status" element={<StatusPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="access-denied" element={<AccessDeniedPage />} />
        <Route path="schemes" element={perm(['scheme.view'], <SchemeListPage />)} />
        <Route
          path="finance"
          element={perm(
            ['release.record', 'expenditure.submit', 'expenditure.verify'],
            <FinancePage />,
          )}
        />
        <Route
          path="progress"
          element={perm(['progress.submit', 'progress.verify'], <ProgressPage />)}
        />
        <Route
          path="verification"
          element={perm(['expenditure.verify', 'progress.verify'], <VerificationQueuePage />)}
        />
        <Route path="schemes/new" element={perm(['scheme.create'], <SchemeCreatePage />)} />
        <Route path="schemes/:id" element={perm(['scheme.view'], <SchemeDetailPage />)} />
        <Route path="budget" element={perm(['scheme.view', 'budget.allocate'], <BudgetPage />)} />
        <Route path="dashboards" element={perm(['report.view'], <DashboardPage />)} />
        <Route
          path="dashboards/jurisdiction/:id"
          element={perm(['report.view'], <DashboardPage />)}
        />
        <Route path="dashboards/scheme/:id" element={perm(['report.view'], <Scheme360Page />)} />
        <Route
          path="map"
          element={perm(
            ['scheme.view'],
            <Suspense fallback={<p>Loading map…</p>}>
              <GisPage />
            </Suspense>,
          )}
        />
        <Route path="alerts" element={perm(['alert.view'], <AlertsPage />)} />
        <Route
          path="alerts/rules"
          element={perm(['alert.view', 'alert.rule.manage'], <AlertRulesPage />)}
        />
        <Route path="alerts/:id" element={perm(['alert.view'], <AlertDetailPage />)} />
        <Route path="corrective-actions" element={<CorrectiveActionsPage />} />
        <Route path="corrective-actions/:id" element={<CorrectiveActionDetailPage />} />
        <Route path="reports" element={perm(['report.view'], <ReportsPage />)} />
        <Route path="imports" element={perm(['integration.manage'], <ImportsPage />)} />
        <Route path="imports/:id" element={perm(['integration.manage'], <ImportBatchPage />)} />
        <Route path="admin/users" element={perm(['user.manage'], <UsersPage />)} />
        <Route path="admin/roles" element={perm(['role.manage'], <RolesPage />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
