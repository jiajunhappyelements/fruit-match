// ---------------------------------------------------------------------------
// 四年级上册数学题库 —— 对齐课本目录（用户 2026-10 拍来的四上目录）：
//   一 万以上数的认识   二 角的度量   三 多位数乘两位数
//   四 加法模型和乘法模型   五 平行四边形和梯形   六 条形统计图（要看图，没出）
// 题型名就用单元名，家长看板上显示的和课本对得上。
//
// 计算题都是「按模板现算」，不会背答案；平行四边形和梯形是概念题，题面手写。
// 整册都出、不按进度筛，和语文英语一个规矩。
//
// 早先没看课本时按「四年级通用」做过 11 类，其中 7 类这本书里没有（除数是两位数的
// 除法、四则运算、运算定律、小数、三角形、公顷和平方千米、平均数），对齐时删掉了。
// 四下拍了目录再按需要拿回来——在 git 历史里（commit ffb08a4 及以前）。
// ---------------------------------------------------------------------------
import type { Generator, Question } from "./types";

const ri = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pick = <T>(arr: T[]): T => arr[ri(0, arr.length - 1)];

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = ri(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const T1 = "万以上数的认识";
const T2 = "角的度量";
const T3 = "多位数乘两位数";
const T4 = "加法模型和乘法模型";
const T5 = "平行四边形和梯形";

/**
 * 四选一。干扰项要用孩子**真会犯的错**（漏乘十位、四舍五入方向反、用错运算），
 * 随机数当干扰项，正确答案凭「长相」就能猜出来。
 * 重复的、和答案相同的干扰项会被丢掉，不够 4 个再补。
 */
function mc(topic: string, prompt: string, answer: string, distractors: string[], explain?: string): Question {
  const opts = [answer];
  for (const d of distractors) {
    if (opts.length >= 4) break;
    if (d !== answer && !opts.includes(d)) opts.push(d);
  }
  // 补位：把答案里的数字改一改，前后缀（「约」「万」「元」）照留。
  // 以前这里遇到带文字的答案会退成字面上的「选项1」——线上一半的「省略万位」题都带着它。
  const m = answer.match(/\d+/);
  for (let pad = 1; opts.length < 4 && m && pad < 60; pad++) {
    const v = Number(m[0]) + (pad % 2 ? 1 : -1) * Math.ceil(pad / 2) * 2;
    if (v <= 0) continue;
    const alt = answer.replace(m[0], String(v));
    if (!opts.includes(alt)) opts.push(alt);
  }
  if (opts.length < 4) throw new Error(`凑不够 4 个选项：${prompt}`);
  const options = shuffled(opts);
  return { subject: "math", topic, prompt, options, answer: options.indexOf(answer), explain };
}

// ===========================================================================
// 一 万以上数的认识
// ===========================================================================

const bigNumberWan: Generator = () => {
  if (Math.random() < 0.5) {
    const wan = ri(12, 987);
    return mc(
      T1,
      `${wan * 10000} 改写成用「万」作单位的数是多少？`,
      `${wan}万`,
      [`${wan * 10}万`, `${Math.floor(wan / 10)}万`, `${wan}亿`],
      "改写成用“万”作单位，就是去掉末尾 4 个 0，再添上“万”字",
    );
  }
  const n = ri(100000, 999999);
  const lo = Math.floor(n / 10000);
  const wan = Math.round(n / 10000);
  const qian = Math.floor(n / 1000) % 10;
  return mc(
    T1,
    `${n} 省略万位后面的尾数，约是多少？`,
    `约 ${wan}万`,
    [
      `约 ${wan === lo ? lo + 1 : lo}万`, // 四舍五入方向弄反
      `约 ${Math.floor(n / 1000)}万`, // 多留了一位
      `约 ${wan * 10}万`,
    ],
    `看千位上的数是 ${qian}，${qian >= 5 ? "满 5 要向万位进 1" : "不满 5 直接舍去"}`,
  );
};

const bigNumberYi: Generator = () => {
  if (Math.random() < 0.5) {
    const yi = ri(2, 99);
    return mc(
      T1,
      `${yi * 100000000} 改写成用「亿」作单位的数是多少？`,
      `${yi}亿`,
      [`${yi * 10}亿`, `${yi * 100}亿`, `${yi}万`],
      "改写成用“亿”作单位，就是去掉末尾 8 个 0，再添上“亿”字",
    );
  }
  const n = ri(100000000, 9999999999);
  const lo = Math.floor(n / 1e8);
  const yi = Math.round(n / 1e8);
  const qianwan = Math.floor(n / 1e7) % 10;
  return mc(
    T1,
    `${n} 省略亿位后面的尾数，约是多少？`,
    `约 ${yi}亿`,
    [`约 ${yi === lo ? lo + 1 : lo}亿`, `约 ${Math.floor(n / 1e7)}亿`, `约 ${yi * 10}亿`],
    `看千万位上的数是 ${qianwan}，${qianwan >= 5 ? "满 5 要向亿位进 1" : "不满 5 直接舍去"}`,
  );
};

/**
 * 比大小。陷阱有两个：位数多的才大（9 开头的八位数比 1 开头的九位数小）；
 * 位数相同的，从最高位一位一位比（几个数开头一样，差别藏在后面）。
 */
const compareBig: Generator = () => {
  for (;;) {
    const digits = ri(7, 9);
    const base = ri(10 ** (digits - 1), 10 ** digits - 1);
    const s = String(base);
    // 位数一样、最高位也一样，只在后面某一位不同
    const k = ri(1, digits - 2);
    if (s[k] === s[k + 1]) continue;
    const swapped = Number(s.slice(0, k) + s[k + 1] + s[k] + s.slice(k + 2));
    const j = ri(1, digits - 1);
    const dj = Number(s[j]);
    const nudged = Number(s.slice(0, j) + String(dj === 9 ? 8 : dj + 1) + s.slice(j + 1));
    // 少一位、但开头是 9 的数：看着大，其实最小
    const shorter = ri(9 * 10 ** (digits - 2), 10 ** (digits - 1) - 1);
    const nums = [base, swapped, nudged, shorter];
    if (new Set(nums).size < 4) continue;
    const max = Math.max(...nums);
    return mc(
      T1,
      "下面哪个数最大？",
      String(max),
      nums.filter((n) => n !== max).map(String),
      "先比位数，位数多的数大；位数相同，从最高位起一位一位地比",
    );
  }
};

// ===========================================================================
// 二 角的度量
// ===========================================================================

const angleName = (deg: number) =>
  deg < 90 ? "锐角" : deg === 90 ? "直角" : deg < 180 ? "钝角" : deg === 180 ? "平角" : "周角";

const angles: Generator = () => {
  const deg = pick([ri(1, 89), 90, ri(91, 179), 180, 360]);
  const name = angleName(deg);
  return mc(
    T2,
    `${deg}° 的角是什么角？`,
    name,
    shuffled(["锐角", "直角", "钝角", "平角", "周角"].filter((n) => n !== name)),
    "小于 90° 是锐角，90° 是直角，大于 90° 小于 180° 是钝角，180° 是平角，360° 是周角",
  );
};

const clockAngle: Generator = () => {
  const h = ri(1, 11);
  const gaps = Math.min(h, 12 - h);
  const deg = gaps * 30;
  const name = angleName(deg);
  return mc(
    T2,
    `钟面上 ${h} 时整，时针和分针成什么角？`,
    name,
    shuffled(["锐角", "直角", "钝角", "平角"].filter((n) => n !== name)),
    `${h} 时整，两根针之间隔 ${gaps} 个大格，一大格是 30°，所以是 ${deg}°`,
  );
};

const ANGLE_DEG: Record<string, number> = { 直角: 90, 平角: 180, 周角: 360 };

const angleRelations: Generator = () => {
  if (Math.random() < 0.5) {
    const [big, small] = pick([
      ["周角", "平角"],
      ["周角", "直角"],
      ["平角", "直角"],
    ]);
    const k = ANGLE_DEG[big] / ANGLE_DEG[small];
    return mc(
      T2,
      `1 个${big}等于几个${small}？`,
      `${k} 个`,
      ["1 个", "2 个", "3 个", "4 个"].filter((o) => o !== `${k} 个`),
      `${big}是 ${ANGLE_DEG[big]}°，${small}是 ${ANGLE_DEG[small]}°，${ANGLE_DEG[big]} ÷ ${ANGLE_DEG[small]} = ${k}`,
    );
  }
  const name = pick(["直角", "平角", "周角"]);
  const deg = ANGLE_DEG[name];
  return mc(
    T2,
    `1 个${name}是多少度？`,
    `${deg}°`,
    ["90°", "180°", "270°", "360°"].filter((o) => o !== `${deg}°`),
    "直角 90°，平角 180°，周角 360°",
  );
};

// ===========================================================================
// 三 多位数乘两位数
// ===========================================================================

const mulThreeByTwo: Generator = () => {
  const a = ri(102, 899);
  const b = ri(12, 89);
  const ans = a * b;
  return mc(
    T3,
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

/** 口算：整十数 × 整十数（30 × 40）、两位数 × 整十数（25 × 40）。 */
const mentalMul: Generator = () => {
  const both = Math.random() < 0.5;
  const a = both ? ri(2, 9) * 10 : ri(11, 49);
  const b = ri(2, 9) * 10;
  const ans = a * b;
  const a0 = both ? a / 10 : a;
  const zeros = both ? 2 : 1;
  return mc(
    T3,
    `${a} × ${b} = ?`,
    String(ans),
    [String(ans / 10), String(ans * 10), String(a + b)], // 少写 0 / 多写 0 / 做成了加法
    `先算 ${a0} × ${b / 10} = ${a0 * (b / 10)}，因数末尾一共有 ${zeros} 个 0，积的末尾就添 ${zeros} 个 0`,
  );
};

/** 笔算：因数末尾有 0（340 × 25）、中间有 0（205 × 36）。 */
const mulWithZero: Generator = () => {
  if (Math.random() < 0.5) {
    const a = ri(11, 99) * 10;
    const b = ri(12, 49);
    const ans = a * b;
    return mc(
      T3,
      `${a} × ${b} = ?`,
      String(ans),
      [String(ans / 10), String(ans * 10), String(ans - 100)],
      `先算 ${a / 10} × ${b} = ${(a / 10) * b}，再在末尾添 1 个 0`,
    );
  }
  const h = ri(1, 9);
  const u = ri(1, 9);
  const a = h * 100 + u; // 中间是 0，比如 205
  const b = ri(12, 89);
  const ans = a * b;
  return mc(
    T3,
    `${a} × ${b} = ?`,
    String(ans),
    [String((h * 10 + u) * b), String(ans + 10), String(ans - 10)], // 把 205 当成 25 算
    `${a} × ${b} = ${a} × ${Math.floor(b / 10) * 10} + ${a} × ${b % 10} = ${ans}，中间的 0 占着十位，别丢了`,
  );
};

// ===========================================================================
// 四 加法模型和乘法模型
// ===========================================================================

// [量词, 东西, 单价下限, 单价上限]
const GOODS: [string, string, number, number][] = [
  ["支", "铅笔", 2, 9],
  ["本", "笔记本", 3, 15],
  ["个", "足球", 35, 95],
  ["盒", "彩笔", 15, 45],
  ["件", "T恤", 25, 89],
  ["袋", "大米", 30, 85],
];

const priceModel: Generator = () => {
  const [u, item, lo, hi] = pick(GOODS);
  if (Math.random() < 0.5) {
    const p = ri(lo, hi);
    const n = ri(12, 48);
    const ans = p * n;
    return mc(
      T4,
      `每${u}${item} ${p} 元，买 ${n} ${u}要多少元？`,
      `${ans} 元`,
      [`${p + n} 元`, `${ans + 10} 元`, `${ans - 10} 元`],
      `单价 × 数量 = 总价：${p} × ${n} = ${ans}（元）`,
    );
  }
  // 反过来求单价：只挑本来就贵一点的东西，不然会出「每支铅笔 25 元」
  const [u2, item2, lo2, hi2] = pick(GOODS.filter((g) => g[3] >= 15));
  const p = ri(Math.max(lo2, 12), hi2);
  const n = ri(2, 9);
  const t = p * n;
  return mc(
    T4,
    `买 ${n} ${u2}${item2}一共用了 ${t} 元，每${u2}多少元？`,
    `${p} 元`,
    [`${p + 1} 元`, `${p - 1} 元`, `${t - n} 元`],
    `总价 ÷ 数量 = 单价：${t} ÷ ${n} = ${p}（元）`,
  );
};

// [谁, 动词, 速度下限, 速度上限, 路程单位, 时间单位, 时间下限, 时间上限]
const MOVERS: [string, string, number, number, string, string, number, number][] = [
  ["汽车", "行", 45, 95, "千米", "小时", 2, 9],
  ["火车", "行", 120, 280, "千米", "小时", 2, 9],
  ["自行车", "行", 12, 19, "千米", "小时", 2, 9],
  ["小明", "走", 55, 85, "米", "分钟", 12, 25],
];

const speedModel: Generator = () => {
  const [who, verb, vlo, vhi, dist, time, tlo, thi] = pick(MOVERS);
  if (Math.random() < 0.5) {
    const v = ri(vlo, vhi);
    const t = ri(tlo, thi);
    const ans = v * t;
    return mc(
      T4,
      `${who}每${time}${verb} ${v} ${dist}，${t} ${time}${verb}多少${dist}？`,
      `${ans} ${dist}`,
      [`${v + t} ${dist}`, `${ans + 10} ${dist}`, `${ans - 10} ${dist}`],
      `速度 × 时间 = 路程：${v} × ${t} = ${ans}（${dist}）`,
    );
  }
  const v = ri(vlo, vhi);
  const t = ri(2, 9); // 反过来求速度要做除法，除数只用一位数（三年级学过的）
  const s = v * t;
  return mc(
    T4,
    `${who} ${t} ${time}${verb}了 ${s} ${dist}，平均每${time}${verb}多少${dist}？`,
    `${v} ${dist}`,
    [`${v + 1} ${dist}`, `${v - 1} ${dist}`, `${s - t} ${dist}`],
    `路程 ÷ 时间 = 速度：${s} ÷ ${t} = ${v}（${dist}）`,
  );
};

// [甲, 乙, 量词]
const KINDS: [string, string, string][] = [
  ["故事书", "科技书", "本"],
  ["红花", "黄花", "朵"],
  ["苹果树", "梨树", "棵"],
  ["男生", "女生", "人"],
];

const additionModel: Generator = () => {
  const [A, B, u] = pick(KINDS);
  const kind = ri(0, 2);
  if (kind === 0) {
    const a = ri(105, 489);
    let b = ri(105, 489);
    if (b === a) b += 11;
    const ans = a + b;
    return mc(
      T4,
      `${A}有 ${a} ${u}，${B}有 ${b} ${u}，一共有多少${u}？`,
      `${ans} ${u}`,
      [`${ans - 10} ${u}`, `${ans + 10} ${u}`, `${Math.abs(a - b)} ${u}`],
      `部分 + 部分 = 总数：${a} + ${b} = ${ans}（${u}）`,
    );
  }
  if (kind === 1) {
    const a = ri(105, 489);
    const b = ri(105, 489);
    const t = a + b;
    return mc(
      T4,
      `${A}和${B}一共有 ${t} ${u}，其中${A} ${a} ${u}，${B}有多少${u}？`,
      `${b} ${u}`,
      [`${b + 10} ${u}`, `${b - 10} ${u}`, `${t + a} ${u}`],
      `总数 − 部分 = 另一部分：${t} − ${a} = ${b}（${u}）`,
    );
  }
  const a = ri(105, 489);
  const d = ri(25, Math.min(189, a - 10));
  const ans = a + d;
  return mc(
    T4,
    `${A}有 ${a} ${u}，${B}比${A}多 ${d} ${u}，${B}有多少${u}？`,
    `${ans} ${u}`,
    [`${a - d} ${u}`, `${ans + 10} ${u}`, `${ans - 10} ${u}`], // 「多」看成「少」
    `求比一个数多几的数，用加法：${a} + ${d} = ${ans}（${u}）`,
  );
};

/** 数量关系式。三个错的都是真的错——「总价 ÷ 数量 = 单价」也对，所以不能当干扰项。 */
const relationFact: Generator = () => {
  const [names, right, wrongs] = pick<[string, string, string[]]>([
    ["单价、数量和总价", "单价 × 数量 = 总价", ["单价 + 数量 = 总价", "总价 × 数量 = 单价", "单价 ÷ 数量 = 总价"]],
    ["速度、时间和路程", "速度 × 时间 = 路程", ["速度 + 时间 = 路程", "路程 × 时间 = 速度", "速度 ÷ 时间 = 路程"]],
  ]);
  return mc(T4, `${names}之间是什么关系？`, right, wrongs, right);
};

// ===========================================================================
// 五 平行四边形和梯形（概念题）
// ===========================================================================

// [题面, 答案, 干扰项]。每条都核过：干扰项是真实存在的图形 / 说法，但放在这里是错的。
export const SHAPE_FACTS: [string, string, string[]][] = [
  ["在同一平面内，不相交的两条直线叫做什么？", "平行线", ["垂线", "射线", "线段"]],
  ["两条直线相交成直角，就说这两条直线互相怎样？", "垂直", ["平行", "交叉", "重合"]],
  ["平行四边形有几组对边分别平行？", "2 组", ["1 组", "3 组", "4 组"]],
  ["梯形有几组对边平行？", "只有 1 组", ["2 组", "没有", "4 组"]],
  ["梯形中，互相平行的一组对边叫做什么？", "底", ["腰", "高", "对角线"]],
  ["梯形中，不平行的一组对边叫做什么？", "腰", ["底", "高", "对角线"]],
  ["两腰相等的梯形叫做什么？", "等腰梯形", ["直角梯形", "平行四边形", "长方形"]],
  ["有一个角是直角的梯形叫做什么？", "直角梯形", ["等腰梯形", "平行四边形", "正方形"]],
  ["从直线外一点到这条直线所画的线段中，哪条最短？", "垂直线段", ["成锐角的线段", "成钝角的线段", "一样长"]],
  ["两条平行线之间的垂直线段，长度怎样？", "都相等", ["越来越长", "越来越短", "不一定"]],
  ["长方形是一种特殊的什么图形？", "平行四边形", ["梯形", "三角形", "圆"]],
  ["平行四边形容易变形，这是它的什么特性？", "不稳定性", ["稳定性", "对称性", "平行性"]],
];

const shapeFact: Generator = () => {
  const [q, a, wrong] = pick(SHAPE_FACTS);
  return mc(T5, q, a, wrong, `答案：${a}`);
};

// ===========================================================================
// 出题入口：每个单元大致一样多（第四单元题型最多，多一份）
// ===========================================================================
export const MATH_BANK: Generator[] = [
  bigNumberWan, bigNumberYi, compareBig, // 一 万以上数的认识
  angles, clockAngle, angleRelations, // 二 角的度量
  mulThreeByTwo, mentalMul, mulWithZero, // 三 多位数乘两位数
  priceModel, speedModel, additionModel, relationFact, // 四 加法模型和乘法模型
  shapeFact, shapeFact, // 五 平行四边形和梯形（概念题只有十几条，×2 免得太重复）
  // 六 条形统计图：要看图，四选一的框里放不下，没出
];
