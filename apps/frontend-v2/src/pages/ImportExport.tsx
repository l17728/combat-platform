import { useState } from "react";
import { Typography, Card, Select, Upload, Button, Table, message, Space, Checkbox, Tag, Alert } from "antd";
import { UploadOutlined, ExportOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import type { ImportPreview } from "@combat/shared";
import HelpButton from "../components/HelpButton.js";
import HELP from "../help-content.js";
import { handleApiError } from "../utils/handleApiError.js";

const { Title, Text } = Typography;

const NODE_TYPES = [
  { value: "attackTicket", label: "攻关单" },
  { value: "person", label: "人员" },
  { value: "contribution", label: "贡献" },
  { value: "releasePackage", label: "发布包" },
  { value: "weightFile", label: "权重文件" },
];

export default function ImportExport() {
  const [nodeType, setNodeType] = useState<string>("attackTicket");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [createFields, setCreateFields] = useState(false);
  const [importing, setImporting] = useState(false);

  const handlePreview = async (file: File) => {
    try {
      const result = await api.importPreview(file, nodeType);
      setPreview(result);
      setPendingFile(file);
      message.info("预览完成");
    } catch (e) {
      handleApiError(e);
    }
  };

  const handleImport = async () => {
    if (!pendingFile) {
      message.warning("请先拖入文件预览");
      return;
    }
    setImporting(true);
    try {
      const result = await api.importXlsx(pendingFile, nodeType, createFields);
      const newFieldsMsg = result.createdFields?.length ? `，新建字段 ${result.createdFields.length}` : "";
      message.success(
        `导入完成：新增 ${result.created}，更新 ${result.updated}${result.skipped ? `，跳过 ${result.skipped}` : ""}${newFieldsMsg}`
      );
      setPreview(null);
      setPendingFile(null);
    } catch (e) {
      handleApiError(e);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportNodes(nodeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${nodeType}_export.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success("导出成功");
    } catch (e) {
      handleApiError(e);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>
          数据导入/导出
        </Title>
        <HelpButton title={HELP.importExport.title} content={HELP.importExport.content} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }}>
          <Text>数据类型：</Text>
          <Select style={{ width: 160 }} value={nodeType} onChange={setNodeType} options={NODE_TYPES} />
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出当前数据
          </Button>
        </Space>

        <Upload.Dragger
          accept=".xlsx,.xls"
          showUploadList={false}
          customRequest={({ file }) => handlePreview(file as File)}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-text">点击或拖拽 Excel 文件到此处（仅预览）</p>
          <p className="ant-upload-hint">支持 .xlsx / .xls 格式</p>
        </Upload.Dragger>

        {preview && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text>
                预览结果：新增 {String(preview.willCreate ?? 0)}，更新 {String(preview.willUpdate ?? 0)}，跳过{" "}
                {String(preview.skipped ?? 0)}
              </Text>
            </div>
            {preview.newColumns && preview.newColumns.length > 0 && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`检测到 ${preview.newColumns.length} 个未匹配字段的列`}
                description={
                  <div>
                    <Space size={[4, 4]} wrap style={{ marginBottom: 8 }}>
                      {preview.newColumns.map((c) => (
                        <Tag key={c}>{c}</Tag>
                      ))}
                    </Space>
                    <div>
                      <Checkbox checked={createFields} onChange={(e) => setCreateFields(e.target.checked)}>
                        自动创建这些字段(string 类型)后一并导入
                      </Checkbox>
                    </div>
                  </div>
                }
              />
            )}
            <Button type="primary" loading={importing} onClick={handleImport}>
              确认导入
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
