import { useEffect, useState } from 'react';
import { Typography, DatePicker, Statistic, Row, Col, Descriptions, Card, List, Button, message, Empty, Skeleton, Tag, Space, theme } from 'antd';
import { CopyOutlined, LeftOutlined, RightOutlined, SendOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { api } from '../api.js';
import { STATUS_COLOR } from '../constants.js';
import { copyToClipboard } from '../utils/clipboard.js';
import StatusTag from '../components/StatusTag.js';
import type { DailyReport } from '@combat/shared';
import HelpButton from '../components/HelpButton.js';
import HELP from '../help-content.js';

function reportToText(r: DailyReport): string {
  const lines: string[] = [];
  lines.push(`攻关日报 - ${r.date}`);
  lines.push(`被触达攻关单 ${r.summary.ticketsTouched} · 进展条目 ${r.summary.entriesTotal}`);
  const status = Object.entries(r.summary.openByStatus).map(([s, n]) => `${s}:${n}`).join(' / ');
  if (status) lines.push(`状态分布: ${status}`);
  lines.push('');
  for (const s of r.sections) {
    lines.push(`【${s.标题}】（${s.latestStatus}）`);
    for (const e of s.entries) {
      lines.push(`  #${e.seqNo} [${e.statusSnapshot}] ${e.content} — ${e.updatedBy} @ ${e.at}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export default function DailyReportPage() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [r, setR] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const { token } = theme.useToken();

  useEffect(() => {
    setLoading(true);
    api.getDailyReport(date.format('YYYY-MM-DD'))
      .then(setR)
      .catch(() => { setR(null); })
      .finally(() => setLoading(false));
  }, [date]);

  const copy = async () => {
    if (!r) return;
    const ok = await copyToClipboard(reportToText(r));
    if (ok) message.success('已复制到剪贴板');
    else message.error('复制失败');
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const result = await api.publishDailyReport(date.format('YYYY-MM-DD'));
      message.success(`已发布：触达 ${result.ticketsTouched} 单，发布 ${result.published} 条`);
    } catch (e: any) { message.error(e.message); }
    finally { setPublishing(false); }
  };

  const shiftDate = (delta: number) => setDate(d => d.add(delta, 'day'));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>攻关日报</Typography.Title>
          <HelpButton title={HELP.dailyReport.title} content={HELP.dailyReport.content} />
        </div>
      </div>
      <Row gutter={16} align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space>
            <Button icon={<LeftOutlined />} size="small" onClick={() => shiftDate(-1)} />
            <Button size="small" onClick={() => setDate(dayjs())}>今天</Button>
            <Button icon={<RightOutlined />} size="small" onClick={() => shiftDate(1)} />
          </Space>
        </Col>
        <Col><DatePicker value={date} onChange={(d) => d && setDate(d)} /></Col>
        <Col>
          <Space>
            <Button icon={<CopyOutlined />} onClick={copy} disabled={!r || loading}>复制</Button>
            <Button icon={<SendOutlined />} onClick={publish} loading={publishing} disabled={!r || loading} type="primary">发布日报</Button>
          </Space>
        </Col>
      </Row>

      {loading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : !r ? (
        <Empty description="该日无日报数据" />
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col><Card size="small"><Statistic title="被触达攻关单" value={r.summary.ticketsTouched} /></Card></Col>
            <Col><Card size="small"><Statistic title="进展条目数" value={r.summary.entriesTotal} /></Card></Col>
            {Object.entries(r.summary.openByStatus).map(([s, n]) => (
              <Col key={s}><Card size="small"><Statistic title={s} value={n} valueStyle={{ color: STATUS_COLOR[s] ?? undefined }} /></Card></Col>
            ))}
          </Row>
          {r.sections.length === 0 && <Empty description="该日无进展记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {r.sections.map(s => (
            <Card key={s.ticketId} size="small" style={{ marginBottom: 12 }}
              title={<Space><span>【{s.标题}】</span><StatusTag status={s.latestStatus} /></Space>}
              extra={<a href={`#/attack/${s.ticketId}`} style={{ fontSize: 12 }}>查看详情</a>}>
              <List size="small" dataSource={s.entries} rowKey={(e) => `${s.ticketId}-${e.seqNo}`}
                renderItem={(e) => (
                  <List.Item>
                    <div style={{ flex: 1 }}>
                      <div>
                        <Tag style={{ marginRight: 8 }}>#{e.seqNo}</Tag>
                        <StatusTag status={e.statusSnapshot} />
                        <span style={{ marginLeft: 8 }}>{e.content}</span>
                      </div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                        — {e.updatedBy} @ {e.at}
                      </div>
                    </div>
                  </List.Item>
                )} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
