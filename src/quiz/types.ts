// ---------------------------------------------------------------------------
// 答题换钥匙 — question model.
//
// Design rule (agreed with the user): questions NEVER appear at the moment the
// player needs a slot. Making the kid answer while the basket is about to
// overflow turns learning into a toll gate and poisons both. Keys are earned in
// CALM moments (the win / lose screen) and spent instantly during play.
// ---------------------------------------------------------------------------

export type Subject = "math" | "chinese" | "english";

export interface Question {
  subject: Subject;
  topic: string; // 教材单元名，答错时显示，方便家长知道该复习哪一块
  prompt: string;
  options: string[]; // always 4, already shuffled
  answer: number; // index into options
  explain?: string; // shown after a wrong answer
}

/** A bank is a list of generators so questions never repeat verbatim. */
export type Generator = () => Question;
