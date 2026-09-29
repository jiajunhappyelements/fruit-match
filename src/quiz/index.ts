// ---------------------------------------------------------------------------
// 钥匙钱包 + 出题入口。
//
// 钥匙是「解锁底部空位」的唯一代价（原版是看广告，我们换成做题）。
// 挣钥匙只发生在**平静时刻**（过关/失败结算页），花钥匙发生在**危急时刻**
// （篮子快满了点砖解锁）—— 反过来做就是把学习变成路障，孩子会恨做题。
// ---------------------------------------------------------------------------
import type { Generator, Question, Subject } from "./types";
import { MATH_BANK } from "./math";
import { CHINESE_BANK } from "./chinese";
import { ENGLISH_BANK } from "./english";
import { topicStats, topicWeight } from "./history";

export type { Question, Subject } from "./types";
export { recordAnswer, loadHistory, topicStats, HISTORY_KEY } from "./history";

const BANKS: Record<Subject, Generator[]> = {
  math: MATH_BANK,
  chinese: CHINESE_BANK,
  english: ENGLISH_BANK,
};

/** 目前哪些科目真的有题（空题库自动跳过，所以语文/英语填上就自动生效）。 */
export function availableSubjects(): Subject[] {
  return (Object.keys(BANKS) as Subject[]).filter((s) => BANKS[s].length > 0);
}

/**
 * 抽一道题：错得多的题型多出，并且尽量不和上一道同一个知识点。
 *
 * 做法是先生成一批候选，再按题型权重挑一道。不能提前按生成器加权——
 * 生成器是现算的，同一个生成器可能产出不同题型（小数那个既出加减也出比大小），
 * 只有生成出来才知道它是哪一类。
 */
export function nextQuestion(avoidTopic?: string): Question | null {
  const subjects = availableSubjects();
  if (subjects.length === 0) return null;
  const stats = topicStats();

  const candidates: Question[] = [];
  for (let i = 0; i < 12; i++) {
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const bank = BANKS[subject];
    const q = bank[Math.floor(Math.random() * bank.length)]();
    if (q.topic !== avoidTopic) candidates.push(q);
  }
  // 极端情况（只剩一个题型）就不避了，总得出一道
  if (candidates.length === 0) {
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const bank = BANKS[subject];
    return bank[Math.floor(Math.random() * bank.length)]();
  }

  const weights = candidates.map((q) => topicWeight(q.topic, stats));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// --- 钥匙钱包 ---------------------------------------------------------------
export const KEY_STORAGE_KEY = "fruit-match.keys";

export function loadKeys(): number {
  const n = Number(localStorage.getItem(KEY_STORAGE_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function saveKeys(n: number): void {
  localStorage.setItem(KEY_STORAGE_KEY, String(Math.max(0, Math.floor(n))));
}
