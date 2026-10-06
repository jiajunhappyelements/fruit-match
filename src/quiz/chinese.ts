// ---------------------------------------------------------------------------
// 四年级语文题库 —— 数据见 chinese-data.ts（统编版四上 2024 新版，照课本录入）。
//
// 整册都出，不按进度筛：学过的算复习，没学过的算预习（用户的决定——进度一直在变，
// 让家长手动维护「学到第几课」不现实）。答错多的题型会被错题加权自动多出。
//
// 每种题的正确性都靠构造保证，不靠人工判断：
//   生字读音 —— 答案是课本标的拼音；干扰项由改声调 / 平翘舌 / 前后鼻音 / n-l 变出来，
//              并且排除这个字的所有其他读音（多音字的「错误选项」不能其实是对的）。
//   词语结构 —— AABB / ABB / ABAC / AA 按字形用代码判定，不是人工分类。
//   古诗、小古文 —— 上下句关系来自原文顺序。
// ---------------------------------------------------------------------------
import type { Generator, Question } from "./types";
import { CIYU, CLASSICAL, FACTS, OTHER_READINGS, POEMS, POET_POOL, SHIZI, lessonName } from "./chinese-data";

// --- 小工具 -------------------------------------------------------------------
const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[ri(0, arr.length - 1)];

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = ri(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 答案 + 从候选里挑 3 个不重复的干扰项。候选不够 3 个就返回 null（这道题出不了）。 */
function mc(
  topic: string,
  lesson: number,
  prompt: string,
  answer: string,
  pool: string[],
  explain: string,
): Question | null {
  const wrong = shuffled([...new Set(pool)].filter((w) => w !== answer)).slice(0, 3);
  if (wrong.length < 3) return null;
  const options = shuffled([answer, ...wrong]);
  return { subject: "chinese", topic, lesson, prompt, options, answer: options.indexOf(answer), explain };
}

// --- 拼音变形 -----------------------------------------------------------------
const TONES: Record<string, string> = {
  a: "āáǎà", o: "ōóǒò", e: "ēéěè", i: "īíǐì", u: "ūúǔù", ü: "ǖǘǚǜ",
};
const MARKED = new Map<string, [string, number]>();
for (const [v, marks] of Object.entries(TONES)) [...marks].forEach((m, t) => MARKED.set(m, [v, t]));

/** 同一个音节换成另外三个声调。 */
function toneVariants(py: string): string[] {
  const chars = [...py];
  const idx = chars.findIndex((c) => MARKED.has(c));
  if (idx < 0) return [];
  const [vowel, tone] = MARKED.get(chars[idx])!;
  return [0, 1, 2, 3]
    .filter((t) => t !== tone)
    .map((t) => [...chars.slice(0, idx), TONES[vowel][t], ...chars.slice(idx + 1)].join(""));
}

/** 孩子最常混的几对：平翘舌、n/l、前后鼻音。声调保持不变。 */
function soundVariants(py: string): string[] {
  const out: string[] = [];
  const swapInit = (from: string, to: string) => {
    if (py.startsWith(from) && !(from.length === 1 && py.startsWith(to))) out.push(to + py.slice(from.length));
  };
  swapInit("zh", "z"); swapInit("ch", "c"); swapInit("sh", "s");
  swapInit("z", "zh"); swapInit("c", "ch"); swapInit("s", "sh");
  swapInit("n", "l"); swapInit("l", "n");
  // 前后鼻音：只动 an/en/in ↔ ang/eng/ing（ong、un 没有对应的另一半）
  const m = py.match(/^(.*?[aeiāáǎàēéěèīíǐì])(n|ng)$/);
  if (m) out.push(m[1] + (m[2] === "n" ? "ng" : "n"));
  return out;
}

/** 这个字所有「也算对」的读音：识字表里出现过的 + 手工登记的其他读音。 */
function readingsOf(char: string): Set<string> {
  const s = new Set(OTHER_READINGS[char] ?? []);
  for (const z of SHIZI) if (z.char === char) s.add(z.pinyin);
  return s;
}

// --- 生字读音 -----------------------------------------------------------------
export function pinyinDistractors(char: string, py: string): string[] {
  const valid = readingsOf(char);
  const ok = (p: string) => p !== py && !valid.has(p);
  const sound = soundVariants(py).filter(ok);
  const tone = toneVariants(py).filter(ok);
  // 尽量一个「声母/鼻音」错 + 两个声调错，比三个都是声调错更像真实的错法
  const picked = shuffled(sound).slice(0, 1);
  for (const t of shuffled(tone)) if (picked.length < 3 && !picked.includes(t)) picked.push(t);
  for (const s of shuffled(sound)) if (picked.length < 3 && !picked.includes(s)) picked.push(s);
  return picked;
}

/**
 * 能单独考读音的字：只有一个读音的。多音字（蓝字，或者另有读音还没学到的黑字）
 * 光问「X 字读什么」本身就有歧义，哪怕干扰项避开了别的读音也不行。
 */
export function hasSingleReading(char: string): boolean {
  return readingsOf(char).size === 1;
}

function shiziReading(): Question | null {
  const pool = SHIZI.filter((z) => !z.poly && hasSingleReading(z.char));
  const z = pick(pool);
  return mc(
    "生字读音",
    z.lesson,
    `「${z.char}」字读什么？`,
    z.pinyin,
    pinyinDistractors(z.char, z.pinyin),
    `「${z.char}」读 ${z.pinyin}（${lessonName(z.lesson)}）`,
  );
}

// --- 词语结构 -----------------------------------------------------------------
type Pattern = { name: string; like: string; test: (w: string[]) => boolean };
export const PATTERNS: Pattern[] = [
  { name: "AABB", like: "高高兴兴", test: (w) => w.length === 4 && w[0] === w[1] && w[2] === w[3] && w[0] !== w[2] },
  { name: "ABB", like: "绿油油", test: (w) => w.length === 3 && w[1] === w[2] && w[0] !== w[1] },
  { name: "ABAC", like: "自言自语", test: (w) => w.length === 4 && w[0] === w[2] && w[1] !== w[3] && w[0] !== w[1] },
  { name: "AA", like: "常常", test: (w) => w.length === 2 && w[0] === w[1] },
];

function ciyuStructure(): Question | null {
  const words = CIYU;
  const usable = PATTERNS.filter((p) => words.some((c) => p.test([...c.word])));
  if (usable.length === 0) return null;
  const p = pick(usable);
  const hit = pick(words.filter((c) => p.test([...c.word])));
  // 干扰项挑和答案一样长的词，免得凭字数就猜出来
  const others = words.filter((c) => !p.test([...c.word]));
  const sameLen = others.filter((c) => c.word.length === hit.word.length).map((c) => c.word);
  const pool = sameLen.length >= 3 ? sameLen : others.map((c) => c.word);
  return mc(
    "词语结构",
    hit.lesson,
    `哪个词语是「${p.name}」式的？\n（像「${p.like}」）`,
    hit.word,
    pool,
    `「${hit.word}」是 ${p.name} 式，和「${p.like}」一样`,
  );
}

// --- 古诗 ---------------------------------------------------------------------
function poemNextLine(): Question | null {
  const poem = pick(POEMS);
  const i = ri(0, poem.lines.length - 2);
  const forward = Math.random() < 0.6; // 多考「下一句」，偶尔考「上一句」
  const [given, answer] = forward ? [poem.lines[i], poem.lines[i + 1]] : [poem.lines[i + 1], poem.lines[i]];
  // 干扰项：同字数的其他诗句（包括题面那句本身——孩子得知道它不是答案）
  const pool = POEMS.flatMap((p) => p.lines).filter((l) => l.length === answer.length);
  const full = `${poem.lines[i]}，${poem.lines[i + 1]}。`;
  return mc(
    "古诗背诵",
    poem.lesson,
    forward ? `《${poem.title}》\n「${given}，」\n下一句是？` : `《${poem.title}》\n「……，${given}。」\n上一句是？`,
    answer,
    pool,
    `${full}——${poem.dynasty}·${poem.author}`,
  );
}

function poemAuthor(): Question | null {
  const poem = pick(POEMS);
  if (Math.random() < 0.6) {
    // 杜甫写过《前出塞》《后出塞》，考《出塞》时不拿他当干扰项
    const pool = POET_POOL.filter((a) => !(poem.title === "出塞" && a === "杜甫"));
    return mc("诗人朝代", poem.lesson, `《${poem.title}》的作者是？`, poem.author, pool,
      `《${poem.title}》是${poem.dynasty}代${poem.author}写的`);
  }
  return mc("诗人朝代", poem.lesson, `《${poem.title}》的作者${poem.author}是哪个朝代的？`,
    `${poem.dynasty}朝`, ["唐朝", "宋朝", "汉朝", "清朝"], `${poem.author}是${poem.dynasty}朝人`);
}

// --- 小古文 -------------------------------------------------------------------
function classicalNext(): Question | null {
  const t = pick(CLASSICAL);
  const i = ri(0, t.sentences.length - 2);
  return mc(
    "小古文",
    t.lesson,
    `《${t.title}》\n「${t.sentences[i]}」\n后面一句是？`,
    t.sentences[i + 1],
    t.sentences,
    `「${t.sentences[i]}，${t.sentences[i + 1]}」`,
  );
}

// --- 课文知识 -----------------------------------------------------------------
function lessonFact(): Question | null {
  const f = pick(FACTS);
  return mc("课文知识", f.lesson, f.q, f.a, f.wrong, f.explain);
}

// --- 出题入口 -----------------------------------------------------------------
const ALL: (() => Question | null)[] = [
  shiziReading, shiziReading, shiziReading, // 生字是这册的大头（250 个），权重 ×3
  ciyuStructure, poemNextLine, poemAuthor, classicalNext, lessonFact,
];

export const CHINESE_BANK: Generator[] = ALL.map((g) => () => {
    // 极少数随机组合凑不够干扰项，重试几次；仍不行就退回生字读音（素材最多）
    for (let k = 0; k < 30; k++) {
      const q = k < 8 ? g() : shiziReading();
      if (q) return q;
    }
    throw new Error("语文题库出不了题");
  });
