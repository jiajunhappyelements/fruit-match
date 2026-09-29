// ---------------------------------------------------------------------------
// 题库自检：npm run check:quiz
//
// 数学题是现算的，一个模板写错就会连着几百道题都错，而错题最后是给孩子看的，
// 所以这里把每个生成器跑 500 遍，逐题独立重算一遍答案。
// 语文/英语填进去之后同样会被结构检查（4 个不重复选项、答案下标有效）覆盖。
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(mkdtempSync(join(tmpdir(), "quiz-")), "bank.mjs");
execFileSync(
  "npx",
  ["esbuild", "src/quiz/index.ts", "--bundle", "--format=esm", `--outfile=${out}`, "--log-level=error"],
  { cwd: root, stdio: "inherit" },
);
// index.ts 摸 localStorage，Node 里没有，给个最小替身
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { nextQuestion, availableSubjects, HISTORY_KEY } = await import(pathToFileURL(out).href);

const num = (s) => Number(String(s).replace(/[^0-9.\-]/g, ""));
const fails = [];
const seen = new Map();

function checkStructure(q) {
  if (!q.prompt) return "没有题面";
  if (q.options.length !== 4) return "选项不是 4 个";
  if (new Set(q.options).size !== 4) return "选项有重复: " + q.options.join(" / ");
  if (!(q.answer >= 0 && q.answer < 4)) return "answer 下标越界";
  // 整数题混进小数选项 = 送分（孩子不用算就能排除）
  if (!q.topic.includes("小数") && /^-?\d+$/.test(q.options[q.answer]) && q.options.some((o) => /^-?\d+\.\d+$/.test(o)))
    return "整数题里有小数干扰项: " + q.options.join(" / ");
  return null;
}

// 数学题逐类独立重算。没被任何规则认领的题面会报 UNCHECKED，
// 提醒「加了新题型但忘了加校验」。
function checkMath(q) {
  const p = q.prompt;
  const a = q.options[q.answer];
  let m;

  if ((m = p.match(/^(\d+) ÷ (\d+) = \?$/))) {
    const [A, B] = [Number(m[1]), Number(m[2])];
    const mm = a.match(/^(\d+)(?: 余 (\d+))?$/);
    if (!mm) return "除法答案格式怪: " + a;
    const quo = Number(mm[1]);
    const rem = Number(mm[2] ?? 0);
    if (B * quo + rem !== A) return `除法错: ${A}÷${B} ≠ ${a}`;
    if (rem >= B) return `余数 ≥ 除数: ${a}`;
    return null;
  }
  if ((m = p.match(/^([0-9+\-×÷() .]+)\s*=\s*\?(?:（|$)/))) {
    const want = eval(m[1].replace(/×/g, "*").replace(/÷/g, "/"));
    return Math.abs(want - num(a)) < 1e-9 ? null : `算错: ${m[1]} 应为 ${want}，标了 ${a}`;
  }
  if ((m = p.match(/(\d+)° 和 (\d+)°/))) {
    const want = 180 - Number(m[1]) - Number(m[2]);
    if (want <= 0) return `第三个角不是正数: ${want}`;
    return want === num(a) ? null : `内角和错: 应为 ${want}°，标了 ${a}`;
  }
  if ((m = p.match(/^([\d、]+) 这 (\d+) 个数的平均数/))) {
    const ns = m[1].split("、").map(Number);
    if (ns.length !== Number(m[2])) return "个数对不上";
    if (ns.some((v) => v <= 0)) return "出现了非正数: " + m[1];
    const want = ns.reduce((s, v) => s + v, 0) / ns.length;
    return Math.abs(want - num(a)) < 1e-9 ? null : `平均数错: 应为 ${want}，标了 ${a}`;
  }
  if ((m = p.match(/^(\d+) 公顷 = /))) return Number(m[1]) * 10000 === num(a) ? null : `公顷换算错: ${a}`;
  if ((m = p.match(/^(\d+) 平方千米 = /))) return Number(m[1]) * 100 === num(a) ? null : `平方千米换算错: ${a}`;
  if ((m = p.match(/^(\d+) 改写成用「万」/))) return Number(m[1]) / 10000 === num(a) ? null : `改写错: ${a}`;
  if ((m = p.match(/^(\d+) 省略万位/))) return Math.round(Number(m[1]) / 10000) === num(a) ? null : `近似数错: ${a}`;
  if ((m = p.match(/^(\d+)° 的角是什么角/))) {
    const d = Number(m[1]);
    const want = d < 90 ? "锐角" : d === 90 ? "直角" : d < 180 ? "钝角" : "平角";
    return want === a ? null : `角分类错: ${d}° 应为 ${want}，标了 ${a}`;
  }
  if (p.includes("哪个数最大")) {
    const vals = q.options.map(num);
    const max = Math.max(...vals);
    if (vals.filter((v) => Math.abs(v - max) < 1e-9).length > 1) return `并列最大，题目有歧义: ${q.options.join(" / ")}`;
    return Math.abs(vals[q.answer] - max) < 1e-9 ? null : `不是最大: ${q.options.join(" / ")} 标了 ${a}`;
  }
  return "UNCHECKED";
}

const N = 500;
const subjects = availableSubjects();
if (subjects.length === 0) {
  console.error("题库全空，钥匙关会自动失效");
  process.exit(1);
}
for (let i = 0; i < N * 12; i++) {
  const q = nextQuestion();
  seen.set(`${q.subject}/${q.topic}`, (seen.get(`${q.subject}/${q.topic}`) ?? 0) + 1);
  const e1 = checkStructure(q);
  if (e1) {
    fails.push(`${q.topic}: ${e1} :: ${q.prompt}`);
    continue;
  }
  if (q.subject !== "math") continue;
  const e2 = checkMath(q);
  if (e2 === "UNCHECKED") fails.push(`${q.topic}: 校验器没覆盖这个题型 :: ${q.prompt}`);
  else if (e2) fails.push(`${q.topic}: ${e2} :: ${q.prompt}`);
}

console.log(`科目: ${subjects.join("、")}    抽查 ${N * 12} 题`);
for (const [t, c] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(28)} ${c}`);
if (fails.length) {
  console.log(`\n❌ 未通过 ${fails.length} 条：`);
  for (const f of fails.slice(0, 20)) console.log("  " + f);
  process.exit(1);
}
// --- 抽题加权：错得多的题型真的会被多抽到吗 --------------------------------
// 模拟「三角形」最近 8 次全错、其余题型最近 8 次全对，比较前后出现比例。
const share = (topic, n = 6000) => {
  let hit = 0;
  for (let i = 0; i < n; i++) if (nextQuestion().topic === topic) hit++;
  return hit / n;
};
store.delete(HISTORY_KEY);
const TARGET = "三角形";
const base = share(TARGET);
const topics = [...seen.keys()].map((k) => k.split("/")[1]);
const fake = [];
for (const t of topics) for (let i = 0; i < 8; i++)
  fake.push({ t: i, subject: "math", topic: t, prompt: "x", picked: "a", answer: "b", ok: t !== TARGET });
store.set(HISTORY_KEY, JSON.stringify(fake));
const weighted = share(TARGET);
const ratio = weighted / base;
console.log(`\n抽题加权：「${TARGET}」基线 ${(base * 100).toFixed(1)}% → 全错后 ${(weighted * 100).toFixed(1)}%（×${ratio.toFixed(2)}）`);
if (ratio < 2) {
  console.log("❌ 错题加权没起作用（期望至少翻倍）");
  process.exit(1);
}
// 记录损坏不能拖垮出题
store.set(HISTORY_KEY, "{not json");
if (!nextQuestion()) { console.log("❌ 记录损坏时出不了题"); process.exit(1); }
store.delete(HISTORY_KEY);

console.log("\n✅ 全部通过");
