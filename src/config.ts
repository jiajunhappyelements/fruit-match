// ---------------------------------------------------------------------------
// Global tunables. Everything gameplay-related lives here so it is easy to
// tweak the "feel" without hunting through the scene code.
// ---------------------------------------------------------------------------

// Design resolution (portrait). The Scale Manager fits this into any phone.
export const WIDTH = 720;
export const HEIGHT = 1280;

export const FRUIT_RADIUS = 34;

// Matter collision categories. Values must be distinct powers of two.
export const CAT_WALL = 0x0001; // ground / well walls
export const CAT_PINNED = 0x0002; // fruits still stuck in the sky
export const CAT_ACTIVE = 0x0004; // fruits that have been released
export const CAT_STUMP = 0x0008; // side stumps（单独一类，释放时嵌在木桩里的水果要能先穿过去）

// The playable produce set. Each key maps to public/assets/<pack>/<key>.png.
// ORDER IS THE DIFFICULTY CURVE: levelConfig unlocks one more type every two
// levels from the front of this list — the 12 fruits carry the early journey,
// vegetables start appearing around level 21 as fresh "new content" surprises.
export interface FruitType {
  key: string;
  pack: "fruits" | "produce";
}

export const FRUIT_TYPES: FruitType[] = [
  { key: "watermelon", pack: "fruits" },
  { key: "strawberry", pack: "fruits" },
  { key: "banana", pack: "fruits" },
  { key: "blueberry", pack: "fruits" },
  { key: "lemon", pack: "fruits" },
  { key: "grape", pack: "fruits" },
  { key: "peach", pack: "fruits" },
  { key: "apple", pack: "fruits" },
  { key: "kiwi", pack: "fruits" },
  { key: "orange", pack: "fruits" },
  { key: "pineapple", pack: "fruits" },
  { key: "cherry", pack: "fruits" },
  { key: "mango", pack: "produce" },
  { key: "pear", pack: "produce" },
  { key: "tomato", pack: "produce" },
  { key: "carrot", pack: "produce" },
  { key: "pumpkin", pack: "produce" },
  { key: "corn", pack: "produce" },
  { key: "dragonfruit", pack: "produce" },
  { key: "pomegranate", pack: "produce" },
  { key: "coconut", pack: "produce" },
  { key: "avocado", pack: "produce" },
  { key: "cucumber", pack: "produce" },
  { key: "eggplant", pack: "produce" },
  { key: "onion", pack: "produce" },
  { key: "mushroom", pack: "produce" },
  { key: "bell-pepper", pack: "produce" },
  { key: "broccoli", pack: "produce" },
];

// --- Level progression -------------------------------------------------------
// Difficulty climbs by adding fruit VARIETY (more types = harder to pair) and
// volume. Level 1: 3 types / 34 fruits — gentle for a kid. Count caps at L22,
// variety at L51, both well inside the ~141-level journey (see levels.ts).
export function levelConfig(level: number): {
  typeCount: number;
  fruitCount: number;
} {
  // 兜底：任何非整数都会让下面的 fruitCount 变成小数，而 buildTypePool 里
  // `pool.length = fruitCount` 遇到小数直接抛 RangeError → 白屏。存档被写坏
  // （手改、或将来某个 bug）就会走到这里，所以在源头把它按整数处理。
  level = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  // Variety ramps over the first ~60 levels (roughly the first two thirds of
  // the journey) rather than 26, so the long trip keeps introducing something.
  // +1 type every 2 levels after a gentle 3-type start.
  const typeCount = Math.min(3 + Math.floor((level - 1) / 2), FRUIT_TYPES.length);
  // Big pools like the original game ("剩余 172"): 整堆开局就全部摆好，只有一屏
  // 在可见区域内，其余堆在屏幕上方，随着整体下移滑进画面。
  // 蜂窝排布一屏要 ~110 颗才铺满，所以第 1 关就从 120 起步（原版第 2 关 174），
  // 开局就是满屏水果；之后每关 +2，第 21 关到 160 封顶。难度靠种类，不靠数量。
  const raw = Math.min(118 + level * 2, 160);
  const fruitCount = raw % 2 === 0 ? raw : raw + 1; // keep it even so pairs work
  return { typeCount, fruitCount };
}

export const LEVEL_STORAGE_KEY = "fruit-match.level";

// --- Conveyor (the sinking pile) ---------------------------------------------
// 这一关的水果**在开局时就全部生成好了**：一屏在可见区域内，其余全部堆在屏幕
// 上方。之后游戏只做一件事——**整体下移**，让最下面那颗水果始终停在
// SCATTER_BOTTOM 那条线上（也就是离漏斗口保持固定距离 H）。最下面的被点掉了，
// 整堆就下沉到下一颗顶上那条线为止，上方原本在屏幕外的水果跟着滑进画面。
//
// 这里**没有任何「生成/补货」逻辑**，这是刻意的。早先的实现是「只生成一屏 +
// 其余排队 + 从上方补入」，那套东西前后制造了三次补货死锁、一次「水果凭空出现
// 在刚空出来的位置上」——补货位置算错的 bug，只有在“存在补货”时才可能出现。
// 整堆预生成之后，这一类 bug 在结构上不存在。
export const SINK_SPEED = 90; // px per second


// --- Lateral drift (the "隔几步向右移" board) ---------------------------------
// On higher levels the whole pinned cloud also slides sideways, bouncing
// between edges — layered on top of the sink, so drop points keep shifting and
// aiming into the well gets harder. It advances only in DISCRETE steps: every
// SWAY_TRIGGER releases, the cloud eases SWAY_STEP px toward the current edge
// (then reverses at the bounds), matching the original's "nudge every few
// moves" feel rather than a constant glide.
export const SWAY_STEP = 46; // px per nudge
export const SWAY_TRIGGER = 3; // nudge once per this many fruit releases
export const SWAY_MAX = 70; // max |offset| from centre before reversing
export const SWAY_SPEED = 140; // px/sec easing toward the pending nudge target

// 摆动是「特色关」，不是第 19 关以后关关都摆（2026-10 家长：想让摆动成为一些
// 关卡的特点）。第 19 关起每 3 关摆一次：19、22、25……开局第三行会提示。
// 摆动关的水果堆左右各让出 SWAY_MAX（免得摆到边上被屏幕切掉），所以只有这些关
// 窄一圈，不摆的关照常铺满整个宽度。
export function swayForLevel(level: number): boolean {
  return level >= 19 && (level - 19) % 3 === 0;
}

// --- 彩虹果 -------------------------------------------------------------------
// 万能果：落进井里碰到哪颗水果，就把那颗连同它的一个同类一起消掉（同类先找井里
// 的，井里没有再找水果堆里最低的那颗；消掉的样子和「消除」按钮一样，原地冒星星
// 缩小）。两颗彩虹果碰在一起就一起消。掉落途中碰到别的水果不算，和普通水果一样。
//
// 为什么要「连同类一起」：普通水果每种都是偶数个，关卡才保证消得完。要是彩虹果
// 只换掉一颗，那种水果就剩单数——用两颗彩虹果各换掉一个苹果、一个香蕉，最后剩下
// 一苹果一香蕉永远配不上，井又不满，既赢不了也输不了。带走一个同类，每种水果
// 永远是偶数，彩虹果放几颗、怎么用都不会卡死。
//
// 彩虹果不算在「剩余」里，普通水果消完就过关，没用上的彩虹果跟着消失。
export const RAINBOW = "rainbow";
export function rainbowsForLevel(level: number): number {
  return level >= 5 ? 1 : 0;
}

// 水果堆的排布：照原版「大而密」—— 铺满整个宽度，一排一排几乎挨着。
// 用蜂窝排布（隔行错开半格）+ 一点随机偏移，不用随机撒点：随机撒点天生留空洞，
// 最多铺到面积的一半多，怎么调间距都密不起来（2026-10 对照原版截图：原版屏上
// 约 85 颗，我们旧排布只有 35 颗）。
//   间距 78：水果可见大小中位数 72px，中间留几个像素的缝；物理直径 68，
//            所以掉下来的水果过不了两颗之间的缝，会落在下面的水果上（原版就是这样，
//            得从底下往上消），但旁边一颗被拿走后的空当（78×2−68=88）能掉下去。
//   半宽 312：一排 9 颗（隔行 8 颗），最外面那颗离屏幕边还有几像素。
// 最下面那排停在这条线上（离漏斗口保持固定距离 H）。离斜坡顶要留出约一颗水果高的
// 空当：堆铺满整个宽度以后，边上的水果掉到斜坡上往中间滚，得从最下面那排底下
// 钻过去；原来 830 只留了 30px，实测会卡在斜坡和旁边那颗钉住的水果之间。原版也留着这一截。
export const SCATTER_BOTTOM = 790;
export const PILE_SPACING = 78;
export const PILE_HALF_WIDTH = 312;
export const PILE_JITTER = 5; // 随机偏移，看起来不死板

// --- Well geometry (the funnel + narrow basket at the bottom) ---------------
// The two sloped shoulders guide dropped fruit into a narrow central channel.
export const WELL_LEFT_X = 300; // centre x of the left channel wall
export const WELL_RIGHT_X = 420; // centre x of the right channel wall
export const WALL_THICK = 40;

// Overflow ("装不下啦"): the basket holds 3 unmatched fruits. When a 4th
// settles in the basket without matching, you lose. This is COUNT-based (not a
// fuzzy position band) so it matches the player's intuition: "4 fruits stuck at
// the bottom = lose." A fruit counts only if it has settled (low speed) and is
// down in the basket region (below the board, within the funnel horizontally),
// which excludes fruit still falling or stuck high on the board.
export const WELL_FULL_COUNT = 4; // this many settled fruits in the basket -> fail
export const WELL_COUNT_MIN_Y = 950; // must be below this (in the basket) to count
export const WELL_COUNT_X_MIN = 180; // ...and within the funnel horizontally
export const WELL_COUNT_X_MAX = 540;
export const OVERFLOW_HOLD_MS = 350; // must stay overfull this long to fail (debounce)

// Unlockable reserve slots (like the original's ad-gated "解锁" bricks — ours
// unlock on tap for now; swap in whatever friction later). The WHOLE WELL is
// raised by SLOT_HEIGHT per slot at higher levels, physically deepening the
// channel; each locked slot is a real brick body at the channel bottom that
// fruits rest on. Unlocking removes the brick and the stack drops one slot —
// strictly serial, like the original. Raising the well also compresses the
// pinned board above (smaller scatter band) = extra difficulty. Locks reset
// every level.
export const UNLOCK_SLOTS = 2; // maximum reserve slots (level 24+)
export const SLOT_HEIGHT = 70; // one fruit of channel depth per slot

// How many reserve slots a level exposes: none early, one from level 9,
// both from level 24.
export function unlockSlotsForLevel(level: number): number {
  if (level >= 24) return 2;
  if (level >= 9) return 1;
  return 0;
}

// --- Side stumps (pachinko pegs) ---------------------------------------------
// Sawn-log stumps protrude from the side walls at higher levels (like the
// original's level-30+ boards). They only collide with RELEASED fruit:
// edge drops get deflected unpredictably, and a fruit can even come to rest
// on top of one until 打乱 shakes it loose (打乱 still jolts loose fruit outside the basket). Pinned fruit ignores them, so the
// sinking conveyor never jams.
export const STUMP_RADIUS = 36; // physics circle
export const STUMP_INSET = 30; // stump centre distance from the screen edge

// Count per level: none before 14, then 2 / 4 / 6 every 12 levels, alternating sides.
export function stumpsForLevel(level: number): number {
  if (level < 14) return 0;
  return Math.min(2 + Math.floor((level - 14) / 12) * 2, 6);
}

// Elimination requires two same-type fruits to be ACTUALLY TOUCHING inside the
// basket zone (centre distance <= diameter + this slack). The narrow channel
// stacks fruit serially, so a matching pair separated by another fruit must NOT
// clear — that serial blocking is the core difficulty of the well.
export const CONTACT_EPS = 8;

// 连击：消掉一对之后这么久之内又消掉一对，就算连上了（只算玩的时间，答题、
// 看地图时游戏暂停，不会把连击断掉）。从第 2 对起弹「连击 ×N」，叮声一路升调。
export const COMBO_WINDOW_MS = 3000;

// A released fruit counts as "settled" (for overflow checks) below this speed.
export const SETTLED_SPEED = 0.6;

// Hard cap on fruit speed (px per physics step). Must stay below the thinnest
// wall's thickness so a fruit can never tunnel through it in a single step.
// Matter.js has no continuous collision detection, so this is what prevents
// fast-falling fruit from passing straight through the floor/walls.
export const MAX_FALL_SPEED = 22;

// 物理快进倍数：每过 1/60 秒真实时间，物理引擎走几步（GameScene.stepPhysics）。
// 想让水果掉得更快，调这个，不调重力和 MAX_FALL_SPEED：重力 1.5 以上就顶到限速，
// 再大也白加；放开限速又会穿墙、穿过本该挡住它的水果。快进只是把同一段物理
// 播快——每一步算法完全不变，水果怎么滚、在哪条缝里卡住都和原来一模一样。
export const PHYSICS_SPEEDUP = 2;

// --- 答题代替看广告 ---------------------------------------------------------
// 原版的三个道具（解锁底部空位、消除、打乱）都是「看广告才能用」。我们把广告
// 换成当场连答几道题：答对够数道具才生效，没过可以再点一次重来。答题时游戏暂停，
// 掉到一半的水果不会趁机把篮子填满。
// （早先的做法是「结算页答题攒钥匙、局内花钥匙」，为的是不在紧张时刻弹题；
//  后来用户决定照原版来，钥匙系统整个删掉了。）
export const QUIZ_GATE_ENABLED = true;
export const QUIZ_ROUNDS = 3; // 每次连答几题
export const QUIZ_PASS = 2; // 答对几题算过
