import Phaser from "phaser";
import {
  HEIGHT,
  WELL_LEFT_X,
  WELL_RIGHT_X,
  WALL_THICK,
  WIDTH,
  SLOT_HEIGHT,
  UNLOCK_SLOTS,
  type FruitType,
} from "./config";

// The backdrop is split into layers so the terrain can be RAISED per level to
// expose locked reserve slots (the sky stays put, the basket stays glued to
// the screen bottom):
//   sky (fixed)  <  terrain (shifts up by the level's well raise)  <  basket
export const SKY_TEXTURE = "painted-sky";
export const TERRAIN_TEXTURE = "painted-terrain";
export const BASKET_TEXTURE = "painted-basket";
export const BRICK_TEXTURE = "lock-brick";
export const STUMP_TEXTURE = "side-stump";
export const BUTTON_TEXTURE = "button-bubble";
export const RAINBOW_TEXTURE = "rainbow-fruit";
export const MAP_FLAG_TEXTURE = "map-flag";
export const MAP_DONE_TEXTURE = "map-done";
export const MAP_LOCK_TEXTURE = "map-lock";
export const MAP_PLANE_TEXTURE = "map-plane";

// The terrain canvas is taller than the screen: when raised by up to
// UNLOCK_SLOTS slots it must still paint all the way to the screen bottom.
export const TERRAIN_EXTRA = UNLOCK_SLOTS * SLOT_HEIGHT;
export const TERRAIN_HEIGHT = HEIGHT + TERRAIN_EXTRA;

export const FRUIT_TEXTURE_SIZE = 256;

// Relative (no leading slash) so it resolves under the GitHub Pages project
// subpath (vite base "./"); an absolute "/assets/..." would 404 there.
export function fruitAssetUrl(type: FruitType): string {
  return `assets/${type.pack}/${type.key}.png`;
}

type CanvasDrawer = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

export function fruitTextureKey(typeKey: string): string {
  return `fruit-${typeKey}`;
}

export function buildArtTextures(textures: Phaser.Textures.TextureManager): void {
  makeTexture(textures, SKY_TEXTURE, WIDTH, HEIGHT, drawSkyTexture);
  makeTexture(textures, TERRAIN_TEXTURE, WIDTH, TERRAIN_HEIGHT, drawTerrainLayer);
  makeTexture(textures, BASKET_TEXTURE, 200, 130, drawBasketTexture);
  makeTexture(textures, BRICK_TEXTURE, 132, SLOT_HEIGHT, drawBrickTexture);
  makeTexture(textures, STUMP_TEXTURE, 96, 96, drawStumpTexture);
  makeTexture(textures, BUTTON_TEXTURE, 196, 92, drawButtonTexture);
  // 和水果图片一样 256×256，画面上就和水果一样大
  makeTexture(textures, RAINBOW_TEXTURE, FRUIT_TEXTURE_SIZE, FRUIT_TEXTURE_SIZE, drawRainbowTexture);
  // 旅行地图上会动的两个标记：小旗（现在在这）、刚打上的 ✓
  makeTexture(textures, MAP_FLAG_TEXTURE, 96, 96, (ctx, w) => drawMapIcon(ctx, w / 2, w / 2, w * 0.38, "now"));
  makeTexture(textures, MAP_DONE_TEXTURE, 96, 96, (ctx, w) => drawMapIcon(ctx, w / 2, w / 2, w * 0.38, "done"));
  makeTexture(textures, MAP_LOCK_TEXTURE, 96, 96, (ctx, w) => drawMapIcon(ctx, w / 2, w / 2, w * 0.38, "locked"));
  makeTexture(textures, MAP_PLANE_TEXTURE, 128, 128, drawPlaneTexture);
}

function makeTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  width: number,
  height: number,
  draw: CanvasDrawer,
): void {
  if (textures.exists(key)) return;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently：让浏览器把画布放在内存里，不放 GPU 上。安卓把应用切到后台
  // 会回收 GPU 上的画布，切回来就是一张白板——2026-10 孩子手机上井、斜坡、砖、
  // 按钮底色全没了，而 Phaser 的文字用的正是内存画布，一个字没丢。
  // 必须在第一次 getContext 时就给：画布类型由第一次决定，Phaser 的 CanvasTexture
  // 后面也会要 willReadFrequently，但那时已经不生效了。
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  draw(ctx, width, height);
  const texture = textures.addCanvas(key, canvas);
  // 兜底：GPU 进程整个崩掉时内存画布也会被清空（桌面 Chrome 实测）。浏览器恢复
  // 画布时发 contextrestored，那时画布是空白的，重画一遍再重新上传给 WebGL。
  // 贴图是全局的、每张只建一次，所以监听也只挂一次。
  canvas.addEventListener("contextrestored", () => {
    draw(ctx, width, height);
    texture?.refresh();
  });
}

// 文字也一样：Phaser 的文字画布在 GPU 进程崩掉时同样会被清空，而 Phaser 不会
// 自己重画（桌面 Chrome 实测，关卡名、剩余数、按钮上的字全没了）。画布恢复时
// 让它按原来的文字和样式重画一遍。文字画布是 Phaser 池子里复用的，所以销毁时
// 要把监听摘掉，不然下一个用到这张画布的文字会带着一串旧监听。
const textHooked = new WeakSet<Phaser.GameObjects.Text>();
export function repaintTextOnRestore(text: Phaser.GameObjects.Text): void {
  if (textHooked.has(text)) return;
  textHooked.add(text);
  const canvas = text.canvas;
  const onRestored = () => text.updateText();
  canvas.addEventListener("contextrestored", onRestored);
  text.once(Phaser.GameObjects.Events.DESTROY, () =>
    canvas.removeEventListener("contextrestored", onRestored),
  );
}

function drawSkyTexture(ctx: CanvasRenderingContext2D): void {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#58b9ff");
  sky.addColorStop(0.55, "#aee8ff");
  sky.addColorStop(1, "#e6fbff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  drawCloud(ctx, 105, 620, 1.15, 0.34);
  drawCloud(ctx, 520, 690, 1.35, 0.3);
  drawCloud(ctx, 280, 745, 1.6, 0.22);
  drawSoftHill(ctx, 0, 760, "#bdeeff", "#96d6f6");
  drawSoftHill(ctx, 130, 835, "#acdff5", "#83c7ea");
}

// Terrain layer in WORLD coordinates for a raise of 0; the scene shifts the
// whole image up by the level's raise. Dirt/bricks paint down to
// TERRAIN_HEIGHT so the extra depth revealed by raising is fully covered.
function drawTerrainLayer(ctx: CanvasRenderingContext2D): void {
  drawFallingLeaves(ctx);
  drawTerrain(ctx, "left");
  drawTerrain(ctx, "right");
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(-46, 8, 48, 23, 0, 0, Math.PI * 2);
  ctx.ellipse(0, -2, 62, 29, 0, 0, Math.PI * 2);
  ctx.ellipse(48, 10, 46, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSoftHill(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  y: number,
  top: string,
  bottom: string,
): void {
  const fill = ctx.createLinearGradient(0, y - 170, 0, HEIGHT);
  fill.addColorStop(0, top);
  fill.addColorStop(1, bottom);
  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.42;
  ctx.beginPath();
  ctx.moveTo(-80, HEIGHT);
  ctx.lineTo(-80, y);
  ctx.bezierCurveTo(80 + offsetX, y - 70, 170 + offsetX, y + 50, 310 + offsetX, y - 35);
  ctx.bezierCurveTo(470 + offsetX, y - 130, 610 + offsetX, y + 40, 800 + offsetX, y - 65);
  ctx.lineTo(WIDTH + 80, HEIGHT);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawFallingLeaves(ctx: CanvasRenderingContext2D): void {
  const leaves = [
    [310, 858, -32, 0.75],
    [378, 840, 28, 0.65],
    [416, 872, 12, 0.9],
    [348, 902, -14, 0.55],
    [452, 820, 46, 0.5],
    [502, 884, -25, 0.62],
  ];
  for (const [x, y, angle, scale] of leaves) {
    drawLeaf(ctx, x, y, Number(angle), Number(scale), "#d7a552", "#bf8641");
  }
}

function drawTerrain(ctx: CanvasRenderingContext2D, side: "left" | "right"): void {
  const left = side === "left";
  const x0 = left ? 0 : WIDTH;
  const innerX = left ? WELL_LEFT_X : WELL_RIGHT_X;
  const innerTopX = left ? WELL_LEFT_X : WELL_RIGHT_X;
  const capStartX = left ? 0 : WIDTH;
  const capEndX = left ? WELL_LEFT_X - WALL_THICK : WELL_RIGHT_X + WALL_THICK;
  const capEndY = 1068;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, TERRAIN_HEIGHT);
  ctx.lineTo(x0, 858);
  ctx.lineTo(innerTopX, 1095);
  ctx.lineTo(innerX, TERRAIN_HEIGHT);
  ctx.closePath();
  ctx.clip();

  const dirt = ctx.createLinearGradient(0, 850, 0, TERRAIN_HEIGHT);
  dirt.addColorStop(0, "#e7bc75");
  dirt.addColorStop(0.45, "#dba368");
  dirt.addColorStop(1, "#b97747");
  ctx.fillStyle = dirt;
  ctx.fillRect(0, 830, WIDTH, TERRAIN_HEIGHT - 830);

  ctx.fillStyle = "rgba(255, 231, 168, 0.2)";
  for (let i = 0; i < 12; i++) {
    const x = left ? 22 + i * 55 : WIDTH - 22 - i * 55;
    const y = 980 + (i % 6) * 48;
    ctx.beginPath();
    ctx.ellipse(x, y, 18 + (i % 3) * 4, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBricks(ctx, left ? 0 : WELL_RIGHT_X, left ? WELL_LEFT_X : WIDTH, 1010, TERRAIN_HEIGHT);
  ctx.restore();

  drawGrassCap(ctx, capStartX, 858, capEndX, capEndY, left);
  drawVines(ctx, left);
}

function drawBricks(
  ctx: CanvasRenderingContext2D,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): void {
  ctx.strokeStyle = "rgba(141, 89, 45, 0.3)";
  ctx.lineWidth = 5;
  for (let y = yMin; y < yMax; y += 80) {
    ctx.beginPath();
    ctx.moveTo(xMin, y);
    ctx.lineTo(xMax, y);
    ctx.stroke();
  }
  for (let y = yMin; y < yMax; y += 80) {
    const offset = ((y / 80) % 2) * 55;
    for (let x = xMin - 60 + offset; x < xMax + 70; x += 118) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 74);
      ctx.stroke();
    }
  }
}

function drawGrassCap(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  left: boolean,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(52, 105, 34, 0.38)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 12;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#5b9f37";
  ctx.lineWidth = 82;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.shadowColor = "transparent";

  ctx.strokeStyle = "#a7df55";
  ctx.lineWidth = 60;
  ctx.beginPath();
  ctx.moveTo(x1, y1 - 6);
  ctx.lineTo(x2, y2 - 6);
  ctx.stroke();

  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const x = Phaser.Math.Linear(x1, x2, t);
    const y = Phaser.Math.Linear(y1, y2, t) + 16;
    ctx.fillStyle = i % 2 === 0 ? "#8ccc42" : "#b3e661";
    ctx.beginPath();
    ctx.ellipse(x + (left ? -8 : 8), y, 36, 24, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVines(ctx: CanvasRenderingContext2D, left: boolean): void {
  const x = left ? 70 : WIDTH - 70;
  const y = 1045;
  ctx.save();
  ctx.strokeStyle = "#4d9b38";
  ctx.lineWidth = 10;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x + (left ? -35 : 35), y + 90, x + (left ? 38 : -38), y + 140, x, y + 220);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const ly = y + 45 + i * 50;
    drawLeaf(ctx, x + (left ? -25 : 25), ly, left ? -40 : 40, 0.9, "#69bb46", "#3d8b33");
  }
  ctx.restore();
}

// Standalone 200×130 texture; the scene pins it to the screen bottom so it
// does NOT rise with the terrain.
function drawBasketTexture(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(100, 40);
  ctx.fillStyle = "rgba(90, 45, 18, 0.22)";
  ctx.beginPath();
  ctx.ellipse(0, 42, 95, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(0, -10, 0, 72);
  body.addColorStop(0, "#ffe5a8");
  body.addColorStop(1, "#c8873f");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-86, 8);
  ctx.quadraticCurveTo(0, 34, 86, 8);
  ctx.lineTo(60, 70);
  ctx.quadraticCurveTo(0, 90, -60, 70);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#8d5628";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.strokeStyle = "rgba(148, 86, 34, 0.48)";
  ctx.lineWidth = 4;
  for (let i = -70; i <= 70; i += 22) {
    ctx.beginPath();
    ctx.moveTo(i, 16);
    ctx.quadraticCurveTo(i * 0.55, 48, i * 0.35, 74);
    ctx.stroke();
  }
  ctx.restore();
}

// A sawn-log stump face: bark ring, warm wood face, growth rings, one crack.
function drawStumpTexture(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cx = width / 2;
  const cy = height / 2;
  const R = width / 2 - 2;

  // bark
  ctx.fillStyle = "#7d5433";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#5e3d22";
  ctx.lineWidth = 3;
  ctx.stroke();

  // wood face
  const face = ctx.createRadialGradient(cx - 6, cy - 8, 4, cx, cy, R - 7);
  face.addColorStop(0, "#f2d9a6");
  face.addColorStop(1, "#d9b071");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 8, 0, Math.PI * 2);
  ctx.fill();

  // growth rings (slightly off-centre for a hand-cut feel)
  ctx.strokeStyle = "rgba(150, 103, 52, 0.55)";
  ctx.lineWidth = 2.5;
  for (const r of [R - 16, R - 26, R - 35]) {
    if (r <= 4) continue;
    ctx.beginPath();
    ctx.arc(cx - 3, cy - 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(150, 103, 52, 0.7)";
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 2, 4, 0, Math.PI * 2);
  ctx.fill();

  // one radial crack
  ctx.strokeStyle = "rgba(122, 79, 36, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - 4);
  ctx.lineTo(cx + R * 0.55, cy - R * 0.45);
  ctx.stroke();
}

// The locked reserve slot: a mortared brick block that plugs the channel.
function drawBrickTexture(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#c2603f");
  base.addColorStop(1, "#8f3f26");
  ctx.fillStyle = base;
  roundRect(ctx, 2, 2, width - 4, height - 4, 10);
  ctx.fill();
  ctx.strokeStyle = "#6e2f1c";
  ctx.lineWidth = 4;
  ctx.stroke();

  // mortar joints: one bed joint + staggered head joints
  ctx.strokeStyle = "rgba(255, 220, 190, 0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(4, height / 2);
  ctx.lineTo(width - 4, height / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 4);
  ctx.lineTo(width * 0.5, height / 2);
  ctx.moveTo(width * 0.28, height / 2);
  ctx.lineTo(width * 0.28, height - 4);
  ctx.moveTo(width * 0.72, height / 2);
  ctx.lineTo(width * 0.72, height - 4);
  ctx.stroke();

  // top light catch
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  roundRect(ctx, 8, 6, width - 16, 11, 7);
  ctx.fill();
}

// 旅行地图的城市标记：走过 ✓（绿）、现在在这（红底白旗）、还没到（灰底白锁）。
// 地图画布上直接画，会动的那两个也用它画成贴图，样子保持一致。
export type MapIconKind = "done" | "now" | "locked";
export function drawMapIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: MapIconKind): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fillStyle = kind === "done" ? "#3aa655" : kind === "now" ? "#e8453c" : "#9a9a9a";
  ctx.fill();
  ctx.lineWidth = s * 0.22;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "done") {
    ctx.lineWidth = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, 0);
    ctx.lineTo(-s * 0.1, s * 0.38);
    ctx.lineTo(s * 0.5, -s * 0.35);
    ctx.stroke();
  } else if (kind === "locked") {
    ctx.fillRect(-s * 0.42, -s * 0.05, s * 0.84, s * 0.6);
    ctx.lineWidth = s * 0.18;
    ctx.beginPath();
    ctx.arc(0, -s * 0.1, s * 0.28, Math.PI, 0);
    ctx.stroke();
  } else {
    ctx.lineWidth = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, s * 0.55);
    ctx.lineTo(-s * 0.3, -s * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s * 0.55);
    ctx.lineTo(s * 0.5, -s * 0.3);
    ctx.lineTo(-s * 0.3, -s * 0.05);
    ctx.fill();
  }
  ctx.restore();
}

// 跨省坐的小飞机：俯视的样子，机头朝右（0°），代码里按航线方向转。
function drawPlaneTexture(ctx: CanvasRenderingContext2D, width: number): void {
  const s = width * 0.42;
  // 上半边的轮廓（机头 → 机翼 → 尾翼 → 机尾），下半边对称
  const top: [number, number][] = [
    [1.0, 0], [0.82, -0.1], [0.2, -0.13], [-0.2, -0.85], [-0.42, -0.85], [-0.22, -0.13],
    [-0.68, -0.11], [-0.88, -0.42], [-1.02, -0.42], [-0.9, 0],
  ];
  const pts = [...top, ...top.slice(1, -1).reverse().map(([x, y]) => [x, -y] as [number, number])];
  ctx.save();
  ctx.translate(width / 2, width / 2);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = width * 0.05;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  ctx.fillStyle = "#e8453c";
  ctx.fill();
  // 驾驶舱窗户
  ctx.beginPath();
  ctx.ellipse(s * 0.62, 0, s * 0.12, s * 0.06, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#cfefff";
  ctx.fill();
  ctx.restore();
}

// 彩虹果：六瓣彩虹球 + 立体高光 + 白边 + 中间一颗白星。
// 不用 createConicGradient：老一点的 iOS 微信内置浏览器不支持，一瓣一瓣画最稳。
function drawRainbowTexture(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.36; // 水果图片里果子大约占这么大
  const colors = ["#ff4d4d", "#ff9f1c", "#ffe14d", "#4cd964", "#38b6ff", "#8e5cff"];
  colors.forEach((c, i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a0 + Math.PI / 3);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });
  const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  shade.addColorStop(0, "rgba(255,255,255,0.6)");
  shade.addColorStop(0.45, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = shade;
  ctx.fill();
  ctx.lineWidth = width * 0.025;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  // 白色五角星
  const outer = r * 0.42;
  const inner = outer * 0.45;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = width * 0.02;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawButtonTexture(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.save();
  const r = height / 2 - 9;
  ctx.fillStyle = "rgba(40, 64, 20, 0.28)";
  roundRect(ctx, 9, 13, width - 18, height - 18, r);
  ctx.fill();

  const fill = ctx.createLinearGradient(0, 6, 0, height - 16);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(0.52, "#b8b8b8");
  fill.addColorStop(1, "#6f6f6f");
  ctx.fillStyle = fill;
  roundRect(ctx, 10, 6, width - 20, height - 22, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(21, 92, 35, 0.75)";
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  roundRect(ctx, 28, 14, width - 56, 20, 14);
  ctx.fill();
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale: number,
  fill: string,
  stroke: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(24, -20, 46, -18, 54, 0);
  ctx.bezierCurveTo(34, 16, 16, 18, 0, 0);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(40, 102, 39, 0.48)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(45, 0);
  ctx.stroke();
  ctx.restore();
}
