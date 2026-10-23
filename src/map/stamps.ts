// ---------------------------------------------------------------------------
// 旅行护照的印章：每走完一个省盖一个，章上是这个省的简称、全称和省会。
// 全部用代码画（家长担心「要很多图」——不用）：圆 / 圆角方 / 八角三种形状、
// 五种墨色轮着用，随机歪一点、边上擦掉些小点，看起来像真盖上去的。
// 同一个省每次画出来一模一样（随机数按省的序号定）。
// ---------------------------------------------------------------------------
import Phaser from "phaser";
import { REGIONS } from "../levels";

export interface StampInfo {
  /** 简称（大字） */
  abbr: string;
  /** 另一个简称：四川也叫蜀、云南也叫滇……章上写一行小字「又称 X」 */
  alt?: string;
  /** 全称（上面一圈） */
  full: string;
  /** 省会 / 首府 / 首都 / 直辖市 / 特别行政区（下面一行） */
  seat: string;
}

export const STAMPS: Record<string, StampInfo> = {
  广东: { abbr: "粤", full: "广东省", seat: "省会 广州" },
  广西: { abbr: "桂", full: "广西壮族自治区", seat: "首府 南宁" },
  海南: { abbr: "琼", full: "海南省", seat: "省会 海口" },
  福建: { abbr: "闽", full: "福建省", seat: "省会 福州" },
  江西: { abbr: "赣", full: "江西省", seat: "省会 南昌" },
  浙江: { abbr: "浙", full: "浙江省", seat: "省会 杭州" },
  上海: { abbr: "沪", full: "上海市", seat: "直辖市" },
  江苏: { abbr: "苏", full: "江苏省", seat: "省会 南京" },
  安徽: { abbr: "皖", full: "安徽省", seat: "省会 合肥" },
  山东: { abbr: "鲁", full: "山东省", seat: "省会 济南" },
  河南: { abbr: "豫", full: "河南省", seat: "省会 郑州" },
  河北: { abbr: "冀", full: "河北省", seat: "省会 石家庄" },
  北京: { abbr: "京", full: "北京市", seat: "首都" },
  天津: { abbr: "津", full: "天津市", seat: "直辖市" },
  山西: { abbr: "晋", full: "山西省", seat: "省会 太原" },
  内蒙古: { abbr: "蒙", full: "内蒙古自治区", seat: "首府 呼和浩特" },
  辽宁: { abbr: "辽", full: "辽宁省", seat: "省会 沈阳" },
  吉林: { abbr: "吉", full: "吉林省", seat: "省会 长春" },
  黑龙江: { abbr: "黑", full: "黑龙江省", seat: "省会 哈尔滨" },
  湖北: { abbr: "鄂", full: "湖北省", seat: "省会 武汉" },
  湖南: { abbr: "湘", full: "湖南省", seat: "省会 长沙" },
  重庆: { abbr: "渝", full: "重庆市", seat: "直辖市" },
  四川: { abbr: "川", alt: "蜀", full: "四川省", seat: "省会 成都" },
  贵州: { abbr: "贵", alt: "黔", full: "贵州省", seat: "省会 贵阳" },
  云南: { abbr: "云", alt: "滇", full: "云南省", seat: "省会 昆明" },
  陕西: { abbr: "陕", alt: "秦", full: "陕西省", seat: "省会 西安" },
  甘肃: { abbr: "甘", alt: "陇", full: "甘肃省", seat: "省会 兰州" },
  宁夏: { abbr: "宁", full: "宁夏回族自治区", seat: "首府 银川" },
  青海: { abbr: "青", full: "青海省", seat: "省会 西宁" },
  新疆: { abbr: "新", full: "新疆维吾尔自治区", seat: "首府 乌鲁木齐" },
  西藏: { abbr: "藏", full: "西藏自治区", seat: "首府 拉萨" },
  台湾: { abbr: "台", full: "台湾省", seat: "省会 台北" },
  香港: { abbr: "港", full: "香港特别行政区", seat: "特别行政区" },
  澳门: { abbr: "澳", full: "澳门特别行政区", seat: "特别行政区" },
};

const INKS = ["#d0342c", "#2a62b8", "#1f8a4c", "#7b3fa8", "#c2581b"];
type Shape = "circle" | "rounded" | "octagon";
const SHAPES: Shape[] = ["circle", "rounded", "octagon"];
const SANS = '-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
// 大字想要宋体那种「章」的味道；手机上没有宋体会退成粗黑体，也好看
const SERIF = '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "STSong", "SimSun", serif';

/** 同一个省每次画出来一样：随机数只看省的序号。 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function outline(g: CanvasRenderingContext2D, shape: Shape, R: number): void {
  g.beginPath();
  if (shape === "circle") {
    g.arc(0, 0, R, 0, Math.PI * 2);
  } else if (shape === "octagon") {
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      if (k) g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      else g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    g.closePath();
  } else {
    const s = R * 0.92, c = R * 0.28;
    g.moveTo(-s + c, -s);
    g.arcTo(s, -s, s, s, c);
    g.arcTo(s, s, -s, s, c);
    g.arcTo(-s, s, -s, -s, c);
    g.arcTo(-s, -s, s, -s, c);
    g.closePath();
  }
}

/** 沿圆弧写一圈字（全称），以 mid 为中心左右排开。 */
function arcText(g: CanvasRenderingContext2D, text: string, rad: number, mid: number, fs: number): void {
  const chars = [...text];
  const step = (fs * 1.12) / rad;
  const start = mid - (step * (chars.length - 1)) / 2;
  chars.forEach((ch, k) => {
    const a = start + k * step;
    g.save();
    g.translate(Math.cos(a) * rad, Math.sin(a) * rad);
    g.rotate(a + Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
  });
}

function star(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 ? s * 0.45 : s;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
}

/**
 * 在 (x, y) 画一个半径 R 的章。done = false 画成灰色虚线框 + 问号（还没走到）。
 * 画布背景要是透明的：墨迹斑驳是用 destination-out 擦出来的小洞。
 */
export function drawStamp(g: CanvasRenderingContext2D, x: number, y: number, R: number, region: string, done: boolean): void {
  const info = STAMPS[region];
  const idx = Math.max(0, REGIONS.findIndex((r) => r.name === region));
  const ink = INKS[idx % INKS.length];
  const shape = SHAPES[idx % SHAPES.length];
  const rnd = seeded(idx * 77 + 13);
  g.save();
  g.translate(x, y);
  g.rotate((rnd() - 0.5) * 0.35);
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (!done || !info) {
    g.setLineDash([R * 0.15, R * 0.13]);
    g.strokeStyle = "#cdbd9c";
    g.lineWidth = R * 0.05;
    outline(g, shape, R);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#cdbd9c";
    g.font = `bold ${R * 0.7}px ${SANS}`;
    g.fillText("?", 0, R * 0.04);
    g.restore();
    return;
  }
  g.strokeStyle = ink;
  g.fillStyle = ink;
  g.lineWidth = R * 0.07;
  outline(g, shape, R);
  g.stroke();
  g.lineWidth = R * 0.025;
  outline(g, shape, R * 0.86);
  g.stroke();

  // 大字：简称（有「又称」的往上挪一点，给小字让地方）
  g.font = `900 ${info.alt ? R * 0.66 : R * 0.78}px ${SERIF}`;
  g.fillText(info.abbr, 0, info.alt ? -R * 0.07 : R * 0.02);
  if (info.alt) {
    g.font = `bold ${R * 0.13}px ${SANS}`;
    g.fillText(`又称 ${info.alt}`, 0, R * 0.36);
  }
  // 上面一圈：全称（字多的小一号）
  const n = [...info.full].length;
  const fs = R * (n >= 8 ? 0.125 : n >= 6 ? 0.14 : 0.16);
  g.font = `bold ${fs}px ${SANS}`;
  arcText(g, info.full, R * 0.67, -Math.PI / 2, fs);
  // 下面：省会
  g.font = `bold ${R * (info.seat.length > 6 ? 0.13 : 0.15)}px ${SANS}`;
  g.fillText(info.seat, 0, R * 0.62);
  // 两边的小星星
  for (const s of [-1, 1]) star(g, s * R * 0.62, R * 0.06, R * 0.06);
  // 墨迹斑驳：随机擦掉一些小点
  g.globalCompositeOperation = "destination-out";
  for (let k = 0; k < 140; k++) {
    const a = rnd() * Math.PI * 2, d = rnd() * R;
    g.globalAlpha = 0.25 + rnd() * 0.55;
    g.beginPath();
    g.arc(Math.cos(a) * d, Math.sin(a) * d, 0.6 + rnd() * R * 0.03, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * 某个省的章做成一张贴图（过关动画里「啪」地盖下来用）。贴图是全局的，每个省只画一次；
 * 画布放内存里（willReadFrequently），万一被清空了收到 contextrestored 就重画。
 */
export function stampTexture(scene: Phaser.Scene, region: string): string {
  const key = `stamp-${region}`;
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  const size = 240;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return key;
  const paint = () => {
    ctx.clearRect(0, 0, size, size);
    drawStamp(ctx, size / 2, size / 2, size * 0.42, region, true);
  };
  paint();
  textures.addCanvas(key, canvas);
  canvas.addEventListener("contextrestored", () => {
    paint();
    if (textures.exists(key)) (textures.get(key) as Phaser.Textures.CanvasTexture).refresh();
  });
  return key;
}
