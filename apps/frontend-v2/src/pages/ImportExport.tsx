import { useState } from 'react';
import {
  Typography,
  Card,
  Select,
  Upload,
  Button,
  Table,
  message,
  Space,
} from 'antd';
import { UploadOutlined, ExportOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import type { ImportPreview } from '@combat/shared';

const { Title, Text } = Typography;

const NODE_TYPES = [
  { value: 'attackTicket', label: '攻关单' },
  { value: 'person', label: '人员' },
  { value: 'contribution', label: '贡献' },
  { value: 'releasePackage', label: '发布包' },
  { value: 'weightFile', label: '权重文件' },
];

export default function ImportExport() {
  const [nodeType, setNodeType] = useState<string>('attackTicket');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);

  const handlePreview = async (file: File) => {
    try {
      const result = await api.importPreview(file, nodeType);
      setPreview(result);
      message.info('预览完成');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const result = await api.importXlsx(file, nodeType);
      message.success(`导入完成：新增 ${result.created}，更新 ${result.updated}${result.skipped ? `，跳过 ${result.skipped}` : ''}`);
      setPreview(null);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await api.exportNodes(nodeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nodeType}_export.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>
        数据导入/导出
      </Title>

      <Card style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }}>
          <Text>数据类型：</Text>
          <Select
            style={{ width: 160 }}
            value={nodeType}
            onChange={setNodeType}
            options={NODE_TYPES}
          />
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
              <Text>预览结果：新增 {String(preview.willCreate ?? 0)}，更新 {String(preview.willUpdate ?? 0)}，跳过 {String(preview.skipped ?? 0)}</Text>
              <Button
                type="primary"
                loading={importing}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.xlsx,.xls';
                  input.onchange = (e) => {
                    const f = (e.target as HTMLInputElement).files?.[0];
                    if (f) handleImport(f);
                  };
                  input.click();
                }}
                style={{ marginLeft: 12 }}
              >
                确认导入
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
