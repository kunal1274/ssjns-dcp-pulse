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
import { BudgetPage } from './pages/BudgetPage';
import { SchemeCreatePage, SchemeDetailPage, SchemeListPage } from './pages/SchemesPages';
import { StatusPage } from './StatusPage';

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
        <Route path="schemes/new" element={perm(['scheme.create'], <SchemeCreatePage />)} />
        <Route path="schemes/:id" element={perm(['scheme.view'], <SchemeDetailPage />)} />
        <Route path="budget" element={perm(['scheme.view', 'budget.allocate'], <BudgetPage />)} />
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
