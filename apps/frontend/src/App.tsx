import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AttackTable } from "./pages/AttackTable.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 12 }}>
        <Link to="/attack">攻关作战台</Link> | <Link to="/import">导入</Link>
      </nav>
      <Routes>
        <Route path="/" element={<AttackTable />} />
        <Route path="/attack" element={<AttackTable />} />
        <Route path="/attack/:id" element={<AttackDetail />} />
        <Route path="/import" element={<ImportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
