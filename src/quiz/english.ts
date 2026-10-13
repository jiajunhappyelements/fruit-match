// ---------------------------------------------------------------------------
// 四年级英语题库 —— 数据见 english-data.ts（照课本书后单词表录入，Unit 1~6）。
//
// 两种题，都是四选一：
//   看英文选意思：sunny 是什么意思？      → 阳光充足的 / 多云的，阴天的 / …
//   看中文选单词：「阳光充足的」用英语怎么说？→ sunny / cloudy / sunshine / …
//
// 干扰项要「像」但不能「也对」：
//   像 —— 优先同单元的词（天气那课就用天气词混），选英文时再优先拼写相近的
//         （cloud/cloudy、walk/wall、train/tram），这些是孩子真会弄混的。
//   不能也对 —— 释义互相包含的不放一起（car「汽车」和 bus「公共汽车」），
//         另外 english-data.ts 里登记了几对释义不重叠、但英语里意思撞车的（hope/wish 等）。
//
// 整册都出、不按进度筛，和语文一个规矩。
// ---------------------------------------------------------------------------
import type { Generator, Question } from "./types";
import { CONFUSABLE, WORDS, type Word } from "./english-data";

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

/** 答题框里显示的中文：原文太长才用截出来的 short。 */
export const display = (w: Word) => w.short ?? w.zh;

/** 去掉括号里的补充说明和省略号，只看「意思本身」。 */
const core = (s: string) => s.replace(/（[^）]*）/g, "").replace(/……/g, "").replace(/\s/g, "");

/** 一个词的各个义项（两个字以上的；「云」「雪」这种单字太短，拿来比会误伤）。 */
const senses = (w: Word) =>
  w.zh.split(/[；，！]/).map(core).filter((s) => s.length >= 2);

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const CONFUSE = new Set(CONFUSABLE.map(([a, b]) => pairKey(a, b)));

/** a 和 b 能不能出现在同一道题里（一个当答案、一个当干扰项）。 */
export function compatible(a: Word, b: Word): boolean {
  if (a.en === b.en || display(a) === display(b)) return false;
  if (CONFUSE.has(pairKey(a.en, b.en))) return false;
  const ca = core(a.zh), cb = core(b.zh);
  if (senses(a).some((s) => cb.includes(s))) return false;
  if (senses(b).some((s) => ca.includes(s))) return false;
  return true;
}

const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return i;
};

/**
 * 挑 3 个干扰项。byLook = 选项是英文时，优先拼写相近的（最多 2 个，不然整题全是
 * 「长得像」就成了拼写测验）；其余优先同单元。
 */
function distractors(target: Word, byLook: boolean): Word[] | null {
  const ok = WORDS.filter((w) => compatible(target, w));
  const looks = byLook ? shuffled(ok.filter((w) => commonPrefix(w.en, target.en) >= 3)).slice(0, 2) : [];
  const rest = ok.filter((w) => !looks.includes(w));
  const ordered = [
    ...looks,
    ...shuffled(rest.filter((w) => w.unit === target.unit)),
    ...shuffled(rest.filter((w) => w.unit !== target.unit)),
  ];
  const out: Word[] = [];
  for (const w of ordered) {
    if (out.length === 3) break;
    // 干扰项之间也不能显示成一样的字
    if (out.some((o) => o.en === w.en || display(o) === display(w))) continue;
    out.push(w);
  }
  return out.length === 3 ? out : null;
}

function mc(topic: string, prompt: string, answer: string, wrong: string[], explain: string): Question {
  const options = shuffled([answer, ...wrong]);
  return { subject: "english", topic, prompt, options, answer: options.indexOf(answer), explain };
}

const topicOf = (w: Word) => `Unit ${w.unit} 单词`;

function enToZh(): Question | null {
  const w = pick(WORDS);
  const ds = distractors(w, false);
  if (!ds) return null;
  return mc(topicOf(w), `${w.en}\n是什么意思？`, display(w), ds.map(display), `${w.en}：${w.zh}`);
}

function zhToEn(): Question | null {
  const w = pick(WORDS);
  const ds = distractors(w, true);
  if (!ds) return null;
  return mc(topicOf(w), `「${display(w)}」\n用英语怎么说？`, w.en, ds.map((d) => d.en), `${display(w)}：${w.en}`);
}

export const ENGLISH_BANK: Generator[] = [enToZh, zhToEn].map((g) => () => {
  for (let k = 0; k < 30; k++) {
    const q = g();
    if (q) return q;
  }
  throw new Error("英语题库出不了题");
});
