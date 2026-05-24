import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout.js';
import Dashboard from './pages/Dashboard.js';
import AttackList from './pages/AttackList.js';
import AttackDetail from './pages/AttackDetail.js';
import PeopleList from './pages/PeopleList.js';
import Contributions from './pages/Contributions.js';
import Honor from './pages/Honor.js';
import PersonHonor from './pages/PersonHonor.js';
import HelpCenter from './pages/HelpCenter.js';
import HelpFeedback from './pages/HelpFeedback.js';
import ImportExport from './pages/ImportExport.js';
import EmailSettings from './pages/EmailSettings.js';
import AuditLog from './pages/AuditLog.js';
import DailyReportPage from './pages/DailyReport.js';
import RelatedPage from './pages/RelatedPage.js';
import MergePage from './pages/MergePage.js';
import SchemaWizard from './pages/SchemaWizard.js';
import ConfigCenter from './pages/ConfigCenter.js';
import NotFound from './components/NotFound.js';
import ErrorBoundary from './components/ErrorBoundary.js';

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/attack" element={<AttackList />} />
          <Route path="/attack/:id" element={<AttackDetail />} />
          <Route path="/people" element={<PeopleList />} />
          <Route path="/contributions" element={<Contributions />} />
          <Route path="/honor" element={<Honor />} />
          <Route path="/honor/:name" element={<PersonHonor />} />
          <Route path="/help" element={<HelpCenter />} />
          <Route path="/daily-report" element={<DailyReportPage />} />
          <Route path="/merge" element={<MergePage />} />
          <Route path="/related/:nodeType/:id" element={<RelatedPage />} />
          <Route path="/import" element={<ImportExport />} />
          <Route path="/email" element={<EmailSettings />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/schema" element={<SchemaWizard />} />
          <Route path="/config" element={<ConfigCenter />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="/help/feedback/:token" element={<HelpFeedback />} />
      </Routes>
    </ErrorBoundary>
  );
}
