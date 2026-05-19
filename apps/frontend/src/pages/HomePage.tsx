import { Card, Row, Col } from "antd";
import { Link } from "react-router-dom";

const MODULES = [
  { to: "/attack", title: "攻关作战台", desc: "攻关单跟踪、进展、可编辑表格" },
  { to: "/honor", title: "荣誉殿堂", desc: "贡献加权排行榜与个人档案" },
  { to: "/contributions", title: "贡献录入", desc: "记录贡献并关联攻关单" },
  { to: "/import", title: "导入", desc: "从 Excel 导入数据" },
  { to: "/proposals", title: "关系审批", desc: "候选关系扫描与人工审批" },
];

export function HomePage() {
  return (
    <div style={{ padding: 24 }}>
      <h1>作战平台</h1>
      <Row gutter={[16, 16]}>
        {MODULES.map(m => (
          <Col span={8} key={m.to}>
            <Link to={m.to}>
              <Card hoverable title={m.title} aria-label={`home-card-${m.to}`}>{m.desc}</Card>
            </Link>
          </Col>
        ))}
      </Row>
    </div>
  );
}
