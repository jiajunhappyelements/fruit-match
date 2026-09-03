import Phaser from "phaser";
import {
  WIDTH,
  HEIGHT,
  FRUIT_RADIUS,
  FRUIT_TYPES,
  CAT_WALL,
  CAT_PINNED,
  CAT_ACTIVE,
  levelConfig,
  LEVEL_STORAGE_KEY,
  INITIAL_VISIBLE,
  SINK_SPEED,
  SPAWN_CEILING,
  SCATTER_TOP,
  SCATTER_BOTTOM,
  SCATTER_HALF_TOP,
  SCATTER_HALF_BOTTOM,
  SCATTER_MIN_DIST,
  WELL_LEFT_X,
  WELL_RIGHT_X,
  WALL_THICK,
  WELL_FULL_COUNT,
  WELL_COUNT_MIN_Y,
  WELL_COUNT_X_MIN,
  WELL_COUNT_X_MAX,
  OVERFLOW_HOLD_MS,
  CONTACT_EPS,
  SETTLED_SPEED,
  MAX_FALL_SPEED,
  SLOT_HEIGHT,
  unlockSlotsForLevel,
  STUMP_RADIUS,
  STUMP_INSET,
  stumpsForLevel,
  SWAY_STEP,
  SWAY_TRIGGER,
  SWAY_MAX,
  SWAY_SPEED,
  swayForLevel,
  KEY_GATE_ENABLED,
  QUIZ_ROUNDS,
  STARTING_KEYS,
  DEBUG_KEYS,
} from "../config";
import { sfx, unlockAudio } from "../audio";
import { loadKeys, saveKeys, availableSubjects, KEY_STORAGE_KEY } from "../quiz";
import { showQuizPanel } from "../quiz/panel";
import { placeOf, isJourneyComplete, TOTAL_LEVELS, REGIONS, type Place } from "../levels";
import {
  SKY_TEXTURE,
  TERRAIN_TEXTURE,
  BASKET_TEXTURE,
  BRICK_TEXTURE,
  STUMP_TEXTURE,
  BUTTON_TEXTURE,
  FRUIT_TEXTURE_SIZE,
  buildArtTextures,
  fruitAssetUrl,
  fruitTextureKey,
} from "../art";

interface LockBrick {
  body: MatterJS.BodyType;
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
}

type Fruit = Phaser.GameObjects.Image;

export class GameScene extends Phaser.Scene {
  private fruits: Fruit[] = [];
  private pending: string[] = []; // fruit types queued to feed in from above
  private pinnedScratch: Fruit[] = []; // reused per-frame buffer (no GC churn)
  private dying = new Set<MatterJS.BodyType>();
  private remaining = 0;
  private gameOver = false;
  private overflowMs = 0;
  private level = 1;
  private unlocks = 0; // reserve slots opened this level
  private raise = 0; // how far the whole well is shifted up this level (px)
  private place!: Place; // where this level sits on the China journey
  private debugJump = false; // reached via ?level=N — don't persist progress
  private sway = false; // does the pinned cloud drift sideways this level?
  private swayX = 0; // current lateral offset of the pinned cloud (px)
  private swayTarget = 0; // offset the cloud is easing toward
  private swayDir = 1; // +1 drifting right, -1 drifting left
  private releaseCount = 0; // fruit releases since last sway nudge
  private keys = 0; // 钥匙余额：解锁一个空位花一把，答题挣

  private remainingText!: Phaser.GameObjects.Text;
  private keyText?: Phaser.GameObjects.Text;
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bricks: LockBrick[] = []; // locked reserve slots, bottom-up order

  constructor() {
    super("GameScene");
  }

  preload(): void {
    for (const fruit of FRUIT_TYPES) {
      this.load.image(fruitTextureKey(fruit.key), fruitAssetUrl(fruit));
    }
  }

  init(data: { level?: number; debug?: boolean }): void {
    // Testing back door: "?level=24" jumps straight to a level. It is
    // deliberately URL-only (a kid won't stumble on it) and EPHEMERAL — a
    // jumped session never writes progress, so peeking at level 90 can't wipe
    // the save. window.fmGoto(n) in the console does the same thing.
    const jumped = Number(new URLSearchParams(location.search).get("level"));
    const hasJump = Number.isFinite(jumped) && jumped >= 1;
    this.debugJump = data.debug ?? hasJump;

    // Restart passes the level explicitly; a fresh page load resumes from the
    // last level the kid reached (saved on every win).
    const saved = Number(localStorage.getItem(LEVEL_STORAGE_KEY));
    this.level =
      data.level ??
      (hasJump
        ? Math.floor(jumped)
        : Number.isFinite(saved) && saved >= 1
          ? saved
          : 1);
    // Higher levels raise the whole well, deepening the channel to expose
    // locked reserve slots AND squeezing the board space above.
    this.raise = unlockSlotsForLevel(this.level) * SLOT_HEIGHT;
    this.place = placeOf(this.level);
    this.sway = swayForLevel(this.level);
    this.swayX = 0;
    this.swayTarget = 0;
    this.swayDir = 1;
    this.releaseCount = 0;

    // 钥匙钱包。调试跳关用内存里的假余额，绝不碰真存档（和关卡进度一样）。
    if (this.debugJump) {
      this.keys = DEBUG_KEYS;
    } else {
      const stored = localStorage.getItem(KEY_STORAGE_KEY);
      if (stored === null) saveKeys(STARTING_KEYS);
      this.keys = stored === null ? STARTING_KEYS : loadKeys();
    }
  }

  /** 钥匙关是否真的生效：题库全空时自动退回「点一下直接解锁」。 */
  private gateActive(): boolean {
    return KEY_GATE_ENABLED && availableSubjects().length > 0;
  }

  create(): void {
    this.fruits = [];
    this.bricks = [];
    this.dying.clear();
    this.gameOver = false;
    this.overflowMs = 0;
    this.unlocks = 0; // locks reset every level, like the original

    buildArtTextures(this.textures);
    this.drawBackground();
    this.buildWell();
    this.buildBricks();
    this.buildStumps();
    this.buildSparks();
    this.buildBoard();
    this.buildHud();
    // Browsers only allow audio to start from a user gesture.
    this.input.once("pointerdown", unlockAudio);

    // Console helper, always available: fmGoto(24) reloads straight into a level.
    (window as any).fmGoto = (n: number) => {
      location.search = `?level=${Math.max(1, Math.floor(n))}`;
    };
    // The scene handle is exposed in dev, and in any ?level= debug session so
    // the deployed build can be inspected the same way.
    if ((import.meta as any).env?.DEV || this.debugJump) {
      (window as any).__scene = this;
    }

    // NOTE: elimination is NOT event-driven. Matching is a continuous
    // contact-distance check in update() — collisionstart is edge-triggered
    // and misses pairs that settle into contact gradually.
  }

  // ---------------------------------------------------------------------------
  // Star-burst particles (no art assets: the sparkle texture is generated once
  // at runtime from a Graphics star, then reused by a single pooled emitter).
  // ---------------------------------------------------------------------------
  private buildSparks(): void {
    if (!this.textures.exists("spark")) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      const cx = 16;
      const cy = 16;
      const outer = 15;
      const inner = 5.5;
      g.fillStyle(0xffffff, 1);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
      g.generateTexture("spark", 32, 32);
      g.destroy();
    }

    this.sparkEmitter = this.add
      .particles(0, 0, "spark", {
        speed: { min: 120, max: 320 },
        scale: { start: 0.9, end: 0 },
        lifespan: { min: 300, max: 600 },
        rotate: { min: 0, max: 360 },
        tint: [0xffffff, 0xffe066, 0xa5ff7a],
        gravityY: 350,
        emitting: false,
      })
      .setDepth(15);
  }

  // ---------------------------------------------------------------------------
  // Scenery + static physics
  // ---------------------------------------------------------------------------
  private drawBackground(): void {
    // Sky fixed; terrain shifted UP by the level's raise (its canvas is taller
    // than the screen, so the revealed depth is painted); basket pinned to the
    // screen bottom where the physical floor lives.
    this.add.image(0, 0, SKY_TEXTURE).setOrigin(0).setDepth(-12);
    this.add.image(0, -this.raise, TERRAIN_TEXTURE).setOrigin(0).setDepth(-8);
    this.add.image(WIDTH / 2, 1257, BASKET_TEXTURE).setDepth(-6);
  }

  private buildWell(): void {
    const wallOpts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
      isStatic: true,
      // Very low friction so fruit reliably slides down the slopes into the
      // channel instead of getting stuck partway on a shoulder.
      friction: 0.02,
      collisionFilter: { category: CAT_WALL, mask: CAT_ACTIVE },
    };

    // The whole well rises with the level's raise; the floor stays at the
    // screen bottom, so the channel between them gets DEEPER — that extra
    // depth is where the locked reserve slots live.
    const mouthY = 1095 - this.raise;

    // Slopes deliver fruit to the channel's INNER-top corner (not the wall
    // centre) so a fruit slides straight into the opening instead of perching
    // on top of the wall.
    this.addSlope(0, 860 - this.raise, WELL_LEFT_X + WALL_THICK / 2, mouthY, wallOpts);
    this.addSlope(WIDTH, 860 - this.raise, WELL_RIGHT_X - WALL_THICK / 2, mouthY, wallOpts);

    // Vertical channel walls, spanning from the (raised) mouth down past the
    // floor. Their tops sit AT the mouth, level with the slope ends — never
    // above them (a protruding wall top blocks entry). The slope bodies (60
    // thick) overlap the wall tops from above to seal the seam.
    const wallBottom = 1255;
    const wallH = wallBottom - mouthY;
    this.matter.add.rectangle(WELL_LEFT_X, mouthY + wallH / 2, WALL_THICK, wallH, wallOpts);
    this.matter.add.rectangle(WELL_RIGHT_X, mouthY + wallH / 2, WALL_THICK, wallH, wallOpts);

    // Basket floor (thick so nothing tunnels out the bottom)
    this.matter.add.rectangle((WELL_LEFT_X + WELL_RIGHT_X) / 2, 1275, 220, 70, wallOpts);

    // Safety net: hard walls around the whole play area so a fruit can never
    // fly off to infinity and corrupt game state if physics gets violent.
    this.matter.world.setBounds(0, 0, WIDTH, HEIGHT);
  }

  // Locked reserve slots: real brick bodies plugging the channel bottom.
  // Fruits rest ON the top brick; unlocking removes it and the stack drops one
  // slot — strictly serial, like the original game.
  private buildBricks(): void {
    const slots = unlockSlotsForLevel(this.level);
    for (let i = 0; i < slots; i++) {
      const top = 1240 - SLOT_HEIGHT * (i + 1);
      const cy = top + SLOT_HEIGHT / 2;
      const body = this.matter.add.rectangle(WIDTH / 2, cy, 116, SLOT_HEIGHT, {
        isStatic: true,
        collisionFilter: { category: CAT_WALL, mask: CAT_ACTIVE },
      });
      const img = this.add.image(0, 0, BRICK_TEXTURE).setDisplaySize(116, SLOT_HEIGHT);
      const label = this.add
        .text(0, 0, this.gateActive() ? "🔑解锁" : "🔒解锁", {
          fontSize: "24px",
          fontStyle: "bold",
          color: "#ffffff",
          stroke: "#6e3f1c",
          strokeThickness: 5,
        })
        .setOrigin(0.5);
      const container = this.add
        .container(WIDTH / 2, cy, [img, label])
        .setDepth(4)
        .setSize(116, SLOT_HEIGHT);
      container.on("pointerdown", () => this.unlockSlot());
      this.bricks.push({ body, container, label });
    }
    this.refreshBrickLabels();
  }

  // Only the TOP-most remaining brick is tappable and shows the 解锁 label.
  private refreshBrickLabels(): void {
    this.bricks.forEach((brick, idx) => {
      const isTop = idx === this.bricks.length - 1;
      brick.label.setVisible(isTop);
      if (isTop) brick.container.setInteractive({ useHandCursor: true });
      else brick.container.disableInteractive();
    });
  }

  // Side stumps: static pegs half-embedded in the screen edges, zig-zagging
  // down the fall zone. They collide with RELEASED fruit only — edge drops
  // deflect off them (and sometimes rest on top), while the pinned cloud and
  // its conveyor sink pass straight through.
  private buildStumps(): void {
    const count = stumpsForLevel(this.level);
    if (count === 0) return;
    const yTop = 380;
    const yBottom = 860 - this.raise - 60;
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const t = count === 1 ? 0.5 : i / (count - 1);
      const y = Phaser.Math.Linear(yTop, yBottom, t) + Phaser.Math.FloatBetween(-22, 22);
      const x = left ? STUMP_INSET : WIDTH - STUMP_INSET;
      this.matter.add.circle(x, y, STUMP_RADIUS, {
        isStatic: true,
        restitution: 0.5, // lively pachinko bounce
        friction: 0.05,
        collisionFilter: { category: CAT_WALL, mask: CAT_ACTIVE },
      });
      this.add
        .image(x, y, STUMP_TEXTURE)
        .setDisplaySize(STUMP_RADIUS * 2 + 16, STUMP_RADIUS * 2 + 16)
        .setAngle(Phaser.Math.FloatBetween(-30, 30))
        .setDepth(0);
    }
  }

  private unlockSlot(): void {
    if (this.gameOver) return;
    // 钥匙不够就是打不开——但这里绝不弹题。急着救场的时候被按住做题，
    // 孩子恨的是题不是游戏；没钥匙就等这局结束，在结算页慢慢答。
    if (this.gateActive() && this.keys <= 0) {
      this.toast("钥匙用完啦\n过关或失败后答题可以攒钥匙");
      return;
    }
    const brick = this.bricks.pop();
    if (!brick) return;
    if (this.gateActive()) this.spendKey();
    this.unlocks++;
    sfx.unlock();

    const { x, y } = brick.container;
    this.matter.world.remove(brick.body);
    brick.container.destroy();
    this.refreshBrickLabels();

    // Celebrate + float a "+1 容量" note; the resting stack drops on its own.
    this.sparkEmitter.explode(10, x, y);
    const note = this.add
      .text(x, y - 30, "+1 容量", {
        fontSize: "30px",
        fontStyle: "bold",
        color: "#ffe066",
        stroke: "#6e3f1c",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(26);
    this.tweens.add({
      targets: note,
      y: note.y - 90,
      alpha: 0,
      duration: 700,
      ease: "Sine.easeOut",
      onComplete: () => note.destroy(),
    });
  }

  private addSlope(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    opts: Phaser.Types.Physics.Matter.MatterBodyConfig,
  ): void {
    const len = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    // Thick slopes so fast-falling fruit funnels instead of tunneling through.
    const thick = 60;
    // Shift the body down along its (downward-pointing) normal so the top
    // surface aligns with the drawn grass line instead of floating above it.
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const s = ny >= 0 ? 1 : -1; // ensure the normal points down (+y)
    const cx = (x1 + x2) / 2 + nx * s * (thick / 2);
    const cy = (y1 + y2) / 2 + ny * s * (thick / 2);
    this.matter.add.rectangle(cx, cy, len, thick, { ...opts, angle });
  }

  // ---------------------------------------------------------------------------
  // The pinned board of fruits
  // ---------------------------------------------------------------------------
  private buildBoard(): void {
    const { typeCount, fruitCount } = levelConfig(this.level);
    const pool = this.buildTypePool(fruitCount, typeCount);
    const visible = Math.min(INITIAL_VISIBLE, pool.length);
    const points = this.scatterPoints(visible);
    points.forEach((p, i) => this.spawnFruit(p.x, p.y, pool[i]));
    this.pending = pool.slice(visible);
    this.remaining = fruitCount;
  }

  // Organic scatter (like the original game): dart-throw points uniformly by
  // AREA into an inverted-triangle band that narrows toward the funnel mouth,
  // rejecting any point closer than SCATTER_MIN_DIST to an accepted one. If
  // the dart throwing gets unlucky, the spacing relaxes slightly so board
  // generation can never hang.
  private scatterPoints(count: number): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    let minDist = SCATTER_MIN_DIST;
    let attempts = 0;
    while (pts.length < count) {
      if (++attempts > 3000) {
        minDist *= 0.95;
        attempts = 0;
      }
      // Uniform in the bounding box, then keep only points inside the band —
      // this yields uniform density per unit area (no crowding at the narrow
      // bottom, which uniform-per-row sampling would cause).
      const y = Phaser.Math.FloatBetween(SCATTER_TOP, this.boardBottom());
      const x = Phaser.Math.FloatBetween(
        WIDTH / 2 - SCATTER_HALF_TOP,
        WIDTH / 2 + SCATTER_HALF_TOP,
      );
      if (Math.abs(x - WIDTH / 2) > this.bandHalfWidth(y)) continue;
      if (
        pts.some((p) => Phaser.Math.Distance.Between(p.x, p.y, x, y) < minDist)
      ) {
        continue;
      }
      pts.push({ x, y });
    }
    return pts;
  }

  // Band half-width at a given y: tapers toward the (possibly raised) funnel
  // mouth inside the visible band, full width above it (the supply strip).
  private bandHalfWidth(y: number): number {
    if (y <= SCATTER_TOP) return SCATTER_HALF_TOP;
    const t = Math.min(1, (y - SCATTER_TOP) / (this.boardBottom() - SCATTER_TOP));
    return Phaser.Math.Linear(SCATTER_HALF_TOP, SCATTER_HALF_BOTTOM, t);
  }

  // ---------------------------------------------------------------------------
  // Conveyor: sink the pinned cloud when its bottom is consumed, feed new
  // fruits in from above. (The original game's signature "整体下移" behaviour.)
  // ---------------------------------------------------------------------------
  private updateConveyor(delta: number): void {
    // Reused scratch array — updateConveyor runs every frame, so allocating a
    // fresh one here was pure GC churn on low-end phones.
    const pinned = this.pinnedScratch;
    pinned.length = 0;
    for (const f of this.fruits) if (!f.getData("released")) pinned.push(f);

    if (pinned.length === 0) {
      // Board emptied while stock remains (player cleared everything visible):
      // restock a fresh batch straight into the band.
      if (this.pending.length > 0) {
        const batch = Math.min(INITIAL_VISIBLE, this.pending.length);
        const points = this.scatterPoints(batch);
        const types = this.pending.splice(0, batch);
        points.forEach((p, i) => this.spawnFruit(p.x, p.y, types[i]));
      }
      return;
    }

    let lowest = -Infinity;
    let topmost = Infinity;
    for (const f of pinned) {
      if (f.y > lowest) lowest = f.y;
      if (f.y < topmost) topmost = f.y;
    }

    // Sink: only when the bottom of the cloud has been consumed (matches the
    // original: clearing the lowest fruits makes the whole wall advance).
    const deficit = this.boardBottom() - lowest;
    const dy = deficit > 0.5 ? Math.min(deficit, (SINK_SPEED * delta) / 1000) : 0;

    // Lateral drift: ease the whole cloud toward its current sway target. The
    // discrete nudges are scheduled in releaseFruit; here we just glide.
    let dx = 0;
    if (this.sway) {
      const maxMove = (SWAY_SPEED * delta) / 1000;
      dx = Phaser.Math.Clamp(this.swayTarget - this.swayX, -maxMove, maxMove);
      this.swayX += dx;
    }

    if (dy !== 0 || dx !== 0) {
      for (const f of pinned) {
        (f as any).setPosition(f.x + dx, f.y + dy);
      }
      topmost += dy;
    }

    this.trySpawnAbove(topmost, pinned.length);
  }

  // Dart-throw ONE queued fruit into the strip above the topmost pinned fruit,
  // keeping the off-screen buffer stocked. One per frame keeps pop-in gradual.
  private trySpawnAbove(topmost: number, pinnedCount: number): void {
    if (this.pending.length === 0) return;

    // Keeping stock is gated on TWO things, not just the topmost fruit's
    // height. Height alone softlocks a level once the board thins out: a
    // single stray fruit drifting above SPAWN_CEILING blocks every restock
    // while the queue still holds the fruit the player needs, and if the
    // lowest fruit already sits at boardBottom nothing sinks to break the
    // deadlock either — the level becomes unwinnable.
    const understocked = pinnedCount < INITIAL_VISIBLE;

    // Stocked board: keep a small buffer just above the topmost fruit, capped
    // by SPAWN_CEILING so it cannot climb forever.
    if (!understocked && topmost <= SPAWN_CEILING) return;

    // New fruit joins the drifting cloud, so bias its column by the sway offset.
    const centre = WIDTH / 2 + this.swayX;
    for (let i = 0; i < 28; i++) {
      // Thin board: refill anywhere free in the VISIBLE band — never above the
      // topmost fruit. Stacking upward walks the whole cloud off the top of the
      // screen, where it can neither be clicked nor sink back down (the sink
      // only runs while the lowest fruit is above boardBottom), which strands
      // most of the level out of reach.
      const y = understocked
        ? Phaser.Math.FloatBetween(SCATTER_TOP, this.boardBottom())
        : Phaser.Math.FloatBetween(topmost - 150, topmost - 60);
      const half = this.bandHalfWidth(y);
      const x = Phaser.Math.FloatBetween(centre - half, centre + half);
      const clear = !this.fruits.some(
        (f) =>
          !f.getData("released") &&
          Phaser.Math.Distance.Between(f.x, f.y, x, y) < SCATTER_MIN_DIST,
      );
      if (clear) {
        this.spawnFruit(x, y, this.pending.shift()!);
        return;
      }
    }
  }

  // Produce a shuffled pool where every fruit type appears an even number of
  // times, so a level is always fully clearable in principle. Only the first
  // `typeCount` fruit types are used — variety is the difficulty dial.
  private buildTypePool(total: number, typeCount: number): string[] {
    const active = FRUIT_TYPES.slice(0, typeCount);
    const pool: string[] = [];
    let t = 0;
    while (pool.length < total) {
      const key = active[t % active.length].key;
      pool.push(key, key);
      t++;
    }
    pool.length = total; // trim (fruitCount is even, so pairs stay intact)
    return Phaser.Utils.Array.Shuffle(pool);
  }

  private spawnFruit(x: number, y: number, typeKey: string): void {
    const def = FRUIT_TYPES.find((f) => f.key === typeKey);
    if (!def) return;
    const baseScale = (FRUIT_RADIUS * 2.72) / FRUIT_TEXTURE_SIZE;
    const fruit = this.add
      .image(x, y, fruitTextureKey(def.key))
      .setOrigin(0.5)
      .setScale(baseScale)
      .setDepth(1);
    fruit.setData("ftype", typeKey);
    fruit.setData("released", false);
    fruit.setData("baseScale", baseScale);

    this.matter.add.gameObject(fruit, {
      shape: { type: "circle", radius: FRUIT_RADIUS },
      restitution: 0.05,
      friction: 0.1,
      frictionStatic: 0.15,
      // Pinned fruit collides only with falling (active) fruit — so a dropped
      // fruit rests on it — but not with other pinned fruit (they stay put).
      collisionFilter: { category: CAT_PINNED, mask: CAT_ACTIVE },
    });
    // A slight random tilt makes the scatter feel hand-placed, not stamped.
    fruit.setAngle(Phaser.Math.FloatBetween(-18, 18));
    // Pin it AFTER creation so Matter stores the real (finite) mass to restore
    // when we release it. Creating it static from the start leaves mass=Infinity,
    // which turns into NaN the moment it becomes dynamic.
    (fruit as any).setStatic(true);

    fruit.setInteractive({ useHandCursor: true });
    fruit.on("pointerdown", () => this.releaseFruit(fruit));

    this.fruits.push(fruit);
  }

  private releaseFruit(fruit: Fruit): void {
    if (this.gameOver || fruit.getData("released")) return;
    fruit.setData("released", true);
    fruit.disableInteractive();

    const body = fruit.body as MatterJS.BodyType;
    const baseScale = fruit.getData("baseScale") as number;
    this.sparkEmitter.explode(4, fruit.x, fruit.y);
    this.tweens.add({
      targets: fruit,
      scale: baseScale * 1.14,
      duration: 85,
      yoyo: true,
      ease: "Sine.easeOut",
    });
    // From now on it obeys gravity and collides with walls, other falling fruit,
    // AND the fruit still pinned in the board (so it can get blocked / rest on
    // them instead of passing straight through).
    (fruit as any).setStatic(false);
    body.collisionFilter.category = CAT_ACTIVE;
    body.collisionFilter.mask = CAT_WALL | CAT_ACTIVE | CAT_PINNED;
    (fruit as any).setVelocity(0, 0);
    (fruit as any).setAngularVelocity(Phaser.Math.FloatBetween(-0.05, 0.05));

    sfx.release();
    this.nudgeSway();
  }

  // Every SWAY_TRIGGER releases, schedule the next discrete lateral nudge; the
  // easing toward it happens in updateConveyor. Reverses at the bounds so the
  // cloud paces back and forth instead of walking off one side.
  private nudgeSway(): void {
    if (!this.sway) return;
    if (++this.releaseCount < SWAY_TRIGGER) return;
    this.releaseCount = 0;
    this.swayTarget += SWAY_STEP * this.swayDir;
    if (this.swayTarget >= SWAY_MAX) {
      this.swayTarget = SWAY_MAX;
      this.swayDir = -1;
    } else if (this.swayTarget <= -SWAY_MAX) {
      this.swayTarget = -SWAY_MAX;
      this.swayDir = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Elimination
  // ---------------------------------------------------------------------------
  private eliminate(fruit: Fruit): void {
    const body = fruit.body as MatterJS.BodyType;
    this.dying.add(body);
    this.remaining--;
    this.updateRemaining();

    // Star burst at the fruit's spot (like the original game's pop effect).
    this.sparkEmitter.explode(12, fruit.x, fruit.y);

    // Stop blocking neighbours immediately, then shrink + pop.
    (fruit as any).setSensor(true);
    this.tweens.add({
      targets: fruit,
      scale: 0,
      duration: 160,
      ease: "Back.easeIn",
      onComplete: () => {
        Phaser.Utils.Array.Remove(this.fruits, fruit);
        this.dying.delete(body); // don't retain destroyed bodies for the level
        fruit.destroy(); // also removes the Matter body
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Loop: basket matching + overflow detection
  // ---------------------------------------------------------------------------

  // Unlocked reserve slots raise the fail threshold; the basket-zone ceiling
  // follows the level's WELL RAISE (not the click count) so the deeper channel
  // is fully counted and contact-matchable whether locked or open.
  private wellCapacity(): number {
    return WELL_FULL_COUNT + this.unlocks;
  }

  private basketMinY(): number {
    return WELL_COUNT_MIN_Y - this.raise;
  }

  // The pinned board's floor line: squeezed upward together with the well.
  private boardBottom(): number {
    return SCATTER_BOTTOM - this.raise;
  }

  update(_time: number, delta: number): void {
    if (this.gameOver) return;

    this.updateConveyor(delta);

    // Gather released fruits in the basket zone: ALL of them for contact
    // matching (a landing fruit may pop on touch, before it settles), and the
    // SETTLED ones for the overflow check.
    const inZone: Fruit[] = [];
    const settled: Fruit[] = [];
    for (const fruit of this.fruits) {
      if (!fruit.getData("released")) continue;
      const body = fruit.body as MatterJS.BodyType;
      if (this.dying.has(body)) continue;

      // Clamp speed so nothing can tunnel through a wall in one physics step.
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > MAX_FALL_SPEED) {
        const k = MAX_FALL_SPEED / speed;
        (fruit as any).setVelocity(body.velocity.x * k, body.velocity.y * k);
      }

      if (
        fruit.y > this.basketMinY() &&
        fruit.x > WELL_COUNT_X_MIN &&
        fruit.x < WELL_COUNT_X_MAX
      ) {
        inZone.push(fruit);
        if (speed < SETTLED_SPEED) settled.push(fruit);
      }
    }

    // Contact-based elimination: two same-type fruits clear ONLY when they are
    // actually touching (centre distance <= diameter + slack). The narrow
    // channel stacks fruit serially, so a pair separated by another fruit must
    // stay blocked — e.g. watermelon/apple/watermelon does NOT clear. That
    // serial blocking is the well's core difficulty; rescuing the stack means
    // landing a match ON TOP (or using 打乱 to reorder).
    const contactDist = FRUIT_RADIUS * 2 + CONTACT_EPS;
    const used = new Set<Fruit>();
    let combo = 0;
    for (let i = 0; i < inZone.length; i++) {
      const a = inZone[i];
      if (used.has(a)) continue;
      for (let j = i + 1; j < inZone.length; j++) {
        const b = inZone[j];
        if (used.has(b)) continue;
        if (a.getData("ftype") !== b.getData("ftype")) continue;
        if (Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y) > contactDist) {
          continue;
        }
        used.add(a);
        used.add(b);
        this.eliminate(a);
        this.eliminate(b);
        sfx.match(combo++);
        break;
      }
    }
    if (this.remaining <= 0) {
      this.win();
      return;
    }

    // Overflow: the basket holds 3 (+1 per unlocked reserve slot). After
    // matches clear, only unmatchable types remain settled; one more than the
    // capacity can hold = "装不下啦".
    const stillSettled = settled.filter(
      (f) => !this.dying.has(f.body as MatterJS.BodyType),
    );
    if (stillSettled.length >= this.wellCapacity()) {
      this.overflowMs += delta;
      if (this.overflowMs >= OVERFLOW_HOLD_MS) this.lose();
    } else {
      this.overflowMs = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // HUD + end states
  // ---------------------------------------------------------------------------
  private buildHud(): void {
    this.add
      .text(WIDTH / 2, 38, `第 ${this.level} 关`, {
        fontSize: "46px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#2a6f9f",
        strokeThickness: 10,
        shadow: { offsetX: 0, offsetY: 4, color: "#25587b", blur: 0, fill: true },
      })
      .setOrigin(0.5)
      .setDepth(25);

    // Journey label under the level number: 广东-广州
    this.add
      .text(WIDTH / 2, 78, `${this.place.region}-${this.place.city}`, {
        fontSize: "26px",
        fontStyle: "bold",
        color: "#eaf7ff",
        stroke: "#2a6f9f",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.remainingText = this.add
      .text(28, 990, "", {
        fontSize: "38px",
        fontStyle: "bold",
        color: "#fff2a5",
        stroke: "#543214",
        strokeThickness: 8,
        shadow: { offsetX: 0, offsetY: 4, color: "#3c2410", blur: 0, fill: true },
      })
      .setDepth(25);
    this.updateRemaining();

    this.add
      .text(WIDTH / 2, 112, "点一下水果让它掉下去，凑成一对就消除！", {
        fontSize: "22px",
        color: "#ffffff",
        stroke: "#2d74a8",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.makeButton(WIDTH - 110, 1000, "打乱", 0x6fcf5a, () => this.shuffle());

    // 钥匙余额，放在左上角（解锁砖块要花它）
    if (this.gateActive()) {
      this.keyText = this.add
        .text(20, 18, "", {
          fontSize: "32px",
          fontStyle: "bold",
          color: "#ffe066",
          stroke: "#5a3a1a",
          strokeThickness: 6,
        })
        .setDepth(40);
      this.updateKeyText();
    }

    // Make a jumped session unmistakable, so a debug run is never confused with
    // real progress (it deliberately doesn't save).
    if (this.debugJump) {
      this.add
        .text(WIDTH - 12, 12, "调试 · 不存进度", {
          fontSize: "20px",
          color: "#ffd76e",
          stroke: "#5a3a1a",
          strokeThickness: 4,
        })
        .setOrigin(1, 0)
        .setDepth(40);
    }
  }

  private updateRemaining(): void {
    this.remainingText.setText(`剩余\n${this.remaining}`);
  }

  private updateKeyText(): void {
    this.keyText?.setText(`🔑 ${this.keys}`);
  }

  private spendKey(): void {
    this.keys = Math.max(0, this.keys - 1);
    if (!this.debugJump) saveKeys(this.keys);
    this.updateKeyText();
  }

  private earnKey(): void {
    this.keys++;
    if (!this.debugJump) saveKeys(this.keys);
    this.updateKeyText();
  }

  /** 一行会飘走的提示（钥匙不够之类），不打断操作。 */
  private toast(msg: string): void {
    const t = this.add
      .text(WIDTH / 2, 760, msg, {
        fontSize: "30px",
        fontStyle: "bold",
        color: "#ffffff",
        align: "center",
        stroke: "#8a3a1a",
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setDepth(45);
    this.tweens.add({
      targets: t,
      y: t.y - 70,
      alpha: 0,
      delay: 700,
      duration: 900,
      ease: "Sine.easeIn",
      onComplete: () => t.destroy(),
    });
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    color: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const txt = this.add
      .text(0, -1, label, {
        fontSize: "34px",
        fontStyle: "bold",
        color: "#ffffff",
        stroke: "#24602a",
        strokeThickness: 6,
        shadow: { offsetX: 0, offsetY: 3, color: "#1e5825", blur: 0, fill: true },
      })
      .setOrigin(0.5);
    // 底板按文字宽度撑开：五个字的「答题攒钥匙」比固定的 168px 还宽，
    // 写死宽度会让字戳出按钮外面。
    const w = Math.max(168, Math.ceil(txt.width) + 48);
    const bg = this.add.image(0, 0, BUTTON_TEXTURE).setTint(color).setDisplaySize(w, 78);
    const c = this.add.container(x, y, [bg, txt]).setDepth(20).setSize(w, 78);
    c.setInteractive({ useHandCursor: true });
    c.on("pointerdown", onClick);
    return c;
  }

  private shuffle(): void {
    if (this.gameOver) return;
    sfx.shuffle();

    // Genuinely REORDER the settled basket stack. A random impulse alone can
    // never rescue an interleaved stack (banana/strawberry/banana/strawberry):
    // the channel is barely wider than one fruit, so everything drops back in
    // the same order and two matching fruits stay forever separated — a dead
    // end with no way out. Permuting which fruit occupies which slot is what
    // "打乱" promises, and it is the only escape from that state.
    const settled: Fruit[] = [];
    for (const fruit of this.fruits) {
      if (!fruit.getData("released")) continue;
      const body = fruit.body as MatterJS.BodyType;
      if (this.dying.has(body)) continue;
      if (Math.hypot(body.velocity.x, body.velocity.y) >= SETTLED_SPEED) continue;
      if (
        fruit.y > this.basketMinY() &&
        fruit.x > WELL_COUNT_X_MIN &&
        fruit.x < WELL_COUNT_X_MAX
      ) {
        settled.push(fruit);
      }
    }
    if (settled.length > 1) {
      const slots = settled
        .map((f) => ({ x: f.x, y: f.y }))
        .sort((a, b) => a.y - b.y);
      Phaser.Utils.Array.Shuffle(settled).forEach((fruit, i) => {
        (fruit as any).setPosition(slots[i].x, slots[i].y);
        (fruit as any).setVelocity(0, 0);
      });
      this.sparkEmitter.explode(8, WIDTH / 2, slots[slots.length - 1].y);
    }

    // Everything else that is loose still gets a jolt, to free physical jams.
    for (const fruit of this.fruits) {
      if (!fruit.getData("released")) continue;
      if (this.dying.has(fruit.body as MatterJS.BodyType)) continue;
      if (settled.includes(fruit)) continue;
      (fruit as any).setVelocity(
        Phaser.Math.FloatBetween(-7, 7),
        Phaser.Math.FloatBetween(-11, -3),
      );
    }
  }

  private win(): void {
    sfx.win();
    // Save progress FIRST so the next level survives a page close/reload.
    const next = this.level + 1;
    if (!this.debugJump) localStorage.setItem(LEVEL_STORAGE_KEY, String(next));

    // Finished the whole country?
    if (isJourneyComplete(next)) {
      this.endGame(
        "跑完全国啦！",
        0xe8a33d,
        "再玩一遍",
        () => {
          if (!this.debugJump) localStorage.setItem(LEVEL_STORAGE_KEY, "1");
          this.scene.restart({ level: 1, debug: this.debugJump });
        },
        `你走遍了 ${REGIONS.length} 个省市自治区，共 ${TOTAL_LEVELS} 关`,
      );
      return;
    }

    // Crossing into a new region is the journey's milestone moment.
    const here = this.place;
    const there = placeOf(next);
    const subtitle =
      there.region === here.region
        ? `下一站 ${there.region}-${there.city}`
        : `即将到达 ${there.region}！（第 ${there.regionIndex}/${REGIONS.length} 省）`;

    this.endGame(
      "恭喜过关！",
      0x3aa655,
      "下一关",
      () => this.scene.restart({ level: next, debug: this.debugJump }),
      subtitle,
    );
  }

  private lose(): void {
    sfx.lose();
    this.endGame(
      "装不下啦",
      0xd9534f,
      "再玩一次",
      () => this.scene.restart({ level: this.level, debug: this.debugJump }),
      `${this.place.region}-${this.place.city}`,
    );
  }

  private endGame(
    message: string,
    color: number,
    btnLabel: string,
    onClick: () => void,
    subtitle?: string,
  ): void {
    if (this.gameOver) return;
    this.gameOver = true;

    this.add
      .rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.55)
      .setDepth(30);
    this.add
      .text(WIDTH / 2, HEIGHT / 2 - 80, message, {
        fontSize: "72px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(31);

    if (subtitle) {
      this.add
        .text(WIDTH / 2, HEIGHT / 2 - 10, subtitle, {
          fontSize: "30px",
          color: "#ffe9a8",
          align: "center",
          wordWrap: { width: WIDTH - 120 },
        })
        .setOrigin(0.5)
        .setDepth(31);
    }

    const btn = this.makeButton(WIDTH / 2, HEIGHT / 2 + 60, btnLabel, color, onClick);
    btn.setDepth(31);

    // 挣钥匙只在这里 —— 一局已经结束，没人催，答错也不会输掉什么。
    if (this.gateActive()) {
      const purse = this.add
        .text(WIDTH / 2, HEIGHT / 2 + 226, "", {
          fontSize: "26px",
          fontStyle: "bold",
          color: "#ffe9a8",
          stroke: "#3a2410",
          strokeThickness: 6,
        })
        .setOrigin(0.5)
        .setDepth(31);
      const showPurse = () => purse.setText(`当前钥匙 🔑 ${this.keys}`);
      showPurse();

      const quiz = this.makeButton(
        WIDTH / 2,
        HEIGHT / 2 + 165,
        "答题攒钥匙",
        0x3d8ec9,
        () => {
          quiz.disableInteractive();
          showQuizPanel(this, {
            rounds: QUIZ_ROUNDS,
            onCorrect: () => {
              this.earnKey();
              showPurse();
            },
            onClose: () => quiz.setInteractive({ useHandCursor: true }),
          });
        },
      );
      quiz.setDepth(31);
    }
  }
}
