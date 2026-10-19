// ---------------------------------------------------------------------------
// 出题入口。原版的道具（解锁 / 消除 / 打乱）要看广告，我们换成当场连答几题，
// 见 GameScene.withQuiz。
// ---------------------------------------------------------------------------
import type { Generator, Question, Subject } from "./types";
import { MATH_BANK } from "./math";
import { CHINESE_BANK } from "./chinese";
import { ENGLISH_BANK } from "./english";
import { loadHistory, topicStats, topicWeight } from "./history";

export type { Question, Subject } from "./types";
export { recordAnswer, loadHistory, topicStats, HISTORY_KEY } from "./history";
// 自检脚本用
export { CHINESE_BANK, pinyinDistractors, hasSingleReading, PATTERNS } from "./chinese";
export { SHIZI, POEMS, CLASSICAL, OTHER_READINGS, CIYU, CIYU_PINYIN, ALT_IDIOMS } from "./chinese-data";
// 下面这些只给题库自检（scripts/check-quiz.mjs）用
export { ENGLISH_BANK } from "./english";
export { WORDS, CONFUSABLE } from "./english-data";
export { MATH_BANK, SHAPE_FACTS } from "./math";

const BANKS: Record<Subject, Generator[]> = {
  math: MATH_BANK,
  chinese: CHINESE_BANK,
  english: ENGLISH_BANK,
};

/** 目前哪些科目真的有题（空题库自动跳过，所以语文/英语填上就自动生效）。 */
export function availableSubjects(): Subject[] {
  return (Object.keys(BANKS) as Subject[]).filter((s) => BANKS[s].length > 0);
}

// 最近出过的题面不再出，同一道题至少隔开这么多道。
// 语文的小题型（诗人朝代 12 道、词语结构 13 道）分到的比例和生字读音（225 道）
// 差不多，不拦着的话同一道题几十道就转回来一次，错得多再加权就更勤
// （2026-10 家长反馈「选 ABB 的词语」老出）。按题面算、不按答案：「哪个词语是
// ABB 式的」换个答案，孩子看着还是同一道。
const RECENT_PROMPTS = 100;
// 答题记录只记答过的、调试跳关还不记，所以本次运行出过的题单独再记一份
const askedThisRun: string[] = [];

function recentPrompts(): Set<string> {
  const answered = loadHistory().slice(-RECENT_PROMPTS).map((r) => r.prompt);
  return new Set([...answered, ...askedThisRun.slice(-RECENT_PROMPTS)]);
}

/**
 * 抽一道题：错得多的题型多出，并且尽量不和上一道同一个知识点、不出最近出过的题。
 *
 * 做法是先生成一批候选，再按题型权重挑一道。不能提前按生成器加权——
 * 生成器是现算的，同一个生成器可能产出不同题型（小数那个既出加减也出比大小），
 * 只有生成出来才知道它是哪一类。
 */
export function nextQuestion(avoidTopic?: string): Question | null {
  const subjects = availableSubjects();
  if (subjects.length === 0) return null;
  const stats = topicStats();
  const recent = recentPrompts();
  const draw = (): Question => {
    const subject = subjects[Math.floor(Math.random() * subjects.length)];
    const bank = BANKS[subject];
    return bank[Math.floor(Math.random() * bank.length)]();
  };

  // 凑 12 道候选；被「最近出过」拦掉的多抽几次补上
  const candidates: Question[] = [];
  for (let i = 0; i < 40 && candidates.length < 12; i++) {
    const q = draw();
    if (q.topic !== avoidTopic && !recent.has(q.prompt)) candidates.push(q);
  }
  // 极端情况（题都出过一遍了）就不避了，总得出一道
  if (candidates.length === 0) candidates.push(draw());

  const weights = candidates.map((q) => topicWeight(q.topic, stats));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  let chosen = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      chosen = candidates[i];
      break;
    }
  }
  askedThisRun.push(chosen.prompt);
  if (askedThisRun.length > RECENT_PROMPTS * 2) askedThisRun.splice(0, RECENT_PROMPTS);
  return chosen;
}
