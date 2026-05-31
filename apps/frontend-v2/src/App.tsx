import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, lazy, Suspense } from "react";
import { AppLayout } from "./layouts/AppLayout.js";
import { AuthProvider, useAuth } from "./hooks/useAuth.js";
import { initOpLog, logNavigate, setupGlobalErrorHandler } from "./utils/op-logger.js";
import { Spin } from "antd";

// Auth-critical pages: eager load (needed for login decision)
import LoginPage from "./pages/LoginPage.js";
import { ForcePasswordChange } from "./components/ForcePasswordChange.js";
import ErrorBoundary from "./components/ErrorBoundary.js";

// Route-level code splitting — each page becomes a separate chunk
const Dashboard = lazy(() => import("./pages/Dashboard.js"));
const AttackList = lazy(() => import("./pages/AttackList.js"));
const AttackDetail = lazy(() => import("./pages/AttackDetail.js"));
const PeopleList = lazy(() => import("./pages/PeopleList.js"));
const Contributions = lazy(() => import("./pages/Contributions.js"));
const Honor = lazy(() => import("./pages/Honor.js"));
const PersonHonor = lazy(() => import("./pages/PersonHonor.js"));
const HelpCenter = lazy(() => import("./pages/HelpCenter.js"));
const HelpFeedback = lazy(() => import("./pages/HelpFeedback.js"));
const ImportExport = lazy(() => import("./pages/ImportExport.js"));
const EmailSettings = lazy(() => import("./pages/EmailSettings.js"));
const LlmSettings = lazy(() => import("./pages/LlmSettings.js"));
const AuditLog = lazy(() => import("./pages/AuditLog.js"));
const DailyReportPage = lazy(() => import("./pages/DailyReport.js"));
const RelatedPage = lazy(() => import("./pages/RelatedPage.js"));
const MergePage = lazy(() => import("./pages/MergePage.js"));
const SchemaWizard = lazy(() => import("./pages/SchemaWizard.js"));
const ConfigCenter = lazy(() => import("./pages/ConfigCenter.js"));
const WebhookSettings = lazy(() => import("./pages/WebhookSettings.js"));
const DigestSettings = lazy(() => import("./pages/DigestSettings.js"));
const InvitationPage = lazy(() => import("./pages/InvitationPage.js"));
const InviteRegister = lazy(() => import("./pages/InviteRegister.js"));
const DashboardScreen = lazy(() => import("./pages/DashboardScreen.js"));
const SearchPage = lazy(() => import("./pages/SearchPage.js"));
const KGGraph = lazy(() => import("./pages/KGGraph.js"));
const ProposalsPage = lazy(() => import("./pages/ProposalsPage.js"));
const RemindersPage = lazy(() => import("./pages/RemindersPage.js"));
const BugReport = lazy(() => import("./pages/BugReport.js"));
const UserManagement = lazy(() => import("./pages/UserManagement.js"));
const DbMigration = lazy(() => import("./pages/DbMigration.js"));
const SystemUpgrade = lazy(() => import("./pages/SystemUpgrade.js"));
const OperationLog = lazy(() => import("./pages/OperationLog.js"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.js"));
const BackupRestore = lazy(() => import("./pages/BackupRestore.js"));
const DocumentCenter = lazy(() => import("./pages/DocumentCenter.js"));
const ManualCenter = lazy(() => import("./pages/ManualCenter.js"));
const NotFound = lazy(() => import("./components/NotFound.js"));

function PageLoader() {
  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <Spin size="large" />
    </div>
  );
}

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
  return (
    <>
      {children}
      <ForcePasswordChange />
    </>
  );
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
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<LoginRedirect />} />
        <Route path="/help/feedback/:token" element={<HelpFeedback />} />
        <Route path="/invite" element={<InviteRegister />} />
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
          <Route
            path="/llm-settings"
            element={
              <AdminGuard>
                <LlmSettings />
              </AdminGuard>
            }
          />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/schema" element={<SchemaWizard />} />
          <Route path="/config" element={<ConfigCenter />} />
          <Route path="/webhooks" element={<WebhookSettings />} />
          <Route path="/digest" element={<DigestSettings />} />
          <Route path="/invitations" element={<InvitationPage />} />
          <Route path="/screen" element={<DashboardScreen />} />
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
          <Route path="/notifications" element={<NotificationsPage />} />
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
          <Route
            path="/system-upgrade"
            element={
              <AdminGuard>
                <SystemUpgrade />
              </AdminGuard>
            }
          />
          <Route path="/documents" element={<DocumentCenter />} />
          <Route path="/manual" element={<ManualCenter />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
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
