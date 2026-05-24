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

export default function App() {
  return (
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
        <Route path="/import" element={<ImportExport />} />
        <Route path="/email" element={<EmailSettings />} />
        <Route path="/audit" element={<AuditLog />} />
      </Route>
      <Route path="/help/feedback/:token" element={<HelpFeedback />} />
    </Routes>
  );
}
