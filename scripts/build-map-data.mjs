// ---------------------------------------------------------------------------
// 旅行地图数据：npm run build:map  →  src/map/map-data.ts（生成的文件，别手改）
//
// 来源：阿里云 DataV.GeoAtlas 行政区划（高德），图表库常用的那份，按官方边界画，
//   含台湾、香港、澳门、南海诸岛和九段线（100000_full.json 里 adcode 100000_JD）。
//   https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
//   下载的原始文件缓存在 .cache/geo/（不进仓库），删掉就会重新下载。
//
// 做了这几件事：
// 1. Lambert 圆锥投影（中国地图常用：标准纬线 25°/47°，中央经线 105°），竖版，
//    南海诸岛整片画在下方、不另开小框——手机竖屏正好放得下。缩放到 720 宽。
// 2. 道格拉斯-普克抽稀，阈值 0.35px：全国 2.5 万个点 → 约 1 万个，点开省份放大
//    几倍边界也不起锯齿。
// 3. 每一关的城市 → 坐标：省级 _full.json 里按名字前缀找（广州→广州市，延边→
//    延边朝鲜族自治州，黄浦→黄浦区），取 properties.center（政府驻地）。数据里
//    没有的手工补：台湾没有下一级数据；敦煌、格尔木是县级市；澳门半岛用澳门中心。
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, ".cache", "geo");
mkdirSync(cache, { recursive: true });

// 关卡里的省份顺序和城市名直接从 levels.ts 读，别在这里再抄一份
const lv = join(mkdtempSync(join(tmpdir(), "map-")), "levels.mjs");
execFileSync("npx", ["esbuild", "src/levels.ts", "--bundle", "--format=esm", `--outfile=${lv}`, "--log-level=error"], { cwd: root, stdio: "inherit" });
const { REGIONS } = await import(pathToFileURL(lv).href);

const ADCODE = {
  广东: 440000, 广西: 450000, 海南: 460000, 福建: 350000, 江西: 360000, 浙江: 330000, 上海: 310000, 江苏: 320000,
  安徽: 340000, 山东: 370000, 河南: 410000, 河北: 130000, 北京: 110000, 天津: 120000, 山西: 140000, 内蒙古: 150000,
  辽宁: 210000, 吉林: 220000, 黑龙江: 230000, 湖北: 420000, 湖南: 430000, 重庆: 500000, 四川: 510000, 贵州: 520000,
  云南: 530000, 陕西: 610000, 甘肃: 620000, 宁夏: 640000, 青海: 630000, 新疆: 650000, 西藏: 540000, 台湾: 710000,
  香港: 810000, 澳门: 820000,
};
const ALIAS = { 中环: "中西区" };
const MANUAL = {
  台北: [121.565, 25.033], 高雄: [120.301, 22.627], 台中: [120.679, 24.139], 花莲: [121.601, 23.977],
  敦煌: [94.662, 40.142], 格尔木: [94.903, 36.402], 澳门半岛: [113.549, 22.199],
};

async function geo(adcode) {
  const file = join(cache, `${adcode}_full.json`);
  if (!existsSync(file)) {
    const res = await fetch(`https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`);
    if (!res.ok) return null; // 台湾没有下一级数据（404），城市坐标手工补
    writeFileSync(file, await res.text());
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null; // 缓存里混进了出错页面（比如 404 的 XML），当作没有这份数据
  }
}

// --- 投影 ---------------------------------------------------------------------
const rad = Math.PI / 180, p1 = 25 * rad, p2 = 47 * rad, l0 = 105 * rad;
const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
const F = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
const lambert = ([lng, lat]) => {
  const r = F / Math.pow(Math.tan(Math.PI / 4 + (lat * rad) / 2), n);
  const t = n * (lng * rad - l0);
  return [r * Math.sin(t), -(F - r * Math.cos(t))];
};

// --- 抽稀 ---------------------------------------------------------------------
// 注意：GeoJSON 的环首尾是同一个点，线段退化成一个点时要算点到点的距离，
// 否则分母为 0，整个环会被删得只剩两个点。
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-6 ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// --- 全国 ---------------------------------------------------------------------
const country = await geo(100000);
const short = (name) => name.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, "");
const feats = country.features.map((f) => {
  const code = String(f.properties.adcode);
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return {
    name: code.endsWith("_JD") ? null : short(f.properties.name),
    // 南海诸岛：整块都在 17.5°N 以南的岛；算「大陆」范围时不算它们和九段线
    south: polys.map((p) => code.endsWith("_JD") || Math.max(...p[0].map((c) => c[1])) < 17.5),
    polys: polys.map((p) => p.map((ring) => ring.map(lambert))),
  };
});
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const f of feats) for (const p of f.polys) for (const r of p) for (const [x, y] of r) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
const PAD = 20, W = 720, scale = (W - PAD * 2) / (maxX - minX);
const H = Math.ceil((maxY - minY) * scale) + PAD * 2;
const px = ([x, y]) => [(x - minX) * scale + PAD, (y - minY) * scale + PAD];
const r1 = (v) => Math.round(v * 10) / 10;
const flat = (ring) => simplify(ring.map(px), 0.35).flatMap(([x, y]) => [r1(x), r1(y)]);

const provinces = [];
let nineDash = [];
let mainland = [Infinity, Infinity, -Infinity, -Infinity];
let points = 0;
for (const f of feats) {
  const polys = f.polys.map((p) => p.map(flat)).filter((p) => p[0].length >= 6);
  for (const p of polys) for (const r of p) points += r.length / 2;
  f.polys.forEach((p, i) => {
    if (f.south[i]) return;
    for (const r of p) for (const pt of r) {
      const [x, y] = px(pt);
      mainland = [Math.min(mainland[0], x), Math.min(mainland[1], y), Math.max(mainland[2], x), Math.max(mainland[3], y)];
    }
  });
  if (f.name === null) nineDash = polys.map((p) => p[0]);
  else provinces.push({ name: f.name, polys });
}
const missing = REGIONS.filter((r) => !provinces.some((p) => p.name === r.name)).map((r) => r.name);
if (missing.length) throw new Error("地图里找不到这些省：" + missing.join("、"));

// --- 城市 ---------------------------------------------------------------------
const cityXY = [];
for (const r of REGIONS) {
  const sub = await geo(ADCODE[r.name]);
  for (const city of r.cities) {
    let ll = MANUAL[city];
    if (!ll) {
      const want = ALIAS[city] ?? city;
      const hit = (sub?.features ?? []).filter((f) => f.properties.name.startsWith(want));
      if (hit.length !== 1) throw new Error(`${r.name}-${city} 匹配到 ${hit.length} 个地方`);
      ll = hit[0].properties.center;
    }
    const [x, y] = px(lambert(ll));
    cityXY.push([r1(x), r1(y)]);
  }
}

const out = `// 自动生成，别手改：npm run build:map（scripts/build-map-data.mjs）
// 地图数据：阿里云 DataV.GeoAtlas 行政区划（高德）。Lambert 圆锥投影，竖版含南海诸岛。
// 坐标单位是「全国图像素」：全国图 ${W}×${H}，环是扁平数组 [x0, y0, x1, y1, ...]。

export const MAP_W = ${W};
export const MAP_H = ${H};
/** 大陆（含台湾、海南岛，不含南海诸岛和九段线）的范围 [x0, y0, x1, y1]，全国图按它居中。 */
export const MAINLAND: [number, number, number, number] = ${JSON.stringify(mainland.map(r1))};

export interface MapProvince {
  /** 和 levels.ts 里的省名一致：广东、内蒙古、香港…… */
  name: string;
  /** 每个多边形：[外环, 洞, 洞…] */
  polys: number[][][];
}

export const PROVINCES: MapProvince[] = ${JSON.stringify(provinces)};

/** 九段线（每段是一个细长的闭合多边形）。 */
export const NINE_DASH: number[][] = ${JSON.stringify(nineDash)};

/** 每一关城市的位置，下标 = 关卡号 - 1。 */
export const CITY_XY: [number, number][] = ${JSON.stringify(cityXY)};
`;
mkdirSync(join(root, "src", "map"), { recursive: true });
writeFileSync(join(root, "src", "map", "map-data.ts"), out);
console.log(`地图 ${W}×${H}，${provinces.length} 个省级行政区 + 九段线 ${nineDash.length} 段，${points} 个点，${cityXY.length} 个城市，${(out.length / 1024).toFixed(0)} KB`);
