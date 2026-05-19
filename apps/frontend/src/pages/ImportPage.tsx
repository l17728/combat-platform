import { useState } from "react";
import { Upload, Button, message, Select, Space } from "antd";
import { api } from "../api.js";

const TYPES = [
  { value: "attackTicket", label: "攻关单" },
  { value: "contribution", label: "贡献记录" },
  { value: "releasePackage", label: "发布包" },
  { value: "weightFile", label: "权重文件" },
  { value: "person", label: "人员" },
];

export function ImportPage() {
  const [done, setDone] = useState(false);
  const [type, setType] = useState("attackTicket");
  return (
    <div style={{ padding: 16 }}>
      <h2>导入数据</h2>
      <Space style={{ marginBottom: 12 }}>
        <span>导入类型：</span>
        <Select aria-label="import-type" value={type} onChange={setType}
          options={TYPES} style={{ width: 200 }} />
      </Space>
      <div>
        <Upload beforeUpload={async (file) => {
          try {
            const r = await api.importXlsx(file as unknown as File, type);
            message.success(`导入新增 ${r.created} · 已更新 ${r.updated}`); setDone(true);
          } catch {
            message.error("导入失败，请重试");
          }
          return false;
        }}>
          <Button>选择 Excel 文件</Button>
        </Upload>
      </div>
      {done && <p role="status">导入完成</p>}
    </div>
  );
}
