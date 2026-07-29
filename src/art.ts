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
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  draw(ctx, width, height);
  textures.addCanvas(key, canvas);
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
