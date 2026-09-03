// ---------------------------------------------------------------------------
// 四年级数学题库 — 全部是「按模板现算」的生成器，不是固定题面，所以永远不会背答案。
//
// 覆盖的单元是四年级上下册各版本教材公认重合的核心内容（大数、三位数乘两位数、
// 除数是两位数的除法、四则运算与运算定律、小数的意义与加减、角、三角形、
// 面积单位、平均数），所以这一份和教材版本无关，拍照之前就能先做。
// 语文/英语要等课本，见 chinese.ts / english.ts。
// ---------------------------------------------------------------------------
import type { Generator, Question } from "./types";

const ri = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: T[]): T => arr[ri(0, arr.length - 1)];

/**
 * Build a 4-option multiple choice. Distractors are the WRONG ANSWERS A KID
 * ACTUALLY PRODUCES (off-by-one place value, forgotten carry, wrong operation
 * order) — random numbers would make the right answer guessable by shape.
 * Duplicates and any distractor equal to the answer are dropped, then padded.
 */
function mc(
  subjectTopic: string,
  prompt: string,
  answer: string,
  distractors: string[],
  explain?: string,
): Question {
  const opts = [answer];
  for (const d of distractors) {
    if (opts.length >= 4) break;
    if (d !== answer && !opts.includes(d)) opts.push(d);
  }
  // Pad defensively — a generator whose distractors all collided must still
  // return four choices rather than a half-empty panel.
  let pad = 1;
  while (opts.length < 4) {
    const n = Number(answer);
    const alt = Number.isFinite(n) ? String(n + pad * (pad % 2 ? 1 : -1) * 2) : `选项${pad}`;
    if (!opts.includes(alt)) opts.push(alt);
    pad++;
  }
  // Fisher-Yates, then find where the answer landed.
  for (let i = opts.length - 1; i > 0; i--) {
    const j = ri(0, i);
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return {
    subject: "math",
    topic: subjectTopic,
    prompt,
    options: opts,
    answer: opts.indexOf(answer),
    explain,
  };
}

// --- 三位数乘两位数 ----------------------------------------------------------
const mulThreeByTwo: Generator = () => {
  const a = ri(102, 899);
  const b = ri(12, 89);
  const ans = a * b;
  return mc(
    "三位数乘两位数",
    `${a} × ${b} = ?`,
    String(ans),
    [
      String(a * (b - 10)), // 十位漏乘
      String(ans + a), // 多加一次
      String(ans - b), // 少加一次
      String(a * (b % 10)), // 只乘了个位
    ],
    `${a} × ${b} = ${a} × ${Math.floor(b / 10) * 10} + ${a} × ${b % 10} = ${ans}`,
  );
};

// --- 除数是两位数的除法（有余数） -------------------------------------------
const divByTwoDigit: Generator = () => {
  const divisor = ri(12, 48);
  const quotient = ri(11, 60);
  const rest = ri(0, divisor - 1);
  const dividend = divisor * quotient + rest;
  const ans = rest === 0 ? String(quotient) : `${quotient} 余 ${rest}`;
  return mc(
    "除数是两位数的除法",
    `${dividend} ÷ ${divisor} = ?`,
    ans,
    [
      rest === 0 ? String(quotient + 1) : `${quotient} 余 ${rest + 1}`,
      rest === 0 ? String(quotient - 1) : `${quotient + 1} 余 ${rest}`,
      rest === 0 ? String(quotient + 10) : `${quotient - 1} 余 ${rest}`,
      String(quotient + 2),
    ],
    `${divisor} × ${quotient} = ${divisor * quotient}${rest ? `，还差 ${rest}` : ""}`,
  );
};

// --- 四则运算顺序（带括号） --------------------------------------------------
const orderOfOps: Generator = () => {
  const shape = ri(0, 2);
  if (shape === 0) {
    const a = ri(6, 40);
    const b = ri(3, 20);
    const c = ri(2, 9);
    const ans = a + b * c;
    return mc(
      "四则运算",
      `${a} + ${b} × ${c} = ?`,
      String(ans),
      [String((a + b) * c), String(a + b + c), String(a * b + c)],
      "先算乘除，后算加减",
    );
  }
  if (shape === 1) {
    const a = ri(6, 40);
    const b = ri(3, 20);
    const c = ri(2, 9);
    const ans = (a + b) * c;
    return mc(
      "四则运算",
      `(${a} + ${b}) × ${c} = ?`,
      String(ans),
      [String(a + b * c), String(a + b + c), String(a * c + b)],
      "有括号先算括号里面的",
    );
  }
  const c = ri(2, 9);
  const q = ri(3, 20);
  const b = c * q; // 保证整除
  const a = ri(20, 90);
  const d = ri(2, 12);
  const ans = a * d - q;
  return mc(
    "四则运算",
    `${a} × ${d} - ${b} ÷ ${c} = ?`,
    String(ans),
    [String((a * d - b) / c), String(a * d - b + c), String(a * (d - q))],
    `先算 ${a}×${d}=${a * d} 和 ${b}÷${c}=${q}，再相减`,
  );
};

// --- 大数的认识：改写与近似数 ------------------------------------------------
const bigNumber: Generator = () => {
  if (Math.random() < 0.5) {
    const wan = ri(3, 987);
    const n = wan * 10000;
    return mc(
      "大数的认识",
      `${n} 改写成用「万」作单位的数是多少？`,
      `${wan}万`,
      [`${wan * 10}万`, `${Math.floor(wan / 10)}万`, `${wan}亿`],
      "改写成“万”作单位，就是去掉末尾 4 个 0",
    );
  }
  const n = ri(100000, 999999);
  const wan = Math.round(n / 10000);
  return mc(
    "大数的认识",
    `${n} 省略万位后面的尾数，约是多少？`,
    `约 ${wan}万`,
    [`约 ${Math.floor(n / 10000)}万`, `约 ${Math.floor(n / 10000) + 2}万`, `约 ${wan * 10}万`],
    "看千位上的数，四舍五入",
  );
};

// --- 运算定律（简便计算） ----------------------------------------------------
const laws: Generator = () => {
  if (Math.random() < 0.5) {
    const [a, b] = pick([
      [25, 4],
      [125, 8],
      [20, 5],
      [50, 2],
    ]); // 能凑整的老搭档
    const c = ri(7, 39);
    const ans = a * b * c;
    return mc(
      "运算定律",
      `${a} × ${c} × ${b} = ?（想一想怎样算简便）`,
      String(ans),
      [String(a * b + c), String(a * c + b), String(ans / 2)],
      `先把 ${a} × ${b} = ${a * b} 凑整，再乘 ${c}`,
    );
  }
  const a = ri(12, 60);
  const b = ri(3, 9);
  const c = ri(3, 9);
  const ans = a * (b + c);
  return mc(
    "运算定律",
    `${a} × ${b} + ${a} × ${c} = ?`,
    String(ans),
    [String(a * b * c), String(a + b + c), String(a * (b * c))],
    `乘法分配律：${a} × (${b} + ${c}) = ${a} × ${b + c} = ${ans}`,
  );
};

// --- 小数的意义与加减 --------------------------------------------------------
const decimals: Generator = () => {
  const mode = ri(0, 2);
  if (mode === 0) {
    // 用「分」为单位做整数运算，避免浮点误差
    const a = ri(15, 899);
    const b = ri(15, 899);
    const sum = a + b;
    const f = (v: number) => (v / 100).toFixed(2);
    return mc(
      "小数的加法和减法",
      `${f(a)} + ${f(b)} = ?`,
      f(sum),
      [f(sum + 10), f(sum - 10), f(Math.abs(a - b))],
      "小数点对齐再相加",
    );
  }
  if (mode === 1) {
    const a = ri(200, 999);
    const b = ri(20, a - 1);
    const f = (v: number) => (v / 100).toFixed(2);
    return mc(
      "小数的加法和减法",
      `${f(a)} - ${f(b)} = ?`,
      f(a - b),
      [f(a - b + 10), f(a + b), f(a - b - 1)],
      "小数点对齐，不够减向前一位借",
    );
  }
  const base = ri(11, 89) / 10; // 一位小数，如 4.7
  const bigger = Number((base + 0.1).toFixed(1));
  return mc(
    "小数的意义和性质",
    `下面哪个数最大？`,
    String(bigger),
    [
      String(base),
      Number((base + 0.05).toFixed(2)).toFixed(2), // 位数多≠数大，四年级高频错点
      String(Number((base - 0.2).toFixed(1))),
    ],
    "先比整数部分，再依次比十分位、百分位；位数多不代表数大",
  );
};

// --- 三角形内角和 ------------------------------------------------------------
const triangle: Generator = () => {
  const a = ri(25, 100);
  const b = ri(25, 175 - a);
  const c = 180 - a - b;
  return mc(
    "三角形",
    `一个三角形，两个角分别是 ${a}° 和 ${b}°，第三个角是多少度？`,
    `${c}°`,
    [`${c + 10}°`, `${180 - a}°`, `${a + b}°`],
    "三角形的内角和是 180°",
  );
};

// --- 面积单位与换算 ----------------------------------------------------------
const areaUnits: Generator = () => {
  if (Math.random() < 0.5) {
    const n = ri(2, 40);
    return mc(
      "公顷和平方千米",
      `${n} 公顷 = 多少平方米？`,
      `${n * 10000} 平方米`,
      [`${n * 1000} 平方米`, `${n * 100} 平方米`, `${n * 100000} 平方米`],
      "1 公顷 = 10000 平方米",
    );
  }
  const n = ri(2, 30);
  return mc(
    "公顷和平方千米",
    `${n} 平方千米 = 多少公顷？`,
    `${n * 100} 公顷`,
    [`${n * 10} 公顷`, `${n * 1000} 公顷`, `${n * 10000} 公顷`],
    "1 平方千米 = 100 公顷",
  );
};

// --- 平均数 ------------------------------------------------------------------
const average: Generator = () => {
  const n = ri(3, 5);
  const mean = ri(12, 96);
  const nums: number[] = [];
  let rest = mean * n;
  for (let i = 0; i < n - 1; i++) {
    const v = Math.max(1, mean + ri(-9, 9));
    nums.push(v);
    rest -= v;
  }
  if (rest < 1) return average(); // 极少数情况凑不出正数，重来
  nums.push(rest);
  return mc(
    "平均数",
    `${nums.join("、")} 这 ${n} 个数的平均数是多少？`,
    String(mean),
    [String(mean + 1), String(nums.reduce((s, v) => s + v, 0)), String(mean - 2)],
    `总和 ${mean * n} ÷ ${n} = ${mean}`,
  );
};

// --- 角的度量 ----------------------------------------------------------------
const angles: Generator = () => {
  const deg = pick([ri(1, 89), 90, ri(91, 179), 180]);
  const name = deg < 90 ? "锐角" : deg === 90 ? "直角" : deg < 180 ? "钝角" : "平角";
  return mc(
    "角的度量",
    `${deg}° 的角是什么角？`,
    name,
    ["锐角", "直角", "钝角", "平角"].filter((n) => n !== name),
    "小于 90° 是锐角，等于 90° 是直角，90°~180° 之间是钝角，180° 是平角",
  );
};

export const MATH_BANK: Generator[] = [
  mulThreeByTwo,
  divByTwoDigit,
  orderOfOps,
  orderOfOps, // 四则运算权重加倍：这是四年级最容易错、也最该练的一块
  bigNumber,
  laws,
  decimals,
  triangle,
  areaUnits,
  average,
  angles,
];
