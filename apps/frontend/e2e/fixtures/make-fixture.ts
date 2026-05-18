import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const rows = [
  { 标题: "导入断连A", 状态: "进行中", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
  { 标题: "导入断连B", 状态: "已解决", 攻关申请人: "洪瑞哲", 攻关申请人工号: "WX1497394" },
];
const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "S");
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "sample.xlsx"),
  XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
