import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "./pages/AppShell.js";
import { HomePage } from "./pages/HomePage.js";
import { EntityTable } from "./pages/EntityTable.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";
import { HonorPage } from "./pages/HonorPage.js";
import { PersonHonor } from "./pages/PersonHonor.js";

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/attack" element={<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => `/attack/${id}`} />} />
          <Route path="/attack/:id" element={<AttackDetail />} />
          <Route path="/contributions" element={<EntityTable nodeType="contribution" />} />
          <Route path="/honor" element={<HonorPage />} />
          <Route path="/honor/:name" element={<PersonHonor />} />
          <Route path="/import" element={<ImportPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
