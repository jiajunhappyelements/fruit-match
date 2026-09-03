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

export type { Question, Subject } from "./types";

const BANKS: Record<Subject, Generator[]> = {
  math: MATH_BANK,
  chinese: CHINESE_BANK,
  english: ENGLISH_BANK,
};

/** 目前哪些科目真的有题（空题库自动跳过，所以语文/英语填上就自动生效）。 */
export function availableSubjects(): Subject[] {
  return (Object.keys(BANKS) as Subject[]).filter((s) => BANKS[s].length > 0);
}

/** 抽一道题；尽量不和上一道同一个知识点，免得连着考同一块。 */
export function nextQuestion(avoidTopic?: string): Question | null {
  const subjects = availableSubjects();
  if (subjects.length === 0) return null;
  let q: Question | null = null;
  for (let i = 0; i < 6; i++) {
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const bank = BANKS[subject];
    q = bank[Math.floor(Math.random() * bank.length)]();
    if (q.topic !== avoidTopic) return q;
  }
  return q;
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
