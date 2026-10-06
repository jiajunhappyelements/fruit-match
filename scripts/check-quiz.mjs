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
const {
  nextQuestion, availableSubjects, HISTORY_KEY,
  CHINESE_BANK, pinyinDistractors, hasSingleReading, PATTERNS,
  SHIZI, POEMS, CLASSICAL, OTHER_READINGS,
} = await import(pathToFileURL(out).href);

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

// 语文逐类核对。课本数据是照片录入的，这里核的是「出题逻辑没把对的说成错的」：
// 读音题的干扰项不能是这个字的任何一个读音、上下句必须真的相邻。
function readingsOf(ch) {
  const s = new Set(OTHER_READINGS[ch] ?? []);
  for (const z of SHIZI) if (z.char === ch) s.add(z.pinyin);
  return s;
}
function checkChinese(q) {
  if (q.lesson == null) return "没标课号";
  if (!q.explain) return "答错时没有讲解";
  const a = q.options[q.answer];
  const wrong = q.options.filter((_, i) => i !== q.answer);
  let m;
  switch (q.topic) {
    case "生字读音": {
      if (!(m = q.prompt.match(/^「(.)」字读什么？$/u))) return "题面格式怪";
      const ch = m[1];
      const rows = SHIZI.filter((z) => z.char === ch && z.lesson === q.lesson);
      if (!rows.length) return `识字表第 ${q.lesson} 课没有「${ch}」`;
      if (rows.some((z) => z.poly) || readingsOf(ch).size > 1) return `「${ch}」是多音字，不该单独考读音`;
      if (!rows.some((z) => z.pinyin === a)) return `读音错: 「${ch}」标了 ${a}`;
      const rs = readingsOf(ch);
      const bad = wrong.find((o) => rs.has(o));
      return bad ? `干扰项其实也是「${ch}」的读音: ${bad}` : null;
    }
    case "词语结构": {
      if (!(m = q.prompt.match(/「([A-Z]+)」式/))) return "题面格式怪";
      const p = PATTERNS.find((x) => x.name === m[1]);
      if (!p) return "未知结构 " + m[1];
      if (!p.test([...a])) return `答案「${a}」不是 ${p.name} 式`;
      const bad = wrong.find((o) => p.test([...o]));
      return bad ? `干扰项「${bad}」也是 ${p.name} 式` : null;
    }
    case "古诗背诵": {
      if (!(m = q.prompt.match(/^《(.+?)》\n「(?:……，)?(.+?)[，。]」\n(下|上)一句是？$/u))) return "题面格式怪";
      const poem = POEMS.find((p) => p.title === m[1] && p.lesson === q.lesson);
      if (!poem) return "找不到这首诗";
      const i = poem.lines.indexOf(m[2]);
      if (i < 0) return "题面诗句不在原诗里: " + m[2];
      const want = m[3] === "下" ? poem.lines[i + 1] : poem.lines[i - 1];
      if (a !== want) return `上下句错: 「${m[2]}」${m[3]}一句应为「${want}」，标了「${a}」`;
      return null;
    }
    case "诗人朝代": {
      const poem = POEMS.find((p) => q.prompt.startsWith(`《${p.title}》`) && p.lesson === q.lesson);
      if (!poem) return "找不到这首诗";
      if (q.prompt.endsWith("的作者是？")) {
        if (a !== poem.author) return `作者错: 应为 ${poem.author}`;
        return wrong.includes(poem.author) ? "干扰项里有正确作者" : null;
      }
      return a === `${poem.dynasty}朝` ? null : `朝代错: 应为 ${poem.dynasty}朝`;
    }
    case "小古文": {
      if (!(m = q.prompt.match(/^《(.+?)》\n「(.+?)」\n后面一句是？$/u))) return "题面格式怪";
      const t = CLASSICAL.find((c) => c.title === m[1]);
      const i = t ? t.sentences.indexOf(m[2]) : -1;
      if (i < 0) return "题面句子不在原文里";
      return a === t.sentences[i + 1] ? null : `应为「${t.sentences[i + 1]}」，标了「${a}」`;
    }
    case "课文知识":
      return null; // 题面和答案原样取自 FACTS，只做结构检查
    default:
      return "UNCHECKED";
  }
}

// 每个会被考读音的字（非蓝字、只有一个读音）都必须凑得出 3 个干扰项
const testable = SHIZI.filter((x) => !x.poly && hasSingleReading(x.char));
console.log(`生字读音：${SHIZI.length} 个字里 ${testable.length} 个可以单独考读音（其余是多音字）`);
for (const z of testable) {
  const ds = pinyinDistractors(z.char, z.pinyin);
  const rs = readingsOf(z.char);
  if (ds.length < 3) fails.push(`生字读音: 「${z.char}」${z.pinyin} 只凑出 ${ds.length} 个干扰项`);
  for (const d of ds) if (rs.has(d)) fails.push(`生字读音: 「${z.char}」干扰项 ${d} 是它的另一个读音`);
}

// 语文题库单独多抽一些：生字 225 个、6 种题型，混在数学里抽的样本不够
const cnSeen = new Map();
for (let i = 0; i < 12000; i++) {
  const q = CHINESE_BANK[Math.floor(Math.random() * CHINESE_BANK.length)]();
  cnSeen.set(q.topic, (cnSeen.get(q.topic) ?? 0) + 1);
  const e = checkStructure(q) ?? checkChinese(q);
  if (e) fails.push(`${q.topic}: ${e} :: ${q.prompt.replace(/\n/g, " ")} → ${q.options.join(" / ")}`);
}

const N = 500;
const subjects = availableSubjects();
if (subjects.length === 0) {
  console.error("题库全空，道具会退回「点一下直接生效」");
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
  const e2 = q.subject === "math" ? checkMath(q) : q.subject === "chinese" ? checkChinese(q) : null;
  if (e2 === "UNCHECKED") fails.push(`${q.topic}: 校验器没覆盖这个题型 :: ${q.prompt}`);
  else if (e2) fails.push(`${q.topic}: ${e2} :: ${q.prompt}`);
}

console.log(`科目: ${subjects.join("、")}    抽查 ${N * 12} 题`);
for (const [t, c] of [...seen].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(28)} ${c}`);
console.log("\n语文单独抽查 12000 题：");
for (const [t, c] of [...cnSeen].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(28)} ${c}`);
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
