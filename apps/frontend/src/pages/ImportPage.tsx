import { useState } from "react";
import { Upload, Button, message } from "antd";
import { api } from "../api.js";

export function ImportPage() {
  const [done, setDone] = useState(false);
  return (
    <div style={{ padding: 16 }}>
      <h2>导入攻关单</h2>
      <Upload beforeUpload={async (file) => {
        try {
          const r = await api.importXlsx(file as unknown as File);
          message.success(`导入 ${r.created} 条`); setDone(true);
        } catch {
          message.error("导入失败，请重试");
        }
        return false;
      }}>
        <Button>选择 Excel 文件</Button>
      </Upload>
      {done && <p role="status">导入完成</p>}
    </div>
  );
}
