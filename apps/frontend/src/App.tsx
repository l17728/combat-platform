import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "./pages/AppShell.js";
import { HomePage } from "./pages/HomePage.js";
import { EntityTable } from "./pages/EntityTable.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";
import { HonorPage } from "./pages/HonorPage.js";
import { PersonHonor } from "./pages/PersonHonor.js";
import { RelatedPage } from "./pages/RelatedPage.js";
import { ProposalsPage } from "./pages/ProposalsPage.js";
import { SearchPage } from "./pages/SearchPage.js";
import { DailyReportPage } from "./pages/DailyReportPage.js";
import { RemindersPage } from "./pages/RemindersPage.js";
import { ConflictsPage } from "./pages/ConflictsPage.js";
import { HermesPage } from "./pages/HermesPage.js";
import { GraphPage } from "./pages/GraphPage.js";
import { AuditPage } from "./pages/AuditPage.js";
import { MergePage } from "./pages/MergePage.js";
import { EmailPage } from "./pages/EmailPage.js";
import { EscalationPage } from "./pages/EscalationPage.js";
import { CustomCommandsPage } from "./pages/CustomCommandsPage.js";
import { ResponsibilityPage } from "./pages/ResponsibilityPage.js";
import { SchemaWizardPage } from "./pages/SchemaWizardPage.js";
import { PeoplePage } from "./pages/PeoplePage.js";
import { DomainsPage } from "./pages/DomainsPage.js";
import { TasksPage } from "./pages/TasksPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/attack" element={<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => `/attack/${id}`} />} />
          <Route path="/attack/:id" element={<AttackDetail />} />
          <Route path="/contributions" element={<EntityTable nodeType="contribution" />} />
          <Route path="/honor" element={<HonorPage />} />
          <Route path="/honor/:name" element={<PersonHonor />} />
          <Route path="/related/:nodeType/:id" element={<RelatedPage />} />
          <Route path="/proposals" element={<ProposalsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/releases" element={<EntityTable nodeType="releasePackage" />} />
          <Route path="/weights" element={<EntityTable nodeType="weightFile" />} />
          <Route path="/daily-report" element={<DailyReportPage />} />
          <Route path="/reminders" element={<RemindersPage />} />
          <Route path="/conflicts" element={<ConflictsPage />} />
          <Route path="/hermes" element={<HermesPage />} />
          <Route path="/graph/:nodeType/:id" element={<GraphPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/merge" element={<MergePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/emailgroups" element={<EntityTable nodeType="emailGroup" />} />
          <Route path="/incidents" element={<EntityTable nodeType="incidentTracking" filterField="状态" />} />
          <Route path="/changes" element={<EntityTable nodeType="changeIssue" filterField="状态" />} />
          <Route path="/alarms" element={<EntityTable nodeType="alarmGovernance" filterField="状态" />} />
          <Route path="/p3" element={<EntityTable nodeType="p3Incident" />} />
          <Route path="/daily" element={<EntityTable nodeType="dailyTask" filterField="状态" />} />
          <Route path="/issue400" element={<EntityTable nodeType="issue400" />} />
          <Route path="/issue5xx" element={<EntityTable nodeType="issue5xx" />} />
          <Route path="/escalation" element={<EscalationPage />} />
          <Route path="/oncall" element={<EntityTable nodeType="oncall" />} />
          <Route path="/experience" element={<EntityTable nodeType="experience" />} />
          <Route path="/commands" element={<CustomCommandsPage />} />
          <Route path="/responsibility" element={<ResponsibilityPage />} />
          <Route path="/schema-wizard" element={<SchemaWizardPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
