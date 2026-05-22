import { useState } from "react";
import { Upload, Button, message, Select, Space, Table, Tag, Typography } from "antd";
import { api } from "../api.js";
import type { ImportRowResult } from "@combat/shared";

const TYPES = [
  { value: "attackTicket", label: "攻关单" },
  { value: "contribution", label: "贡献记录" },
  { value: "releasePackage", label: "发布包" },
  { value: "weightFile", label: "权重文件" },
  { value: "person", label: "人员" },
];

const ACTION_TAG: Record<ImportRowResult["action"], { color: string; label: string }> = {
  create: { color: "green", label: "新增" },
  update: { color: "blue", label: "更新" },
  skip: { color: "red", label: "跳过" },
};

function ResultTable({ rows, label }: { rows: ImportRowResult[]; label: string }) {
  return (
    <div aria-label={label} style={{ marginTop: 12 }}>
      <Table size="small" rowKey="rowIndex" dataSource={rows} pagination={false}
        locale={{ emptyText: "无" }}
        columns={[
          { title: "行号", dataIndex: "rowIndex", width: 70, render: (v: number) => v + 1 },
          { title: "动作", dataIndex: "action", width: 90,
            render: (a: ImportRowResult["action"]) => <Tag color={ACTION_TAG[a].color}>{ACTION_TAG[a].label}</Tag> },
          { title: "摘要", dataIndex: "summary" },
          { title: "原因", dataIndex: "reason", render: (r?: string) => r ? <Typography.Text type="danger">{r}</Typography.Text> : "" },
        ]} />
    </div>
  );
}

export function ImportPage() {
  const [done, setDone] = useState(false);
  const [type, setType] = useState("attackTicket");
  const [preview, setPreview] = useState<ImportRowResult[] | null>(null);
  const [skipped, setSkipped] = useState<ImportRowResult[] | null>(null);

  return (
    <div style={{ padding: 16 }}>
      <h2>导入数据</h2>
      <Space style={{ marginBottom: 12 }}>
        <span>导入类型：</span>
        <Select aria-label="import-type" value={type} onChange={setType}
          options={TYPES} style={{ width: 200 }} />
      </Space>
      <div>
        <Space>
          {/* Immediate-import on select (preserves FE-5 / FE-IU1 behavior). */}
          <Upload beforeUpload={async (file) => {
            try {
              const r = await api.importXlsx(file as unknown as File, type);
              message.success(`导入新增 ${r.created} · 已更新 ${r.updated}` + (r.skipped ? ` · 跳过 ${r.skipped}` : ""));
              setDone(true);
              setSkipped(r.skipped && r.skippedRows ? r.skippedRows : null);
              setPreview(null);
            } catch (e) { message.error(`导入失败：${String((e as Error).message)}`); }
            return false;
          }} showUploadList={false}>
            <Button>选择 Excel 文件</Button>
          </Upload>
          {/* Dry-run preview — does NOT write. */}
          <Upload beforeUpload={async (file) => {
            try {
              const p = await api.importPreview(file as unknown as File, type);
              setPreview(p.rows);
              message.info(`预览：将新增 ${p.willCreate} · 更新 ${p.willUpdate} · 跳过 ${p.skipped}（未写入）`);
            } catch (e) { message.error(`预览失败：${String((e as Error).message)}`); }
            return false;
          }} showUploadList={false}>
            <Button aria-label="preview-upload">预览(不写入)</Button>
          </Upload>
        </Space>
      </div>
      {preview && <ResultTable rows={preview} label="import-preview" />}
      {skipped && skipped.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text type="warning">以下 {skipped.length} 行被跳过：</Typography.Text>
          <ResultTable rows={skipped} label="import-skipped" />
        </div>
      )}
      {done && <p role="status">导入完成</p>}
    </div>
  );
}
