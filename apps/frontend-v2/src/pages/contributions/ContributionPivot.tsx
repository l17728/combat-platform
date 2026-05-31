import { useMemo, useState } from "react";
import { Table, Segmented, Empty, Typography, Space } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { GraphNode } from "@combat/shared";

const { Text } = Typography;

interface Props {
  personNodes: GraphNode[];
  teamNodes: GraphNode[];
  contribTypes: string[];
}

// 加权: 核心=3, 关键=2, 普通=1
const LEVEL_WEIGHT: Record<string, number> = { 核心: 3, 关键: 2, 普通: 1 };

interface PivotRow {
  key: string; // 贡献人/团队名称
  name: string;
  byType: Record<string, { count: number; score: number }>;
  totalCount: number;
  totalScore: number;
}

function buildPivot(
  nodes: GraphNode[],
  rowField: string,
  colField: string,
  colValues: string[]
): { rows: PivotRow[]; colTotals: Record<string, { count: number; score: number }>; grand: { count: number; score: number } } {
  const rowMap = new Map<string, PivotRow>();
  const colTotals: Record<string, { count: number; score: number }> = {};
  for (const c of colValues) colTotals[c] = { count: 0, score: 0 };
  const grand = { count: 0, score: 0 };

  for (const n of nodes) {
    const rowVal = String(n.properties[rowField] ?? "").trim();
    if (!rowVal) continue;
    const colVal = String(n.properties[colField] ?? "").trim();
    const level = String(n.properties["贡献等级"] ?? "").trim();
    const w = LEVEL_WEIGHT[level] ?? 1;
    if (!rowMap.has(rowVal)) {
      const init: PivotRow = {
        key: rowVal,
        name: rowVal,
        byType: {},
        totalCount: 0,
        totalScore: 0,
      };
      for (const c of colValues) init.byType[c] = { count: 0, score: 0 };
      rowMap.set(rowVal, init);
    }
    const row = rowMap.get(rowVal)!;
    if (!row.byType[colVal]) row.byType[colVal] = { count: 0, score: 0 };
    row.byType[colVal].count += 1;
    row.byType[colVal].score += w;
    row.totalCount += 1;
    row.totalScore += w;
    if (colTotals[colVal]) {
      colTotals[colVal].count += 1;
      colTotals[colVal].score += w;
    }
    grand.count += 1;
    grand.score += w;
  }

  const rows = [...rowMap.values()].sort((a, b) => b.totalScore - a.totalScore);
  return { rows, colTotals, grand };
}

// 单元格背景深浅 — 用积分相对最大值
function cellBg(score: number, max: number): string | undefined {
  if (score <= 0 || max <= 0) return undefined;
  const ratio = Math.min(1, score / max);
  // 透明度 0.08~0.55,蓝色
  const alpha = 0.08 + ratio * 0.47;
  return `rgba(22, 119, 255, ${alpha.toFixed(3)})`;
}

export default function ContributionPivot({ personNodes, teamNodes, contribTypes }: Props) {
  const [mode, setMode] = useState<"person" | "team">("person");

  const source = mode === "person" ? personNodes : teamNodes;
  const rowField = mode === "person" ? "贡献人" : "团队名称";

  const { rows, colTotals, grand } = useMemo(
    () => buildPivot(source, rowField, "贡献类型", contribTypes),
    [source, rowField, contribTypes]
  );

  const maxCellScore = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      for (const c of contribTypes) {
        const s = r.byType[c]?.score ?? 0;
        if (s > m) m = s;
      }
    }
    return m;
  }, [rows, contribTypes]);

  const columns: ColumnsType<PivotRow> = useMemo(() => {
    const cols: ColumnsType<PivotRow> = [
      {
        key: "_name",
        title: mode === "person" ? "贡献人" : "团队名称",
        dataIndex: "name",
        fixed: "left",
        width: 140,
        render: (v: string) => <Text strong>{v}</Text>,
      },
      ...contribTypes.map<NonNullable<ColumnsType<PivotRow>>[number]>((t) => ({
        key: t,
        title: t,
        align: "center" as const,
        width: 100,
        render: (_: unknown, r: PivotRow) => {
          const v = r.byType[t] || { count: 0, score: 0 };
          return (
            <div
              data-testid={`pivot-cell-${r.name}-${t}`}
              style={{
                background: cellBg(v.score, maxCellScore),
                padding: "4px 6px",
                borderRadius: 3,
                minWidth: 60,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: v.score > 0 ? 500 : 400 }}>{v.count || "-"}</div>
              {v.score > 0 && (
                <div style={{ fontSize: 11, color: "#666" }}>{v.score} 分</div>
              )}
            </div>
          );
        },
      })),
      {
        key: "_subtotal",
        title: "小计",
        align: "center",
        width: 90,
        fixed: "right",
        render: (_: unknown, r: PivotRow) => (
          <div data-testid={`pivot-row-total-${r.name}`}>
            <Text strong>{r.totalCount}</Text>
            <div style={{ fontSize: 11, color: "#666" }}>{r.totalScore} 分</div>
          </div>
        ),
      },
    ];
    return cols;
  }, [contribTypes, maxCellScore, mode]);

  // 列尾(总计行)用 Table summary
  const summary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row data-testid="pivot-grand-row">
        <Table.Summary.Cell index={0}>
          <Text strong>列尾·总计</Text>
        </Table.Summary.Cell>
        {contribTypes.map((c, idx) => {
          const v = colTotals[c] || { count: 0, score: 0 };
          return (
            <Table.Summary.Cell index={idx + 1} key={c} align="center">
              <div data-testid={`pivot-col-total-${c}`}>
                <Text strong>{v.count || "-"}</Text>
                {v.score > 0 && <div style={{ fontSize: 11, color: "#666" }}>{v.score} 分</div>}
              </div>
            </Table.Summary.Cell>
          );
        })}
        <Table.Summary.Cell index={contribTypes.length + 1} align="center">
          <div data-testid="pivot-grand-total">
            <Text strong style={{ color: "#1677ff" }}>
              {grand.count}
            </Text>
            <div style={{ fontSize: 11, color: "#1677ff" }}>{grand.score} 分</div>
          </div>
        </Table.Summary.Cell>
      </Table.Summary.Row>
    </Table.Summary>
  );

  return (
    <div data-testid="contribution-pivot">
      <Space style={{ marginBottom: 12 }}>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as "person" | "team")}
          options={[
            { label: "个人贡献", value: "person" },
            { label: "团队贡献", value: "team" },
          ]}
        />
        <Text type="secondary">行=贡献人/团队;列=贡献类型;值=次数+加权积分(核心3/关键2/普通1)</Text>
      </Space>
      {rows.length === 0 ? (
        <Empty description="暂无贡献数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table<PivotRow>
          rowKey="key"
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: true, y: 480 }}
          size="middle"
          summary={summary}
          bordered
        />
      )}
    </div>
  );
}
