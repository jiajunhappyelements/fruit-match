// ---------------------------------------------------------------------------
// 旅行地图：左上角 🗺️ 打开看走到哪了；过关时自动弹出，播一段「旅行」动画。
// 只看不选关（家长的决定：点城市重玩会牵扯进度怎么存，先不做）。
//
// 画面：
//   全国：按省上色（走完绿 / 正在走黄 / 没到灰），走完的省打 ✓、没到的上 🔒，
//         只画走过的路线（省内实线、跨省虚弧线）。大陆居中放在屏幕正中，南海诸岛
//         和九段线在下方完整画出来。
//   点开一个省：放大这个省，每个城市标 ✓ / 🚩 / 🔒 和名字。
//
// 过关动画：
//   同一个省里走下一站：就在这个省的详细图里，✓ 盖上去，小旗沿路线走过去。
//   跨省（家长定的顺序——在详细图里跨省飞很怪，飞要在全国图上飞）：
//     ① 详细图里最后一站盖 ✓   ② 镜头拉远到全国   ③ 这个省「刷」地变绿，「XX 全部走完啦」
//     ④ 小飞机沿虚线弧飞到下一个省   ⑤ 落地变回小旗，新省亮成黄色，「欢迎来到 XX」
//     ⑥ 镜头推近到新省的详细图   ⑦ 小旗从天上插到第一站，出「出发」按钮
//   任何时候点一下屏幕，直接跳到最后。
//
// 实现：
//   地图本身（省份、路线、城市标记、城市名）画在自己的 2D 画布上当贴图；标题、图例、
//   按钮、小旗、飞机、正在画的航线是 Phaser 对象——换标题不用重画地图。
//   有两张画布，镜头推拉时两张图同时在屏幕上（一张淡出一张淡入），像真的镜头。
//   「这个省变色」= 再叠一张「变化之后」的全国图，用这个省的轮廓当遮罩慢慢显出来，
//   省里已经画好的路线和城市点原样保留，不用每一帧重画整张地图。
//   画布用 willReadFrequently 放内存里（安卓切后台不丢），万一还是被清空了，
//   收到 contextrestored 就按上次的样子重画——和 art.ts 的手画贴图一个道理。
// ---------------------------------------------------------------------------
import Phaser from "phaser";
import { WIDTH, HEIGHT } from "../config";
import { REGIONS } from "../levels";
import {
  drawMapIcon,
  MAP_DONE_TEXTURE,
  MAP_FLAG_TEXTURE,
  MAP_LOCK_TEXTURE,
  MAP_PLANE_TEXTURE,
  type MapIconKind,
} from "../art";
import { sfx } from "../audio";
import { CITY_XY, MAINLAND, NINE_DASH, PROVINCES, type MapProvince } from "./map-data";

const RES = 1.5; // 手机上游戏画面大约放大 1.5 倍，画布按这个分辨率画才不糊
const DEPTH = 70;
const FONT = '-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const PANEL_TOP = 170; // 标题板下沿
const PANEL_BOTTOM = HEIGHT - 110; // 图例上沿
const SEA = "#bfe6fb";
const FILL = { done: "#8fd16f", now: "#ffd35c", locked: "#dcdcdc" } as const;
const ICON_SCALE = 0.42; // 小旗 / ✓ 贴图（96px）在详细图里的大小
const ICON_SCALE_NATIONAL = 0.34; // 全国图上小一点

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
const provOf = (name: string): Prov => PROVS.find((p) => p.name === name)!;
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

// --- 视图（镜头）：地图上的点 (cx, cy) 放到屏幕 (WIDTH/2, sy)，放大 k 倍 -------------
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
const provinceView = (name: string): View => fitView(...provOf(name).box, 10);
const boxCenter = (name: string): [number, number] => {
  const [x0, y0, x1, y1] = provOf(name).box;
  return [(x0 + x1) / 2, (y0 + y1) / 2];
};

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

// --- 地图画布 -------------------------------------------------------------------
interface Frame {
  progress: number;
  view: View;
  /** 点开的省：只标这个省的城市，别的省变浅 */
  focus?: string;
  /** 只给这几个省的城市标名字，别的城市只画小圆点 */
  labelRegions?: string[];
  /** 这几关的城市标记由动画来画（小旗、刚打上的 ✓），画布上不画 */
  hide?: number[];
  /** 通往这一关的那段路线由动画来画 */
  skipRoute?: number;
}

/** 一张地图画布 + 它的贴图。记着自己是按哪个镜头画的，放进别的镜头时要换算。 */
class MapSheet {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private last: Frame | null = null;
  view: View = NATIONAL;
  constructor(readonly key: string) {}

  draw(scene: Phaser.Scene, f: Frame): void {
    const textures = scene.textures;
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.width = WIDTH * RES;
      c.height = HEIGHT * RES;
      this.canvas = c;
      this.ctx = c.getContext("2d", { willReadFrequently: true });
      c.addEventListener("contextrestored", () => {
        if (this.last && this.ctx) paint(this.ctx, this.last);
        if (textures.exists(this.key)) (textures.get(this.key) as Phaser.Textures.CanvasTexture).refresh();
      });
    }
    if (!textures.exists(this.key)) textures.addCanvas(this.key, this.canvas);
    if (!this.ctx) return;
    this.last = f;
    this.view = f.view;
    paint(this.ctx, f);
    (textures.get(this.key) as Phaser.Textures.CanvasTexture).refresh();
  }

  /** 一张显示这张画布的图片（记下画的时候用的镜头）。 */
  image(scene: Phaser.Scene): Phaser.GameObjects.Image {
    return scene.add.image(0, 0, this.key).setOrigin(0).setScale(1 / RES).setData("view", this.view);
  }
}
const SHEET_1 = new MapSheet("travel-map");
const SHEET_2 = new MapSheet("travel-map-2");

/** 按 rendered 镜头画的图，放到 cam 镜头下该在的位置和大小。 */
function placeSheet(img: Phaser.GameObjects.Image, cam: View): void {
  const rendered = img.getData("view") as View;
  const [mx, my] = toMap(rendered, 0, 0);
  const [sx, sy] = toScreen(cam, mx, my);
  img.setPosition(sx, sy).setScale(cam.k / rendered.k / RES);
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
    if (b.level > f.progress || b.level === f.skipRoute) continue;
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
  const hidden = new Set(f.hide ?? []);
  const kindOf = (c: City): MapIconKind => (c.level < f.progress ? "done" : c.level === f.progress ? "now" : "locked");
  // 小圆点：没单独标出来的城市（现在这站有小旗，不画点）
  for (const c of CITIES) {
    if (labeled.includes(c) || hidden.has(c.level) || c.level === f.progress) continue;
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
      if (hidden.has(p.c.level) || p.c.level === f.progress) continue; // 小旗、刚打的 ✓ 是动画
      drawMapIcon(g, p.xy[0], p.xy[1], R, kindOf(p.c));
    }
    placeLabels(g, pts, R, new Set([f.progress, ...hidden]));
  }
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

// --- 浮层：标题、图例、按钮 -----------------------------------------------------
interface Overlay {
  scene: Phaser.Scene;
  layer: Phaser.GameObjects.Container;
  /** 地图图片 */
  maps: Phaser.GameObjects.Container;
  /** 小旗、飞机、航线、光圈 */
  anim: Phaser.GameObjects.Container;
  /** 全屏透明点击层：浏览时点省份，旅行时跳过动画 */
  hit: Phaser.GameObjects.Rectangle;
  setTitle(title: string, subtitle: string, pop?: boolean): void;
  setLegend(kind: "provinces" | "cities"): void;
  button(x: number, y: number, label: string, onClick: () => void, small?: boolean): Phaser.GameObjects.Container;
  /** 关掉浮层（停掉动画、销毁对象、清理遮罩） */
  close(): void;
  onClose(fn: () => void): void;
}

function makeOverlay(scene: Phaser.Scene): Overlay {
  const layer = scene.add.container(0, 0).setDepth(DEPTH);
  const maps = scene.add.container(0, 0);
  const hit = scene.add.rectangle(0, 0, WIDTH, HEIGHT, 0x000000, 0).setOrigin(0).setInteractive();
  const anim = scene.add.container(0, 0);
  const ui = scene.add.container(0, 0);
  layer.add([maps, hit, anim, ui]);

  const top = scene.add.graphics();
  top.fillStyle(0xfdf6e3, 0.94).fillRoundedRect(24, 30, WIDTH - 48, 116, 24);
  const title = scene.add
    .text(WIDTH / 2, 70, "", { fontFamily: FONT, fontSize: "40px", fontStyle: "bold", color: "#8a5a24", padding: { top: 6, bottom: 6 } })
    .setOrigin(0.5);
  const sub = scene.add
    .text(WIDTH / 2, 117, "", { fontFamily: FONT, fontSize: "24px", color: "#a8823f", padding: { top: 4, bottom: 4 } })
    .setOrigin(0.5);

  const legendBg = scene.add.graphics();
  legendBg.fillStyle(0xfdf6e3, 0.94).fillRoundedRect(60, HEIGHT - 92, WIDTH - 120, 56, 28);
  const ly = HEIGHT - 64;
  const label = (x: number, t: string) =>
    scene.add.text(x, ly, t, { fontFamily: FONT, fontSize: "22px", color: "#6b4a1f", padding: { top: 4, bottom: 4 } }).setOrigin(0, 0.5);
  const provLegend = scene.add.container(0, 0);
  ([["done", "走完的省"], ["now", "正在走"], ["locked", "还没到"]] as const).forEach(([k, t], i) => {
    const x = 128 + i * 170;
    const sq = scene.add.graphics();
    sq.fillStyle(Phaser.Display.Color.HexStringToColor(FILL[k]).color, 1).fillRoundedRect(x, ly - 11, 22, 22, 5);
    provLegend.add([sq, label(x + 30, t)]);
  });
  const cityLegend = scene.add.container(0, 0);
  ([[MAP_DONE_TEXTURE, "走过"], [MAP_FLAG_TEXTURE, "现在在这"], [MAP_LOCK_TEXTURE, "还没到"]] as const).forEach(([tex, t], i) => {
    const x = 150 + i * 160;
    cityLegend.add([scene.add.image(x, ly, tex).setScale(0.3), label(x + 20, t)]);
  });
  const credit = scene.add
    .text(WIDTH / 2, HEIGHT - 20, "地图数据：阿里云 DataV", { fontFamily: FONT, fontSize: "14px", color: "#6b4a1f" })
    .setOrigin(0.5)
    .setAlpha(0.55);
  ui.add([top, title, sub, legendBg, provLegend, cityLegend, credit]);

  const closers: (() => void)[] = [];
  const o: Overlay = {
    scene, layer, maps, anim, hit,
    setTitle(t, s, pop = false) {
      title.setText(t);
      sub.setText(s);
      if (pop) {
        scene.tweens.killTweensOf(title);
        title.setScale(1.3);
        scene.tweens.add({ targets: title, scale: 1, duration: 320, ease: "Back.easeOut" });
      }
    },
    setLegend(kind) {
      provLegend.setVisible(kind === "provinces");
      cityLegend.setVisible(kind === "cities");
    },
    button(x, y, text, onClick, small = false) {
      const h = small ? 46 : 68;
      const txt = scene.add
        .text(0, 0, text, { fontFamily: FONT, fontSize: small ? "22px" : "30px", fontStyle: "bold", color: "#ffffff", padding: { top: 6, bottom: 6 } })
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
      ui.add(c);
      return c;
    },
    close() {
      closers.splice(0).forEach((fn) => fn());
      const all: Phaser.GameObjects.GameObject[] = [];
      const walk = (c: Phaser.GameObjects.Container) =>
        c.list.forEach((x) => {
          all.push(x);
          if (x instanceof Phaser.GameObjects.Container) walk(x);
        });
      walk(layer);
      scene.tweens.killTweensOf(all);
      layer.destroy(true);
    },
    onClose(fn) {
      closers.push(fn);
    },
  };
  return o;
}

/** 小旗：在 (x, y) 这个屏幕位置轻轻上下跳，一眼看出「我在这」。 */
function bobbingFlag(o: Overlay, x: number, y: number, scale = ICON_SCALE): Phaser.GameObjects.Image {
  const flag = o.scene.add.image(x, y - 6, MAP_FLAG_TEXTURE).setScale(scale);
  o.scene.tweens.add({ targets: flag, y: y - 16, duration: 520, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  o.anim.add(flag);
  return flag;
}

function clearAnim(o: Overlay): void {
  o.scene.tweens.killTweensOf(o.anim.list);
  o.anim.removeAll(true);
}

// --- 入口 -----------------------------------------------------------------------
export type TravelMapOpts =
  | { mode: "browse"; level: number; onClose: () => void }
  | { mode: "travel"; from: number; onGo: () => void };

/** 打开旅行地图。期间游戏由调用方暂停（和答题面板一样）。 */
export function openTravelMap(scene: Phaser.Scene, opts: TravelMapOpts): void {
  const o = makeOverlay(scene);
  if (opts.mode === "browse") browse(o, opts);
  else {
    const a = CITIES[opts.from - 1];
    const b = CITIES[opts.from]; // 调用方保证还有下一站（走完全国是另一套结局）
    if (a.region === b.region) sameProvince(o, a, b, opts.onGo);
    else crossProvince(o, a, b, opts.onGo);
  }
}

// --- 浏览 -----------------------------------------------------------------------
function browse(o: Overlay, opts: { level: number; onClose: () => void }): void {
  const { scene } = o;
  const progress = opts.level;
  const here = CITIES[Math.min(progress, CITIES.length) - 1];
  let view = NATIONAL;
  let back: Phaser.GameObjects.Container | null = null;
  SHEET_1.draw(scene, { progress, view });
  const img = SHEET_1.image(scene);
  o.maps.add(img);

  const show = (v: View, f: Frame) => {
    view = v;
    SHEET_1.draw(scene, f);
    img.setData("view", v);
    placeSheet(img, v);
    clearAnim(o);
  };
  const showNational = () => {
    show(NATIONAL, { progress, view: NATIONAL });
    o.setTitle("🗺️ 旅行地图", `走过 ${progress - 1} / ${CITIES.length} 站 · 现在在 ${here.region}-${here.city}`);
    o.setLegend("provinces");
    bobbingFlag(o, ...toScreen(NATIONAL, here.x, here.y), ICON_SCALE_NATIONAL);
    back?.destroy();
    back = null;
  };
  const showRegion = (region: string) => {
    const v = provinceView(region);
    show(v, { progress, view: v, focus: region });
    const cs = BY_REGION.get(region)!;
    const walked = cs.filter((c) => c.level < progress).length;
    const st = regionStatus(region, progress);
    o.setTitle(region, st === "done" ? `全部走完啦 · ${cs.length} 站` : st === "locked" ? `还没到 · 一共 ${cs.length} 站` : `走过 ${walked} / ${cs.length} 站`);
    o.setLegend("cities");
    if (here.region === region) bobbingFlag(o, ...toScreen(v, here.x, here.y));
    if (!back) back = o.button(98, 70, "← 全国", showNational, true);
  };

  // 点省份：小的先判断（北京在河北中间）；点不中任何省就找最近的城市
  o.hit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
    const [mx, my] = toMap(view, pointer.x, pointer.y);
    let region = HIT_ORDER.find((p) => pointIn(p, mx, my))?.name;
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

  o.button(WIDTH - 82, 70, "关闭 ✕", () => {
    o.close();
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

/** 「出发去 X」按钮，弹出来。 */
function goButton(o: Overlay, b: City, onGo: () => void): void {
  const go = o.button(WIDTH / 2, HEIGHT - 170, `出发去${b.city} →`, () => {
    o.close();
    onGo();
  });
  go.setScale(0);
  o.scene.tweens.add({ targets: go, scale: 1, duration: 260, ease: "Back.easeOut" });
}

// --- 同一个省里走下一站：就在这个省的详细图里走 ------------------------------------
function sameProvince(o: Overlay, a: City, b: City, onGo: () => void): void {
  const { scene } = o;
  const view = provinceView(a.region);
  SHEET_1.draw(scene, { progress: b.level, view, labelRegions: [a.region], hide: [a.level, b.level], skipRoute: b.level });
  o.maps.add(SHEET_1.image(scene));
  o.setTitle("恭喜过关！", `下一站：${b.region}-${b.city}`);
  o.setLegend("cities");

  // 刚过的这站盖个 ✓
  const [ax, ay] = toScreen(view, a.x, a.y);
  const check = scene.add.image(ax, ay, MAP_DONE_TEXTURE).setScale(0);
  o.anim.add(check);
  scene.tweens.add({ targets: check, scale: ICON_SCALE, duration: 320, ease: "Back.easeOut" });
  sfx.unlock();

  // 路线一点点画出来，小旗跟着走
  const line = scene.add.graphics();
  const flag = scene.add.image(ax, ay - 6, MAP_FLAG_TEXTURE).setScale(ICON_SCALE);
  o.anim.add([line, flag]);
  const state = { t: 0 };
  const redraw = () => {
    line.clear();
    line.lineStyle(3, 0xe8703c, 1);
    line.beginPath();
    for (let i = 0; i <= 24; i++) {
      const [x, y] = toScreen(view, ...routePoint(a, b, (state.t * i) / 24));
      if (i === 0) line.moveTo(x, y);
      else line.lineTo(x, y);
    }
    line.strokePath();
    const [fx, fy] = toScreen(view, ...routePoint(a, b, state.t));
    flag.setPosition(fx, fy - 6 - Math.sin(state.t * Math.PI) * 18); // 走的时候蹦一下
  };
  const walk = scene.tweens.add({
    targets: state, t: 1, delay: 450, duration: 1100, ease: "Sine.easeInOut",
    onUpdate: redraw, onComplete: arrive,
  });

  let arrived = false;
  function arrive(): void {
    if (arrived) return;
    arrived = true;
    state.t = 1;
    redraw();
    flag.destroy();
    bobbingFlag(o, ...toScreen(view, b.x, b.y));
    sfx.match(2);
    goButton(o, b, onGo);
  }
  // 着急的话点一下直接到
  o.hit.on("pointerdown", () => {
    if (arrived) return;
    walk.stop();
    check.setScale(ICON_SCALE);
    arrive();
  });
}

// --- 跨省：详细图 → 全国图上飞过去 → 新省的详细图 ---------------------------------
function crossProvince(o: Overlay, a: City, b: City, onGo: () => void): void {
  const { scene } = o;
  const VA = provinceView(a.region);
  const VB = provinceView(b.region);
  const regionNo = (name: string) => REGIONS.findIndex((r) => r.name === name) + 1;
  const total = REGIONS.length;

  // 镜头：所有地图图片、钉在地图上的小旗/飞机、航线都跟着它走
  let cam: View = VA;
  const sheets: Phaser.GameObjects.Image[] = [];
  const pinned: { obj: Phaser.GameObjects.Image; x: number; y: number; dy: number }[] = [];
  const trail = scene.add.graphics();
  o.anim.add(trail);
  let trailT = 0;
  const apply = () => {
    for (const img of sheets) placeSheet(img, cam);
    for (const p of pinned) {
      const [x, y] = toScreen(cam, p.x, p.y);
      p.obj.setPosition(x, y + p.dy);
    }
    drawTrail();
  };
  // 航线：沿虚线弧画到 trailT 为止（虚线和地图上画好的跨省路线一个样子）
  const drawTrail = () => {
    trail.clear();
    if (trailT <= 0) return;
    trail.lineStyle(3, 0xe8703c, 1);
    const pts: [number, number][] = [];
    for (let i = 0; i <= 60; i++) pts.push(toScreen(cam, ...routePoint(a, b, (trailT * i) / 60)));
    let on = true, left = 6;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      let seg = Math.hypot(x1 - x0, y1 - y0);
      while (seg > 0) {
        const step = Math.min(left, seg);
        const r = step / seg;
        const nx = x0 + (x1 - x0) * r, ny = y0 + (y1 - y0) * r;
        if (on) trail.lineBetween(x0, y0, nx, ny);
        [x0, y0] = [nx, ny];
        seg -= step;
        left -= step;
        if (left <= 0) {
          on = !on;
          left = 6;
        }
      }
    }
  };
  const pin = (tex: string, c: City, dy: number, scale: number) => {
    const obj = scene.add.image(0, 0, tex).setScale(scale);
    o.anim.add(obj);
    const p = { obj, x: c.x, y: c.y, dy };
    pinned.push(p);
    apply();
    return p;
  };
  const unpin = (obj: Phaser.GameObjects.Image) => {
    const i = pinned.findIndex((p) => p.obj === obj);
    if (i >= 0) pinned.splice(i, 1);
  };
  const addSheet = (sheet: MapSheet, alpha = 1) => {
    const img = sheet.image(scene).setAlpha(alpha);
    o.maps.add(img);
    sheets.push(img);
    placeSheet(img, cam);
    return img;
  };
  const dropSheet = (img: Phaser.GameObjects.Image) => {
    sheets.splice(sheets.indexOf(img), 1);
    img.destroy();
  };

  // 省份变色：变化之后的全国图，用这个省的轮廓当遮罩慢慢显出来，再闪一下白光
  const masks: Phaser.GameObjects.Graphics[] = [];
  o.onClose(() => masks.forEach((g) => g.destroy()));
  const provincePoints = (name: string) =>
    provOf(name).polys.map((poly) => {
      const r = poly[0];
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < r.length; i += 2) pts.push(new Phaser.Math.Vector2(...toScreen(cam, r[i], r[i + 1])));
      return pts;
    });
  const reveal = (name: string): Promise<void> => {
    const img = addSheet(SHEET_1, 0);
    const shape = scene.make.graphics({}, false);
    shape.fillStyle(0xffffff, 1);
    for (const pts of provincePoints(name)) shape.fillPoints(pts, true);
    masks.push(shape);
    img.setMask(shape.createGeometryMask());
    const flash = scene.add.graphics();
    flash.fillStyle(0xffffff, 1);
    for (const pts of provincePoints(name)) flash.fillPoints(pts, true);
    flash.setAlpha(0);
    o.anim.addAt(flash, 0);
    track(scene.tweens.add({ targets: flash, alpha: { from: 0.85, to: 0 }, duration: 600, ease: "Quad.easeOut" }));
    return tween({ targets: img, alpha: 1, duration: 380, ease: "Quad.easeOut" });
  };

  // 动画一步步往下走；点一下屏幕就跳到最后
  let done = false;
  const running: Phaser.Tweens.Tween[] = [];
  const track = (t: Phaser.Tweens.Tween) => {
    running.push(t);
    return t;
  };
  const tween = (cfg: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> =>
    new Promise((res) => track(scene.tweens.add({ ...cfg, onComplete: () => res() })));
  const wait = (ms: number): Promise<void> => new Promise((res) => scene.time.delayedCall(ms, () => res()));
  /** 镜头从 from 推/拉到 to，让 anchor 这个点平滑地从一处挪到另一处，不会中途甩出画面。 */
  const moveCam = (from: View, to: View, anchor: [number, number], ms: number, onU?: (u: number) => void): Promise<void> => {
    const s0 = toScreen(from, ...anchor), s1 = toScreen(to, ...anchor);
    const st = { u: 0 };
    return tween({
      targets: st, u: 1, duration: ms, ease: "Sine.easeInOut",
      onUpdate: () => {
        const u = st.u;
        const k = Math.exp(Math.log(from.k) * (1 - u) + Math.log(to.k) * u);
        const sy = from.sy + (to.sy - from.sy) * u;
        const sx = s0[0] + (s1[0] - s0[0]) * u, ssy = s0[1] + (s1[1] - s0[1]) * u;
        cam = { k, sy, cx: anchor[0] - (sx - WIDTH / 2) / k, cy: anchor[1] - (ssy - sy) / k };
        apply();
        onU?.(u);
      },
    });
  };

  const finalFrame: Frame = { progress: b.level, view: VB, labelRegions: [b.region], hide: [b.level] };
  /** 最后的样子：新省的详细图，第一站插着小旗，出「出发」按钮。 */
  const showEnd = (plant: boolean) => {
    if (plant) {
      const [x, y] = toScreen(VB, b.x, b.y);
      const flag = scene.add.image(x, y - 140, MAP_FLAG_TEXTURE).setScale(ICON_SCALE).setAlpha(0);
      o.anim.add(flag);
      // 小旗从天上落下来插好，再泛两圈光，表示「下一关在这」
      track(scene.tweens.add({ targets: flag, alpha: 1, duration: 150 }));
      tween({ targets: flag, y: y - 6, duration: 650, ease: "Bounce.easeOut" }).then(() => {
        if (flag.active) {
          sfx.unlock();
          ripple(x, y);
          flag.destroy();
          bobbingFlag(o, x, y);
        }
      });
    } else {
      bobbingFlag(o, ...toScreen(VB, b.x, b.y));
    }
    o.setTitle(`欢迎来到${b.region}！`, `第一站：${b.city}`);
    o.setLegend("cities");
    goButton(o, b, onGo);
  };
  const ripple = (x: number, y: number) => {
    for (let i = 0; i < 2; i++) {
      const ring = scene.add.graphics();
      o.anim.addAt(ring, 0);
      const st = { r: 10, a: 0.9 };
      track(scene.tweens.add({
        targets: st, r: 52, a: 0, duration: 800, delay: i * 260, ease: "Quad.easeOut",
        onUpdate: () => {
          ring.clear();
          ring.lineStyle(4, 0xe8453c, st.a).strokeCircle(x, y, st.r);
        },
        onComplete: () => ring.destroy(),
      }));
    }
  };

  const skip = () => {
    if (done) return;
    done = true;
    running.forEach((t) => t.stop());
    clearAnim(o);
    sheets.splice(0).forEach((img) => img.destroy());
    trailT = 0;
    SHEET_2.draw(scene, finalFrame);
    cam = VB;
    addSheet(SHEET_2);
    showEnd(false);
  };
  o.hit.on("pointerdown", skip);

  const run = async () => {
    // 准备：SHEET_1 = 刚走完的省（还是黄色），SHEET_2 = 全国（变化之前）
    SHEET_2.draw(scene, { progress: a.level, view: NATIONAL, hide: [a.level] });
    SHEET_1.draw(scene, { progress: a.level, view: VA, labelRegions: [a.region], hide: [a.level] });
    const nationalBefore = addSheet(SHEET_2);
    const detailA = addSheet(SHEET_1);
    o.setTitle("恭喜过关！", `${a.region}-${a.city} 过关`);
    o.setLegend("cities");

    // ① 最后一站：小旗收起来，盖上 ✓
    const flagA = pin(MAP_FLAG_TEXTURE, a, -6, ICON_SCALE);
    await wait(200);
    if (done) return;
    await tween({ targets: flagA.obj, scale: 0, duration: 140 });
    if (done) return;
    unpin(flagA.obj);
    flagA.obj.destroy();
    const check = pin(MAP_DONE_TEXTURE, a, 0, 0);
    sfx.unlock();
    await tween({ targets: check.obj, scale: ICON_SCALE, duration: 300, ease: "Back.easeOut" });
    if (done) return;
    await wait(250);
    if (done) return;

    // ② 镜头拉远到全国：详细图淡出，✓ 跟着淡掉，小旗在全国图上冒出来
    let legendSwitched = false;
    await moveCam(VA, NATIONAL, boxCenter(a.region), 650, (u) => {
      detailA.setAlpha(Math.max(0, 1 - u * 1.6));
      check.obj.setAlpha(1 - u);
      if (u > 0.5 && !legendSwitched) {
        legendSwitched = true;
        o.setLegend("provinces");
      }
    });
    if (done) return;
    dropSheet(detailA);
    unpin(check.obj);
    check.obj.destroy();
    const traveler = pin(MAP_FLAG_TEXTURE, a, -5, 0);
    await tween({ targets: traveler.obj, scale: ICON_SCALE_NATIONAL, duration: 180, ease: "Back.easeOut" });
    if (done) return;

    // ③ 刚走完的省「刷」地变绿
    SHEET_1.draw(scene, { progress: b.level, view: NATIONAL, hide: [b.level], skipRoute: b.level }); // 全国（变化之后）
    sfx.win();
    o.setTitle(`${a.region} 全部走完啦！🎉`, `走完 ${regionNo(a.region)} 个省，还有 ${total - regionNo(a.region)} 个`, true);
    await reveal(a.region);
    if (done) return;
    await wait(450);
    if (done) return;

    // ④ 小旗变飞机，沿虚线弧飞过去
    o.setTitle(`飞往${b.region} ✈️`, `${a.region} → ${b.region}`);
    await tween({ targets: traveler.obj, scale: 0, duration: 120 });
    if (done) return;
    unpin(traveler.obj);
    traveler.obj.destroy();
    const plane = pin(MAP_PLANE_TEXTURE, a, 0, 0);
    track(scene.tweens.add({ targets: plane.obj, scale: 0.42, duration: 220, ease: "Back.easeOut" }));
    sfx.shuffle();
    const [ax, ay] = toScreen(NATIONAL, a.x, a.y), [bx, by] = toScreen(NATIONAL, b.x, b.y);
    const dist = Math.hypot(bx - ax, by - ay);
    const fly = { t: 0 };
    await tween({
      targets: fly, t: 1, duration: Phaser.Math.Clamp(800 + dist * 2.2, 1000, 2100), ease: "Sine.easeInOut",
      onUpdate: () => {
        const [x, y] = routePoint(a, b, fly.t);
        const [x2, y2] = routePoint(a, b, Math.min(1, fly.t + 0.02));
        const [x1, y1] = routePoint(a, b, Math.max(0, fly.t - 0.02));
        plane.x = x;
        plane.y = y;
        plane.obj.setRotation(Math.atan2(y2 - y1, x2 - x1));
        plane.obj.setScale(0.42 + 0.14 * Math.sin(fly.t * Math.PI)); // 飞到半空大一点，像飞高了
        trailT = fly.t;
        apply();
      },
    });
    if (done) return;

    // ⑤ 落地：飞机变回小旗，新省亮成黄色
    await tween({ targets: plane.obj, scale: 0, duration: 140 });
    if (done) return;
    unpin(plane.obj);
    plane.obj.destroy();
    const landed = pin(MAP_FLAG_TEXTURE, b, -5, 0);
    track(scene.tweens.add({ targets: landed.obj, scale: ICON_SCALE_NATIONAL, duration: 220, ease: "Back.easeOut" }));
    sfx.match(2);
    o.setTitle(`欢迎来到${b.region}！`, `第 ${regionNo(b.region)} 个省 · 一共 ${total} 个`, true);
    await reveal(b.region);
    if (done) return;
    await wait(400);
    if (done) return;

    // ⑥ 镜头推近到新省：全国图换成「变化之后」那张（看起来一模一样），腾出 SHEET_2 画详细图
    sheets.splice(0).forEach((img) => img.destroy());
    masks.splice(0).forEach((g) => g.destroy());
    void nationalBefore;
    const nationalAfter = addSheet(SHEET_1);
    SHEET_2.draw(scene, finalFrame);
    const detailB = addSheet(SHEET_2, 0);
    legendSwitched = false;
    await moveCam(NATIONAL, VB, boxCenter(b.region), 700, (u) => {
      detailB.setAlpha(Math.min(1, Math.max(0, (u - 0.45) / 0.45)));
      landed.obj.setScale(ICON_SCALE_NATIONAL + (ICON_SCALE - ICON_SCALE_NATIONAL) * u);
      if (u > 0.5 && !legendSwitched) {
        legendSwitched = true;
        o.setLegend("cities");
      }
    });
    if (done) return;
    dropSheet(nationalAfter);
    trailT = 0;
    apply(); // 详细图里已经画着这段路线了，动画的航线收起来
    o.setTitle(`欢迎来到${b.region}！`, `第一站：${b.city}`);

    // ⑦ 小旗从天上插到第一站
    unpin(landed.obj);
    landed.obj.destroy();
    done = true;
    showEnd(true);
  };
  void run();
}
