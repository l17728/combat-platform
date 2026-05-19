import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { List } from "antd";
import { api } from "../api.js";
import type { PersonHonor as PH } from "@combat/shared";

export function PersonHonor() {
  const { name = "" } = useParams();
  const [data, setData] = useState<PH | null>(null);
  useEffect(() => { api.getPersonHonor(name).then(setData); }, [name]);
  return (
    <div style={{ padding: 16 }}>
      <h2>个人贡献档案：{name}</h2>
      <List
        dataSource={data?.contributions ?? []}
        rowKey={(x) => x.contribution.id}
        renderItem={(x) => (
          <List.Item>
            {String(x.contribution.properties["贡献类型"] ?? "")} /
            {String(x.contribution.properties["贡献等级"] ?? "")} —
            {String(x.contribution.properties["贡献描述"] ?? "")}
            {x.attackTicketId
              ? <> · <Link to={`/attack/${x.attackTicketId}`}>关联攻关单</Link></>
              : null}
          </List.Item>
        )}
      />
    </div>
  );
}
