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

// The playable produce set. Each key maps to public/assets/<pack>/<key>.png.
// ORDER IS THE DIFFICULTY CURVE: levelConfig unlocks one more type per level
// from the front of this list — fruits carry levels 1–10, vegetables start
// appearing from level 11 as fresh "new content" surprises.
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
// volume. Level 1: 3 types / 40 fruits — gentle for a kid. Types cap at the
// full set, count caps so the scatter band never over-packs.
export function levelConfig(level: number): {
  typeCount: number;
  fruitCount: number;
} {
  const typeCount = Math.min(2 + level, FRUIT_TYPES.length);
  // Big pools like the original game ("剩余 172"): only ~INITIAL_VISIBLE are on
  // screen at once, the rest queue up and feed in from above as the board sinks.
  const fruitCount = Math.min(30 + level * 10, 160); // always even
  return { typeCount, fruitCount };
}

export const LEVEL_STORAGE_KEY = "fruit-match.level";

// --- Conveyor (the sinking board) --------------------------------------------
// Only ~INITIAL_VISIBLE fruits are spawned into the band at level start; the
// rest wait in a queue. When the LOWEST pinned fruit is consumed the whole
// pinned cloud sinks (at SINK_SPEED) until a fruit touches the band bottom
// again, and new fruits from the queue are dart-thrown into the strip above
// the topmost fruit — kept stocked down to SPAWN_CEILING (just off-screen) so
// there is always a buffer row about to slide into view.
export const INITIAL_VISIBLE = 26;
export const SINK_SPEED = 90; // px per second
export const SPAWN_CEILING = -60; // stop stocking once topmost fruit is above this

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

// Lateral drift starts at level 8, like stumps/unlocks are gated by level.
export function swayForLevel(level: number): boolean {
  return level >= 8;
}

// Board layout: an ORGANIC scatter (like the original game), not a rigid grid.
// Fruits are dart-thrown into an inverted-triangle band — wide under the HUD,
// narrowing toward the funnel mouth — with a minimum spacing between centres so
// pinned fruits never visually overlap and a falling fruit either rests on one
// or slips through a gap (never wedges deep and gets ejected).
export const SCATTER_TOP = 150;
export const SCATTER_BOTTOM = 830;
export const SCATTER_HALF_TOP = 290; // band half-width at the top...
export const SCATTER_HALF_BOTTOM = 100; // ...and just above the funnel mouth
export const SCATTER_MIN_DIST = 88; // > fruit diameter (~68px) + breathing room

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
export const UNLOCK_SLOTS = 2; // maximum reserve slots (level 10+)
export const SLOT_HEIGHT = 70; // one fruit of channel depth per slot

// How many reserve slots a level exposes: none early, one from level 5,
// both from level 10.
export function unlockSlotsForLevel(level: number): number {
  if (level >= 10) return 2;
  if (level >= 5) return 1;
  return 0;
}

// --- Side stumps (pachinko pegs) ---------------------------------------------
// Sawn-log stumps protrude from the side walls at higher levels (like the
// original's level-30+ boards). They only collide with RELEASED fruit:
// edge drops get deflected unpredictably, and a fruit can even come to rest
// on top of one until 打乱 shakes it loose. Pinned fruit ignores them, so the
// sinking conveyor never jams.
export const STUMP_RADIUS = 36; // physics circle
export const STUMP_INSET = 30; // stump centre distance from the screen edge

// Count per level: none early, then 2 / 4 / 6 in steps, alternating sides.
export function stumpsForLevel(level: number): number {
  if (level < 7) return 0;
  return Math.min(2 + Math.floor((level - 7) / 3) * 2, 6);
}

// Elimination requires two same-type fruits to be ACTUALLY TOUCHING inside the
// basket zone (centre distance <= diameter + this slack). The narrow channel
// stacks fruit serially, so a matching pair separated by another fruit must NOT
// clear — that serial blocking is the core difficulty of the well.
export const CONTACT_EPS = 8;

// A released fruit counts as "settled" (for overflow checks) below this speed.
export const SETTLED_SPEED = 0.6;

// Hard cap on fruit speed (px per physics step). Must stay below the thinnest
// wall's thickness so a fruit can never tunnel through it in a single step.
// Matter.js has no continuous collision detection, so this is what prevents
// fast-falling fruit from passing straight through the floor/walls.
export const MAX_FALL_SPEED = 22;
