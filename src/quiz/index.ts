// ---------------------------------------------------------------------------
// 出题入口。原版的道具（解锁 / 消除 / 打乱）要看广告，我们换成当场连答几题，
// 见 GameScene.withQuiz。
// ---------------------------------------------------------------------------
import type { Generator, Question, Subject } from "./types";
import { MATH_BANK } from "./math";
import { CHINESE_BANK } from "./chinese";
import { ENGLISH_BANK } from "./english";
import { topicStats, topicWeight } from "./history";

export type { Question, Subject } from "./types";
export { recordAnswer, loadHistory, topicStats, HISTORY_KEY } from "./history";
// 自检脚本用
export { CHINESE_BANK, pinyinDistractors, hasSingleReading, PATTERNS } from "./chinese";
export { SHIZI, POEMS, CLASSICAL, OTHER_READINGS } from "./chinese-data";

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
