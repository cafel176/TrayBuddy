/**
 * 前端覆盖率去重计算脚本
 *
 * v8 coverage 在 Windows + SvelteKit 环境下会因路径大小写差异
 * （d:\\ vs D:\\）将同一文件计入两次，导致总覆盖率被减半。
 * 此脚本读取 coverage-summary.json，按文件名去重后输出真实覆盖率。
 */
const fs = require("fs");
const path = require("path");

const summaryPath = path.join(__dirname, "coverage", "coverage-summary.json");

if (!fs.existsSync(summaryPath)) {
  console.error("Coverage summary not found. Run 'pnpm test:coverage' first.");
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));

// 按小写路径去重，保留覆盖率更高的版本
const deduped = new Map();
for (const [filePath, data] of Object.entries(summary)) {
  if (filePath === "total") continue;
  const key = filePath.toLowerCase();
  const existing = deduped.get(key);
  if (!existing || data.lines.covered > existing.lines.covered) {
    deduped.set(key, { ...data, _path: filePath });
  }
}

// 计算去重后的总计
let totalLines = 0, coveredLines = 0;
let totalBranches = 0, coveredBranches = 0;
let totalFunctions = 0, coveredFunctions = 0;
let totalStatements = 0, coveredStatements = 0;

const rows = [];
for (const [, data] of deduped) {
  totalLines += data.lines.total;
  coveredLines += data.lines.covered;
  totalBranches += data.branches.total;
  coveredBranches += data.branches.covered;
  totalFunctions += data.functions.total;
  coveredFunctions += data.functions.covered;
  totalStatements += data.statements.total;
  coveredStatements += data.statements.covered;

  const name = path.relative(path.join(__dirname, ".."), data._path).replace(/\\/g, "/");
  const lPct = data.lines.total ? ((data.lines.covered / data.lines.total) * 100).toFixed(1) : "100";
  const bPct = data.branches.total ? ((data.branches.covered / data.branches.total) * 100).toFixed(1) : "100";
  const fPct = data.functions.total ? ((data.functions.covered / data.functions.total) * 100).toFixed(1) : "100";
  rows.push({ name, lPct, bPct, fPct, uncovered: data.lines.total - data.lines.covered });
}

// 按覆盖率升序排列，方便找到最需要改进的文件
rows.sort((a, b) => parseFloat(a.lPct) - parseFloat(b.lPct));

const pct = (c, t) => t ? ((c / t) * 100).toFixed(2) : "100.00";

console.log("");
console.log("=".repeat(80));
console.log("  Frontend Coverage Report (de-duplicated)");
console.log("=".repeat(80));
console.log("");
console.log("  File                                      Lines    Branches  Functions  Uncov");
console.log("  " + "-".repeat(76));

for (const r of rows) {
  const n = r.name.length > 40 ? "..." + r.name.slice(-37) : r.name.padEnd(40);
  console.log(`  ${n}  ${r.lPct.padStart(5)}%   ${r.bPct.padStart(6)}%    ${r.fPct.padStart(6)}%     ${String(r.uncovered).padStart(3)}`);
}

console.log("");
console.log("  " + "=".repeat(76));
console.log(`  TOTAL                                     ${pct(coveredLines, totalLines).padStart(6)}%   ${pct(coveredBranches, totalBranches).padStart(6)}%    ${pct(coveredFunctions, totalFunctions).padStart(6)}%     ${String(totalLines - coveredLines).padStart(3)}`);
console.log("  " + "=".repeat(76));
console.log("");

const linesPct = parseFloat(pct(coveredLines, totalLines));
if (linesPct >= 90) {
  console.log(`  OK Coverage target MET: ${linesPct}% >= 90%`);
} else {
  console.log(`  NG Coverage target NOT MET: ${linesPct}% < 90%`);
  console.log(`    Need to cover ${Math.ceil(totalLines * 0.9) - coveredLines} more lines to reach 90%`);
}
console.log("");
