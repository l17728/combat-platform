import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { AppLayout } from "./layouts/AppLayout.js";
import LoginPage from "./pages/LoginPage.js";
import Dashboard from "./pages/Dashboard.js";
import AttackList from "./pages/AttackList.js";
import AttackDetail from "./pages/AttackDetail.js";
import PeopleList from "./pages/PeopleList.js";
import Contributions from "./pages/Contributions.js";
import Honor from "./pages/Honor.js";
import PersonHonor from "./pages/PersonHonor.js";
import HelpCenter from "./pages/HelpCenter.js";
import HelpFeedback from "./pages/HelpFeedback.js";
import ImportExport from "./pages/ImportExport.js";
import EmailSettings from "./pages/EmailSettings.js";
import AuditLog from "./pages/AuditLog.js";
import DailyReportPage from "./pages/DailyReport.js";
import RelatedPage from "./pages/RelatedPage.js";
import MergePage from "./pages/MergePage.js";
import SchemaWizard from "./pages/SchemaWizard.js";
import ConfigCenter from "./pages/ConfigCenter.js";
import SearchPage from "./pages/SearchPage.js";
import KGGraph from "./pages/KGGraph.js";
import ProposalsPage from "./pages/ProposalsPage.js";
import RemindersPage from "./pages/RemindersPage.js";
import BugReport from "./pages/BugReport.js";
import UserManagement from "./pages/UserManagement.js";
import DbMigration from "./pages/DbMigration.js";
import OperationLog from "./pages/OperationLog.js";
import BackupRestore from "./pages/BackupRestore.js";
import DocumentCenter from "./pages/DocumentCenter.js";
import ManualCenter from "./pages/ManualCenter.js";
import NotFound from "./components/NotFound.js";
import ErrorBoundary from "./components/ErrorBoundary.js";
import { AuthProvider, useAuth } from "./hooks/useAuth.js";
import { initOpLog, logNavigate, setupGlobalErrorHandler } from "./utils/op-logger.js";
import { Spin } from "antd";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function LoginRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: "block", margin: "40vh auto" }} />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function AppInner() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    setupGlobalErrorHandler();
  }, []);

  useEffect(() => {
    if (user) {
      initOpLog(user.displayName || user.username);
    }
  }, [user]);

  useEffect(() => {
    logNavigate(location.pathname);
  }, [location.pathname]);

  return (
    <Routes>
      <Route path="/login" element={<LoginRedirect />} />
      <Route path="/help/feedback/:token" element={<HelpFeedback />} />
      <Route
        element={
          <AuthGuard>
            <AppLayout />
          </AuthGuard>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/attack" element={<AttackList />} />
        <Route path="/attack/:id" element={<AttackDetail />} />
        <Route path="/people" element={<PeopleList />} />
        <Route path="/contributions" element={<Contributions />} />
        <Route path="/honor" element={<Honor />} />
        <Route path="/honor/:name" element={<PersonHonor />} />
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/daily-report" element={<DailyReportPage />} />
        <Route
          path="/merge"
          element={
            <AdminGuard>
              <MergePage />
            </AdminGuard>
          }
        />
        <Route path="/related/:nodeType/:id" element={<RelatedPage />} />
        <Route path="/import" element={<ImportExport />} />
        <Route path="/email" element={<EmailSettings />} />
        <Route path="/audit" element={<AuditLog />} />
        <Route path="/schema" element={<SchemaWizard />} />
        <Route path="/config" element={<ConfigCenter />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/kg" element={<KGGraph />} />
        <Route
          path="/proposals"
          element={
            <AdminGuard>
              <ProposalsPage />
            </AdminGuard>
          }
        />
        <Route
          path="/reminders"
          element={
            <AdminGuard>
              <RemindersPage />
            </AdminGuard>
          }
        />
        <Route path="/bug-report" element={<BugReport />} />
        <Route path="/users" element={<UserManagement />} />
        <Route path="/op-log" element={<OperationLog />} />
        <Route path="/backup" element={<BackupRestore />} />
        <Route
          path="/db-migration"
          element={
            <AdminGuard>
              <DbMigration />
            </AdminGuard>
          }
        />
        <Route path="/documents" element={<DocumentCenter />} />
        <Route path="/manual" element={<ManualCenter />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  );
}
