// ---------------------------------------------------------------------------
// 答题记录。
//
// 两个用途：
// 1. 抽题时，错得多的题型多出（当初说好的「答错的题过一阵再出」）。
// 2. 家长看板（?parent=1）：哪类题总错、具体错成了什么样。
//
// 数学题是现算的，同一道题不会原样再出，所以按「题型」加权，练的是那一类
// 算法，而不是背某道题的答案。以后语文这种固定题库也照样按题型走。
// ---------------------------------------------------------------------------
import type { Subject } from "./types";

export interface AnswerRecord {
  t: number; // 作答时间（ms）
  subject: Subject;
  topic: string;
  prompt: string;
  picked: string; // 孩子选的
  answer: string; // 正确答案
  ok: boolean;
}

export const HISTORY_KEY = "fruit-match.quiz-history";
// 一次结算最多 3 题，600 条够攒好几个月；JSON 不到 100KB。
const MAX_RECORDS = 600;
// 看最近几次来判断「现在」会不会。早先错、后来一直对的题型，应该放它过去。
const RECENT_WINDOW = 8;

export function loadHistory(): AnswerRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.topic === "string") : [];
  } catch {
    return []; // 存档坏了就当没有，绝不能因为记录挂掉让游戏白屏
  }
}

export function recordAnswer(r: AnswerRecord): void {
  try {
    const hist = loadHistory();
    hist.push(r);
    if (hist.length > MAX_RECORDS) hist.splice(0, hist.length - MAX_RECORDS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
  } catch {
    // 存储满了/被禁用：少记一条而已，不影响答题
  }
}

export interface TopicStat {
  subject: Subject;
  topic: string;
  n: number; // 总共答过几次
  ok: number; // 答对几次
  recentN: number;
  recentOk: number;
  lastAt: number;
  lastWrong?: AnswerRecord;
}

export function topicStats(hist: AnswerRecord[] = loadHistory()): Map<string, TopicStat> {
  const map = new Map<string, TopicStat>();
  for (const r of hist) {
    let s = map.get(r.topic);
    if (!s) {
      s = { subject: r.subject, topic: r.topic, n: 0, ok: 0, recentN: 0, recentOk: 0, lastAt: 0 };
      map.set(r.topic, s);
    }
    s.n++;
    if (r.ok) s.ok++;
    else s.lastWrong = r;
    s.lastAt = Math.max(s.lastAt, r.t);
  }
  // 「最近」按每个题型自己的最后几次算，不按全局时间
  const byTopic = new Map<string, AnswerRecord[]>();
  for (const r of hist) {
    const arr = byTopic.get(r.topic) ?? [];
    arr.push(r);
    byTopic.set(r.topic, arr);
  }
  for (const [topic, arr] of byTopic) {
    const recent = arr.slice(-RECENT_WINDOW);
    const s = map.get(topic)!;
    s.recentN = recent.length;
    s.recentOk = recent.filter((r) => r.ok).length;
  }
  return map;
}

/**
 * 抽题权重。最近错得越多越常出：全对 = 1，全错 = 4。
 * 没做过的题型给 1.5，保证新题型也能被轮到，不会被错题挤得永远见不着。
 */
export function topicWeight(topic: string, stats: Map<string, TopicStat>): number {
  const s = stats.get(topic);
  if (!s || s.recentN === 0) return 1.5;
  const wrongRate = 1 - s.recentOk / s.recentN;
  return 1 + 3 * wrongRate;
}
