import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { EntityTable } from "./pages/EntityTable.js";
import { AttackDetail } from "./pages/AttackDetail.js";
import { ImportPage } from "./pages/ImportPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <nav style={{ padding: 12 }}>
        <Link to="/attack">攻关作战台</Link> | <Link to="/import">导入</Link>
      </nav>
      <Routes>
        <Route path="/" element={<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => `/attack/${id}`} />} />
        <Route path="/attack" element={<EntityTable nodeType="attackTicket" filterField="状态" linkField="标题" linkTo={(id) => `/attack/${id}`} />} />
        <Route path="/attack/:id" element={<AttackDetail />} />
        <Route path="/import" element={<ImportPage />} />
      </Routes>
    </BrowserRouter>
  );
}
