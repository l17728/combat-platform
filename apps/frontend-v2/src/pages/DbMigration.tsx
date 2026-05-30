import { useEffect, useState } from 'react';
import {
  Typography, Card, Form, Input, Button, Space, Alert, Statistic, Row, Col,
  Steps, Progress, message, Tag, Descriptions,
} from 'antd';
import { DatabaseOutlined, CheckCircleOutlined, WarningOutlined, ApiOutlined } from '@ant-design/icons';
import { api } from '../api.js';
import { useAuth } from '../hooks/useAuth.js';

const { Title, Text, Paragraph } = Typography;

interface DbStatus {
  kind: 'sqlite' | 'postgres';
  url: string;
  tables: { name: string; rows: number }[];
  lastMigratedAt?: string | null;
}

interface MigrationResult {
  ok: boolean;
  stats: Record<string, { source: number; copied: number }>;
  error?: string;
}

// 系统管理 → 数据库迁移
// 仅 admin 可访问;UI 三段:① 现状卡 ② 目标连接表单 ③ 执行迁移
// 调后端三个 API:
//   GET  /api/db-migration/status         当前驱动 + 表行数
//   POST /api/db-migration/test-connection 校验目标 PG
//   POST /api/db-migration/run            一键迁移(可加 dry-run)
export default function DbMigration() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [form] = Form.useForm<{ pgUrl: string; truncate: boolean; dryRun: boolean }>();

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const s = await api.dbMigrationStatus();
      setStatus(s);
    } catch (e: any) {
      message.error(e.message || '获取数据库状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (isAdmin) fetchStatus(); }, [isAdmin]);

  if (!isAdmin) {
    return (
      <Card>
        <Alert type="warning" showIcon message="数据库迁移仅管理员可用" />
      </Card>
    );
  }

  const testConnection = async () => {
    const pgUrl = form.getFieldValue('pgUrl');
    if (!pgUrl) { message.warning('请输入 Postgres 连接串'); return; }
    setTesting(true);
    try {
      await api.dbMigrationTestConnection(pgUrl);
      message.success('Postgres 连接 OK');
      setStep(1);
    } catch (e: any) {
      message.error(e.message || '连接失败');
    } finally {
      setTesting(false);
    }
  };

  const runMigration = async () => {
    const values = await form.validateFields();
    setMigrating(true);
    setStep(2);
    setProgress(0);
    setResult(null);
    try {
      const r = await api.dbMigrationRun({
        pgUrl: values.pgUrl,
        truncate: !!values.truncate,
        dryRun: !!values.dryRun,
        onProgress: (p) => setProgress(p),
      });
      setResult(r);
      setStep(3);
      if (r.ok) message.success(values.dryRun ? '试运行完成,数据未写入' : '迁移完成');
      else message.error(r.error || '迁移失败');
      fetchStatus();
    } catch (e: any) {
      setResult({ ok: false, stats: {}, error: e.message });
      message.error(e.message || '迁移异常');
    } finally {
      setMigrating(false);
    }
  };

  const totalRows = status?.tables.reduce((s, t) => s + t.rows, 0) ?? 0;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        <DatabaseOutlined /> 数据库迁移 (SQLite → Postgres)
      </Title>

      <Alert
        type="info"
        showIcon
        message="一键迁移流程说明"
        description={
          <Paragraph style={{ margin: 0 }}>
            ① 在「目标连接」填好 Postgres 连接串并点 <Text code>测试连接</Text>;<br />
            ② 确认 PG 端已用相同 backend(<Text code>DB_URL=postgres://...</Text>)启动过一次(让它建表);<br />
            ③ 点 <Text code>开始迁移</Text>。建议先勾「试运行」清点行数,再正式迁移;<br />
            ④ 迁移期间业务**只读不可写**,完成后需重启 backend 切到 Postgres 才生效。
          </Paragraph>
        }
        style={{ marginBottom: 16 }}
      />

      <Card size="small" title="① 当前数据库状态" style={{ marginBottom: 16 }} loading={loading}>
        {status && (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="驱动" valueRender={() => (
                  <Tag color={status.kind === 'postgres' ? 'blue' : 'green'} style={{ fontSize: 14 }}>
                    {status.kind.toUpperCase()}
                  </Tag>
                )} value={status.kind} />
              </Col>
              <Col span={10}>
                <Statistic title="DB_URL" valueRender={() => (
                  <Text code copyable style={{ fontSize: 12 }}>{status.url}</Text>
                )} value={status.url} />
              </Col>
              <Col span={4}>
                <Statistic title="总行数" value={totalRows} />
              </Col>
              <Col span={4}>
                <Statistic title="表数" value={status.tables.length} />
              </Col>
            </Row>
            <Descriptions size="small" column={3} style={{ marginTop: 16 }}>
              {status.tables.map(t => (
                <Descriptions.Item key={t.name} label={t.name}>{t.rows}</Descriptions.Item>
              ))}
            </Descriptions>
            {status.lastMigratedAt && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message={`上次迁移于 ${status.lastMigratedAt}`}
              />
            )}
          </>
        )}
      </Card>

      <Card size="small" title="② 目标连接 + 执行" style={{ marginBottom: 16 }}>
        <Steps current={step} size="small" style={{ marginBottom: 24 }}
          items={[
            { title: '配置目标', icon: <ApiOutlined /> },
            { title: '连接验证', icon: <CheckCircleOutlined /> },
            { title: '迁移中', icon: <DatabaseOutlined /> },
            { title: '完成' },
          ]}
        />
        <Form form={form} layout="vertical" initialValues={{ dryRun: true, truncate: false }}>
          <Form.Item
            name="pgUrl"
            label="Postgres 连接串"
            rules={[{ required: true, message: '请输入连接串' }, {
              pattern: /^(postgres|postgresql):\/\//, message: '必须以 postgres:// 或 postgresql:// 开头',
            }]}
          >
            <Input placeholder="postgresql://user:password@host:5432/combat" autoComplete="off" />
          </Form.Item>
          <Form.Item label="选项">
            <Space wrap>
              <Form.Item name="dryRun" valuePropName="checked" noStyle>
                <Button type={form.getFieldValue('dryRun') ? 'primary' : 'default'} onClick={() => {
                  const cur = form.getFieldValue('dryRun');
                  form.setFieldValue('dryRun', !cur);
                }}>
                  {form.getFieldValue('dryRun') ? '✓ 试运行' : '试运行(推荐先开)'}
                </Button>
              </Form.Item>
              <Form.Item name="truncate" valuePropName="checked" noStyle>
                <Button danger={form.getFieldValue('truncate')} onClick={() => {
                  const cur = form.getFieldValue('truncate');
                  form.setFieldValue('truncate', !cur);
                }}>
                  {form.getFieldValue('truncate') ? '⚠ TRUNCATE 已开' : 'TRUNCATE 目标表(危险)'}
                </Button>
              </Form.Item>
            </Space>
          </Form.Item>
          <Space>
            <Button onClick={testConnection} loading={testing} icon={<ApiOutlined />}>
              测试连接
            </Button>
            <Button type="primary" onClick={runMigration} loading={migrating}
              disabled={status?.kind === 'postgres'}
              icon={<DatabaseOutlined />}>
              开始迁移
            </Button>
            {status?.kind === 'postgres' && (
              <Text type="warning"><WarningOutlined /> 当前已在 Postgres,不需要迁移</Text>
            )}
          </Space>
        </Form>

        {migrating && (
          <div style={{ marginTop: 24 }}>
            <Progress percent={progress} status="active" />
            <Text type="secondary">迁移中,请勿关闭页面或重启 backend</Text>
          </div>
        )}
      </Card>

      {result && (
        <Card size="small" title="③ 迁移结果">
          {result.ok ? (
            <Alert
              type="success"
              showIcon
              message="迁移完成"
              description="下一步:将 backend 的 DB_URL env 改为 Postgres 连接串后重启,业务自动切换到新数据源。完成后建议保留 SQLite 备份至少一周。"
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              type="error"
              showIcon
              message="迁移失败"
              description={result.error || '未知错误,事务已回滚'}
              style={{ marginBottom: 16 }}
            />
          )}
          {Object.keys(result.stats).length > 0 && (
            <Descriptions bordered size="small" column={2}>
              {Object.entries(result.stats).map(([table, s]) => (
                <Descriptions.Item key={table} label={table}>
                  {s.copied}/{s.source}
                </Descriptions.Item>
              ))}
            </Descriptions>
          )}
        </Card>
      )}
    </div>
  );
}
