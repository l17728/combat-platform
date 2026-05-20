import { useEffect, useState } from "react";
import { DatePicker, Statistic, Row, Col, Descriptions, Card, List, Button, message, Typography } from "antd";
import dayjs, { Dayjs } from "dayjs";
import { api } from "../api.js";
import type { DailyReport } from "@combat/shared";

function reportToText(r: DailyReport): string {
  const lines: string[] = [];
  lines.push(`攻关日报 - ${r.date}`);
  lines.push(`被触达攻关单 ${r.summary.ticketsTouched} · 进展条目 ${r.summary.entriesTotal}`);
  const status = Object.entries(r.summary.openByStatus).map(([s, n]) => `${s}:${n}`).join(" / ");
  if (status) lines.push(`状态分布: ${status}`);
  lines.push("");
  for (const s of r.sections) {
    lines.push(`【${s.标题}】（${s.latestStatus}）`);
    for (const e of s.entries) {
      lines.push(`  #${e.seqNo} [${e.statusSnapshot}] ${e.content} — ${e.updatedBy} @ ${e.at}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function DailyReportPage() {
  const [date, setDate] = useState<Dayjs>(dayjs());
  const [r, setR] = useState<DailyReport | null>(null);
  useEffect(() => {
    api.getDailyReport(date.format("YYYY-MM-DD")).then(setR)
      .catch(() => message.error("日报加载失败"));
  }, [date]);

  const copy = async () => {
    if (!r) return;
    try { await navigator.clipboard.writeText(reportToText(r)); message.success("已复制"); }
    catch { message.error("复制失败"); }
  };

  return (
    <div style={{ padding: 16 }}>
      <Typography.Title level={3}>攻关日报</Typography.Title>
      <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
        <Col>日期：</Col>
        <Col><DatePicker aria-label="report-date" value={date} onChange={(d) => d && setDate(d)} /></Col>
        <Col><Button aria-label="copy-report" type="primary" onClick={copy} disabled={!r}>复制到剪贴板</Button></Col>
      </Row>
      {r && (
        <>
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col><Statistic title="被触达攻关单" value={r.summary.ticketsTouched} /></Col>
            <Col><Statistic title="进展条目数" value={r.summary.entriesTotal} /></Col>
          </Row>
          <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="状态分布">
              {Object.entries(r.summary.openByStatus).map(([s, n]) => `${s}: ${n}`).join("　") || "无"}
            </Descriptions.Item>
          </Descriptions>
          {r.sections.length === 0 && <p role="status">该日无进展记录</p>}
          {r.sections.map(s => (
            <Card key={s.ticketId} size="small" style={{ marginBottom: 12 }}
              title={`【${s.标题}】（${s.latestStatus}）`}>
              <List size="small" dataSource={s.entries} rowKey={(e) => `${s.ticketId}-${e.seqNo}`}
                renderItem={(e) => (
                  <List.Item>
                    #{e.seqNo} [{e.statusSnapshot}] {e.content}
                    <span style={{ marginLeft: 8, color: "#888" }}>— {e.updatedBy} @ {e.at}</span>
                  </List.Item>
                )} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
