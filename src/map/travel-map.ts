// ---------------------------------------------------------------------------
// 旅行地图：左上角 🗺️ 打开看走到哪了；过关时自动弹出，小旗从这一站走到下一站。
// 只看不选关（家长的决定：点城市重玩会牵扯进度怎么存，先不做）。
//
// 三种画面：
//   全国：按省上色（走完绿 / 正在走黄 / 没到灰），走完的省打 ✓、没到的上 🔒，
//         只画走过的路线（省内实线、跨省虚弧线）。大陆居中放在屏幕正中，南海诸岛
//         和九段线在下方完整画出来。
//   点开一个省：放大这个省，每个城市标 ✓ / 🚩 / 🔒 和名字。
//   过关旅行：放大到刚过的这一站和下一站，✓ 盖上去，小旗沿路线走过去。
//
// 静态的部分（省份、路线、标记、城市名、标题和图例）画在一张自己的 2D 画布上，
// 当一张贴图显示；会动的（小旗、刚打上的 ✓、正在延长的那段路线）是 Phaser 对象。
// 画布用 willReadFrequently 放内存里（安卓切后台不丢），万一还是被清空了，
// 收到 contextrestored 就按上次的样子重画——和 art.ts 的手画贴图一个道理。
// ---------------------------------------------------------------------------
import Phaser from "phaser";
import { WIDTH, HEIGHT } from "../config";
import { REGIONS } from "../levels";
import { drawMapIcon, MAP_DONE_TEXTURE, MAP_FLAG_TEXTURE, type MapIconKind } from "../art";
import { sfx } from "../audio";
import { CITY_XY, MAINLAND, NINE_DASH, PROVINCES, type MapProvince } from "./map-data";

const RES = 1.5; // 手机上游戏画面大约放大 1.5 倍，画布按这个分辨率画才不糊
const DEPTH = 70;
const TEX = "travel-map";
const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const PANEL_TOP = 170; // 标题板下沿
const PANEL_BOTTOM = HEIGHT - 110; // 图例上沿
const SEA = "#bfe6fb";
const FILL = { done: "#8fd16f", now: "#ffd35c", locked: "#dcdcdc" } as const;

// --- 城市和省 -------------------------------------------------------------------
interface City {
  level: number;
  region: string;
  city: string;
  x: number;
  y: number;
}
const CITIES: City[] = REGIONS.flatMap((r) => r.cities.map((city) => ({ region: r.name, city }))).map((c, i) => ({
  ...c,
  level: i + 1,
  x: CITY_XY[i][0],
  y: CITY_XY[i][1],
}));
const BY_REGION = new Map<string, City[]>();
for (const c of CITIES) BY_REGION.set(c.region, [...(BY_REGION.get(c.region) ?? []), c]);

/** 外环面积（取大的那块），用来定画的先后和点击的先后。 */
function ringArea(r: number[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return Math.abs(a) / 2;
}
interface Prov extends MapProvince {
  area: number;
  box: [number, number, number, number];
}
const PROVS: Prov[] = PROVINCES.map((p) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of p.polys) {
    const r = poly[0];
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
    }
  }
  return { ...p, area: Math.max(...p.polys.map((poly) => ringArea(poly[0]))), box: [x0, y0, x1, y1] };
});
// 先画大的再画小的：北京、天津被河北包在中间，后画才不会被盖住
const DRAW_ORDER = [...PROVS].sort((a, b) => b.area - a.area);
// 点击时反过来，小的先判断
const HIT_ORDER = [...PROVS].sort((a, b) => a.area - b.area);

type Status = "done" | "now" | "locked";
/** progress = 现在在第几关：之前的都走过了。 */
function regionStatus(region: string, progress: number): Status {
  const cs = BY_REGION.get(region) ?? [];
  if (cs.every((c) => c.level < progress)) return "done";
  if (cs.some((c) => c.level <= progress)) return "now";
  return "locked";
}

// --- 视图：地图上的点 (cx, cy) 放到屏幕 (WIDTH/2, sy)，放大 k 倍 ------------------
interface View {
  k: number;
  cx: number;
  cy: number;
  sy: number;
}
const NATIONAL: View = { k: 1, cx: WIDTH / 2, cy: (MAINLAND[1] + MAINLAND[3]) / 2, sy: HEIGHT / 2 };
const toScreen = (v: View, x: number, y: number): [number, number] => [(x - v.cx) * v.k + WIDTH / 2, (y - v.cy) * v.k + v.sy];
const toMap = (v: View, sx: number, sy: number): [number, number] => [(sx - WIDTH / 2) / v.k + v.cx, (sy - v.sy) / v.k + v.cy];

/** 把地图上这一块放大到标题和图例之间。直辖市、港澳很小，封顶别放太大。 */
function fitView(x0: number, y0: number, x1: number, y1: number, maxK: number): View {
  const k = Math.min(maxK, (WIDTH - 140) / Math.max(x1 - x0, 1), (PANEL_BOTTOM - PANEL_TOP - 180) / Math.max(y1 - y0, 1));
  return { k: Math.max(1, k), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, sy: (PANEL_TOP + PANEL_BOTTOM) / 2 };
}

/** 两站之间的路线：同一个省走直线，跨省画一道往上拱的弧（像坐飞机）。 */
function routePoint(a: City, b: City, t: number): [number, number] {
  if (a.region === b.region) return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
  const [mx, my] = arcControl(a, b);
  const u = 1 - t;
  return [u * u * a.x + 2 * u * t * mx + t * t * b.x, u * u * a.y + 2 * u * t * my + t * t * b.y];
}
function arcControl(a: City, b: City): [number, number] {
  return [(a.x + b.x) / 2, (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.18];
}

// --- 画布 -----------------------------------------------------------------------
interface Frame {
  progress: number;
  view: View;
  /** 点开的省：只标这个省的城市，别的省变浅 */
  focus?: string;
  /** 过关旅行：这一关的那段路线、这两站的标记由动画来画 */
  travelTo?: number;
  /** 只给这几个省的城市标名字（过关旅行：出发和到达的省），别的城市只画小圆点 */
  labelRegions?: string[];
  title: string;
  subtitle: string;
  legend: "provinces" | "cities";
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let lastFrame: Frame | null = null;

function ensureTexture(scene: Phaser.Scene): void {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = WIDTH * RES;
    canvas.height = HEIGHT * RES;
    ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.addEventListener("contextrestored", () => {
      if (lastFrame && ctx) paint(ctx, lastFrame);
      (scene.textures.get(TEX) as Phaser.Textures.CanvasTexture | undefined)?.refresh();
    });
  }
  if (!scene.textures.exists(TEX)) scene.textures.addCanvas(TEX, canvas);
}

function draw(scene: Phaser.Scene, f: Frame): void {
  ensureTexture(scene);
  if (!ctx) return;
  lastFrame = f;
  paint(ctx, f);
  (scene.textures.get(TEX) as Phaser.Textures.CanvasTexture).refresh();
}

function tracePolys(g: CanvasRenderingContext2D, v: View, polys: number[][][]): void {
  g.beginPath();
  for (const poly of polys) {
    for (const r of poly) {
      for (let i = 0; i < r.length; i += 2) {
        const [x, y] = toScreen(v, r[i], r[i + 1]);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }
  }
}

function paint(g: CanvasRenderingContext2D, f: Frame): void {
  const v = f.view;
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.fillStyle = SEA;
  g.fillRect(0, 0, WIDTH, HEIGHT);

  // 省
  for (const p of DRAW_ORDER) {
    tracePolys(g, v, p.polys);
    g.fillStyle = f.focus ? (p.name === f.focus ? "#fff7d6" : "#e8e8e8") : FILL[regionStatus(p.name, f.progress)];
    g.fill("evenodd");
    g.lineWidth = 1;
    g.strokeStyle = "#ffffff";
    g.stroke();
  }
  // 九段线
  tracePolys(g, v, NINE_DASH.map((r) => [r]));
  g.fillStyle = "#3d5f80";
  g.fill();
  g.lineWidth = 0.8;
  g.strokeStyle = "#3d5f80";
  g.stroke();

  // 走过的路线
  for (let i = 1; i < CITIES.length; i++) {
    const a = CITIES[i - 1], b = CITIES[i];
    if (b.level > f.progress || b.level === f.travelTo) continue;
    const [x1, y1] = toScreen(v, a.x, a.y);
    const [x2, y2] = toScreen(v, b.x, b.y);
    g.beginPath();
    g.moveTo(x1, y1);
    if (a.region === b.region) {
      g.lineTo(x2, y2);
      g.setLineDash([]);
    } else {
      const [mx, my] = toScreen(v, ...arcControl(a, b));
      g.quadraticCurveTo(mx, my, x2, y2);
      g.setLineDash([6, 6]);
    }
    g.lineWidth = 3;
    g.strokeStyle = "#e8703c";
    g.stroke();
  }
  g.setLineDash([]);

  // 城市标记
  const labelSet = f.focus ? [f.focus] : f.labelRegions;
  const detail = !!labelSet || v.k >= 2.5;
  const labeled = CITIES.filter((c) => {
    if (!detail) return false;
    if (labelSet) return labelSet.includes(c.region);
    const [x, y] = toScreen(v, c.x, c.y);
    return x > 20 && x < WIDTH - 20 && y > PANEL_TOP && y < PANEL_BOTTOM;
  });
  const animated = new Set(f.travelTo ? [f.travelTo - 1, f.travelTo] : []);
  const kindOf = (c: City): MapIconKind => (c.level < f.progress ? "done" : c.level === f.progress ? "now" : "locked");
  // 小圆点：没单独标出来的城市
  for (const c of CITIES) {
    if (labeled.includes(c) || animated.has(c.level) || c.level === f.progress) continue;
    const [x, y] = toScreen(v, c.x, c.y);
    g.beginPath();
    g.arc(x, y, 2.6, 0, Math.PI * 2);
    g.fillStyle = c.level < f.progress ? "#2f8f45" : "#8d8d8d";
    g.fill();
  }
  if (!detail) {
    // 全国图：每个省一个 ✓ / 🔒（正在走的省有小旗，不另外标）
    for (const [region, cs] of BY_REGION) {
      const st = regionStatus(region, f.progress);
      if (st === "now") continue;
      const sx = cs.reduce((s, c) => s + c.x, 0) / cs.length;
      const sy = cs.reduce((s, c) => s + c.y, 0) / cs.length;
      const [x, y] = toScreen(v, sx, sy);
      drawMapIcon(g, x, y - 12, st === "done" ? 8 : 7, st === "done" ? "done" : "locked");
    }
  } else {
    const R = 15;
    const pts = labeled.map((c) => ({ c, xy: toScreen(v, c.x, c.y) }));
    for (const p of pts) {
      if (animated.has(p.c.level) || p.c.level === f.progress) continue; // 小旗、刚打的 ✓ 是动画
      drawMapIcon(g, p.xy[0], p.xy[1], R, kindOf(p.c));
    }
    placeLabels(g, pts, R, new Set([f.progress, ...animated]));
  }

  drawPanels(g, f);
}

/** 城市名：下、上、右、左……挨个试，挑第一个不压着别人的位置。 */
function placeLabels(g: CanvasRenderingContext2D, pts: { c: City; xy: [number, number] }[], R: number, flags: Set<number>): void {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  // 插小旗的城市，小旗在城市上方还会往上跳，名字别放到那块去
  const taken: Box[] = pts.map(({ c, xy: [x, y] }) => ({ x0: x - R, y0: y - R - (flags.has(c.level) ? 34 : 0), x1: x + R, y1: y + R }));
  const hit = (b: Box) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
  g.font = `bold 24px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const { c, xy: [x, y] } of pts) {
    const w = g.measureText(c.city).width, h = 26;
    const cands: [number, number][] = [
      [0, R + 4 + h / 2], [0, -R - 4 - h / 2], [R + 6 + w / 2, 0], [-R - 6 - w / 2, 0],
      [R + w / 2, R + h / 2 + 2], [-R - w / 2, R + h / 2 + 2], [R + w / 2, -R - h / 2 - 2], [-R - w / 2, -R - h / 2 - 2],
      [0, R + 34 + h / 2], [0, -R - 34 - h / 2],
    ];
    let [dx, dy] = cands[0];
    for (const [cx, cy] of cands) {
      const b = { x0: x + cx - w / 2, y0: y + cy - h / 2, x1: x + cx + w / 2, y1: y + cy + h / 2 };
      if (!hit(b)) {
        [dx, dy] = [cx, cy];
        break;
      }
    }
    taken.push({ x0: x + dx - w / 2, y0: y + dy - h / 2, x1: x + dx + w / 2, y1: y + dy + h / 2 });
    g.lineWidth = 6;
    g.strokeStyle = "#ffffff";
    g.strokeText(c.city, x + dx, y + dy);
    g.fillStyle = "#4a3214";
    g.fillText(c.city, x + dx, y + dy);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPanels(g: CanvasRenderingContext2D, f: Frame): void {
  // 标题板
  g.fillStyle = "rgba(253,246,227,0.94)";
  roundRect(g, 24, 30, WIDTH - 48, 116, 24);
  g.fill();
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = "#8a5a24";
  g.font = `bold 40px ${FONT}`;
  g.fillText(f.title, WIDTH / 2, 84);
  g.fillStyle = "#a8823f";
  g.font = `24px ${FONT}`;
  g.fillText(f.subtitle, WIDTH / 2, 124);

  // 图例
  g.fillStyle = "rgba(253,246,227,0.94)";
  roundRect(g, 60, HEIGHT - 92, WIDTH - 120, 56, 28);
  g.fill();
  g.font = `22px ${FONT}`;
  g.textAlign = "left";
  g.textBaseline = "middle";
  const y = HEIGHT - 64;
  if (f.legend === "provinces") {
    ([["done", "走完的省"], ["now", "正在走"], ["locked", "还没到"]] as const).forEach(([k, t], i) => {
      const x = 128 + i * 170;
      g.fillStyle = FILL[k];
      roundRect(g, x, y - 11, 22, 22, 5);
      g.fill();
      g.fillStyle = "#6b4a1f";
      g.fillText(t, x + 30, y);
    });
  } else {
    ([["done", "走过"], ["now", "现在在这"], ["locked", "还没到"]] as const).forEach(([k, t], i) => {
      const x = 150 + i * 160;
      drawMapIcon(g, x, y, 11, k);
      g.fillStyle = "#6b4a1f";
      g.fillText(t, x + 20, y);
    });
  }
  g.fillStyle = "rgba(107,74,31,0.55)";
  g.font = `14px ${FONT}`;
  g.textAlign = "center";
  g.fillText("地图数据：阿里云 DataV", WIDTH / 2, HEIGHT - 20);
}

// --- 浮层 -----------------------------------------------------------------------
export type TravelMapOpts =
  | { mode: "browse"; level: number; onClose: () => void }
  | { mode: "travel"; from: number; onGo: () => void };

/** 打开旅行地图。期间游戏由调用方暂停（和答题面板一样）。 */
export function openTravelMap(scene: Phaser.Scene, opts: TravelMapOpts): void {
  const layer = scene.add.container(0, 0).setDepth(DEPTH);
  ensureTexture(scene);
  const img = scene.add.image(0, 0, TEX).setOrigin(0).setDisplaySize(WIDTH, HEIGHT).setInteractive();
  const anim = scene.add.container(0, 0); // 小旗、✓、正在延长的路线
  layer.add([img, anim]);

  const flagAt = (v: View, c: City): Phaser.GameObjects.Image => {
    const [x, y] = toScreen(v, c.x, c.y);
    const flag = scene.add.image(x, y - 6, MAP_FLAG_TEXTURE).setScale(0.42);
    // 轻轻上下跳，一眼看出「我在这」
    scene.tweens.add({ targets: flag, y: y - 16, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    anim.add(flag);
    return flag;
  };

  const button = (x: number, y: number, label: string, onClick: () => void, small = false): Phaser.GameObjects.Container => {
    const h = small ? 46 : 68;
    const txt = scene.add
      .text(0, 0, label, { fontFamily: FONT, fontSize: small ? "22px" : "30px", fontStyle: "bold", color: "#ffffff", padding: { top: 6, bottom: 6 } })
      .setOrigin(0.5);
    const w = Math.ceil(txt.width) + (small ? 30 : 44);
    const bg = scene.add.graphics();
    const [fill, edge] = small ? [0xc98f4a, 0x8a5a24] : [0x3aa655, 0x24602a];
    bg.fillStyle(fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    bg.lineStyle(3, edge, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const c = scene.add.container(x, y, [bg, txt]).setSize(w, h).setInteractive({ useHandCursor: true });
    c.on("pointerdown", (_p: unknown, _x: unknown, _y: unknown, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick();
    });
    layer.add(c);
    return c;
  };

  if (opts.mode === "browse") browse(scene, layer, img, anim, opts, flagAt, button);
  else travel(scene, layer, img, anim, opts, flagAt, button);
}

type FlagAt = (v: View, c: City) => Phaser.GameObjects.Image;

/** 小旗一直在上下跳（repeat: -1），对象销毁前先把它身上的补间停掉。 */
function clearAnim(scene: Phaser.Scene, anim: Phaser.GameObjects.Container): void {
  scene.tweens.killTweensOf(anim.list);
  anim.removeAll(true);
}
function destroyLayer(scene: Phaser.Scene, layer: Phaser.GameObjects.Container): void {
  const all: Phaser.GameObjects.GameObject[] = [];
  const walk = (c: Phaser.GameObjects.Container) => c.list.forEach((o) => { all.push(o); if (o instanceof Phaser.GameObjects.Container) walk(o); });
  walk(layer);
  scene.tweens.killTweensOf(all);
  layer.destroy(true);
}
type MakeButton = (x: number, y: number, label: string, onClick: () => void, small?: boolean) => Phaser.GameObjects.Container;

function browse(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  img: Phaser.GameObjects.Image,
  anim: Phaser.GameObjects.Container,
  opts: { level: number; onClose: () => void },
  flagAt: FlagAt,
  button: MakeButton,
): void {
  const progress = opts.level;
  const here = CITIES[Math.min(progress, CITIES.length) - 1];
  let view = NATIONAL;
  let back: Phaser.GameObjects.Container | null = null;

  const showNational = () => {
    view = NATIONAL;
    draw(scene, {
      progress, view, legend: "provinces", title: "🗺️ 旅行地图",
      subtitle: `走过 ${progress - 1} / ${CITIES.length} 站 · 现在在 ${here.region}-${here.city}`,
    });
    clearAnim(scene, anim);
    flagAt(view, here);
    back?.destroy();
    back = null;
  };
  const showRegion = (region: string) => {
    const p = PROVS.find((q) => q.name === region)!;
    const cs = BY_REGION.get(region)!;
    // 框住整个省和它的城市（城市都在省里，框省就够了），直辖市和港澳封顶放大 10 倍
    view = fitView(...p.box, 10);
    const walked = cs.filter((c) => c.level < progress).length;
    const st = regionStatus(region, progress);
    draw(scene, {
      progress, view, focus: region, legend: "cities", title: region,
      subtitle: st === "done" ? `全部走完啦 · ${cs.length} 站` : st === "locked" ? `还没到 · 一共 ${cs.length} 站` : `走过 ${walked} / ${cs.length} 站`,
    });
    clearAnim(scene, anim);
    if (here.region === region) flagAt(view, here);
    if (!back) {
      back = button(98, 70, "← 全国", showNational, true);
    }
  };

  // 点省份：小的先判断（北京在河北中间）；点不中任何省就找最近的城市
  img.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    const [mx, my] = toMap(view, pointer.x, pointer.y);
    const hit = HIT_ORDER.find((p) => pointIn(p, mx, my));
    let region = hit?.name;
    if (!region) {
      let best = 36 / view.k;
      for (const c of CITIES) {
        const d = Math.hypot(c.x - mx, c.y - my);
        if (d < best) {
          best = d;
          region = c.region;
        }
      }
    }
    if (region && BY_REGION.has(region)) showRegion(region);
    else if (view !== NATIONAL) showNational();
  });

  button(WIDTH - 82, 70, "关闭 ✕", () => {
    destroyLayer(scene, layer);
    opts.onClose();
  }, true);
  showNational();
}

function pointIn(p: Prov, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = p.box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  let inside = false;
  for (const poly of p.polys) {
    for (const r of poly) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

function travel(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  img: Phaser.GameObjects.Image,
  anim: Phaser.GameObjects.Container,
  opts: { from: number; onGo: () => void },
  flagAt: FlagAt,
  button: MakeButton,
): void {
  const a = CITIES[opts.from - 1];
  const b = CITIES[opts.from]; // 调用方保证还有下一站（走完全国是另一套结局）
  const finished = a.region !== b.region && regionStatus(a.region, b.level) === "done";
  // 框住出发和到达的省（同一个省就是这个省），和点开省份看到的一样；
  // 西藏飞台湾这种两个省离得远，自然就缩成接近全国
  const pa = PROVS.find((p) => p.name === a.region)!.box;
  const pb = PROVS.find((p) => p.name === b.region)!.box;
  const view = fitView(Math.min(pa[0], pb[0]), Math.min(pa[1], pb[1]), Math.max(pa[2], pb[2]), Math.max(pa[3], pb[3]), 10);
  draw(scene, {
    progress: b.level, view, travelTo: b.level, labelRegions: [a.region, b.region], legend: "cities", title: "恭喜过关！",
    subtitle: finished ? `${a.region}走完啦！下一站：${b.region}-${b.city}` : `下一站：${b.region}-${b.city}`,
  });

  // 刚过的这站盖个 ✓
  const [ax, ay] = toScreen(view, a.x, a.y);
  const check = scene.add.image(ax, ay, MAP_DONE_TEXTURE).setScale(0);
  anim.add(check);
  scene.tweens.add({ targets: check, scale: 0.42, duration: 320, ease: "Back.easeOut" });
  sfx.unlock();

  // 路线一点点画出来，小旗跟着走
  const line = scene.add.graphics();
  const flag = scene.add.image(ax, ay - 6, MAP_FLAG_TEXTURE).setScale(0.42);
  anim.add([line, flag]);
  const state = { t: 0 };
  const redraw = () => {
    line.clear();
    line.lineStyle(3, 0xe8703c, 1);
    const steps = 24;
    line.beginPath();
    for (let i = 0; i <= steps; i++) {
      const [x, y] = toScreen(view, ...routePoint(a, b, (state.t * i) / steps));
      if (i === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    }
    line.strokePath();
    const [fx, fy] = toScreen(view, ...routePoint(a, b, state.t));
    flag.setPosition(fx, fy - 6 - Math.sin(state.t * Math.PI) * 18); // 走的时候蹦一下
  };
  const walk = scene.tweens.add({
    targets: state,
    t: 1,
    delay: 450,
    duration: a.region === b.region ? 1100 : 1600,
    ease: "Sine.easeInOut",
    onUpdate: redraw,
    onComplete: arrive,
  });

  let arrived = false;
  function arrive(): void {
    if (arrived) return;
    arrived = true;
    state.t = 1;
    redraw();
    flag.destroy();
    flagAt(view, b);
    sfx.match(2);
    const go = button(WIDTH / 2, HEIGHT - 170, `出发去${b.city} →`, () => {
      destroyLayer(scene, layer);
      opts.onGo();
    });
    go.setScale(0);
    scene.tweens.add({ targets: go, scale: 1, duration: 260, ease: "Back.easeOut" });
  }
  // 着急的话点一下直接到
  img.on("pointerdown", () => {
    if (arrived) return;
    walk.stop();
    check.setScale(0.42);
    arrive();
  });
}
