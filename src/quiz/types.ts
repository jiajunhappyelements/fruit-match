// ---------------------------------------------------------------------------
// 答题代替看广告 — question model.
//
// 原版的解锁 / 消除 / 打乱都要看广告，我们换成当场连答几题（答对够数才生效）。
// 早先的规矩是「题目只在结算页出、局内花钥匙」，后来用户决定照原版来，作废了。
// ---------------------------------------------------------------------------

export type Subject = "math" | "chinese" | "english";

export interface Question {
  subject: Subject;
  topic: string; // 教材单元名，答错时显示，方便家长知道该复习哪一块
  prompt: string;
  options: string[]; // always 4, already shuffled
  answer: number; // index into options
  explain?: string; // shown after a wrong answer
  lesson?: number; // 语文：出自第几课（自检核对题目来源用）
}

/** A bank is a list of generators so questions never repeat verbatim. */
export type Generator = () => Question;
