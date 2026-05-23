import { Typography } from "antd";
import { EntityTable } from "./EntityTable.js";

export function DomainsPage() {
  return (
    <div aria-label="domains-page">
      <div style={{ padding: "16px 16px 0 16px" }}>
        <Typography.Title level={3} style={{ margin: 0 }}>领域台</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: 4 }}>
          登记领域、负责人、关联服务，作为 oncall / issue 视图的 domain 锚点来源。
        </Typography.Paragraph>
      </div>
      <EntityTable nodeType="domain" filterField="name" linkField="name"
        linkTo={(id) => `/related/domain/${id}`} />
    </div>
  );
}
