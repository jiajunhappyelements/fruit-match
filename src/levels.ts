// ---------------------------------------------------------------------------
// The journey: every level maps to a city, cities are grouped into China's 34
// province-level regions. The level number stays the single linear index that
// drives difficulty and save data — geography is a progress *skin* layered on
// top, so the two can be tuned independently.
//
// Order roughly traces a road trip: south coast → east → north → north-east →
// centre → south-west → west, ending in the far west. It is a travel route,
// not any official ordering.
// ---------------------------------------------------------------------------

export interface Region {
  /** Display name, e.g. 广东 / 北京 / 内蒙古. */
  name: string;
  /** Cities visited in this region, in travel order. One level each. */
  cities: string[];
}

export const REGIONS: Region[] = [
  { name: "广东", cities: ["广州", "深圳", "珠海", "佛山", "东莞", "汕头"] },
  { name: "广西", cities: ["南宁", "桂林", "柳州", "北海", "百色"] },
  { name: "海南", cities: ["海口", "三亚", "儋州"] },
  { name: "福建", cities: ["福州", "厦门", "泉州", "漳州", "莆田"] },
  { name: "江西", cities: ["南昌", "赣州", "九江", "景德镇", "上饶"] },
  { name: "浙江", cities: ["杭州", "宁波", "温州", "嘉兴", "绍兴", "金华"] },
  { name: "上海", cities: ["黄浦", "浦东", "徐汇"] },
  { name: "江苏", cities: ["南京", "苏州", "无锡", "常州", "扬州", "徐州"] },
  { name: "安徽", cities: ["合肥", "芜湖", "黄山", "安庆", "蚌埠"] },
  { name: "山东", cities: ["济南", "青岛", "烟台", "潍坊", "淄博", "临沂"] },
  { name: "河南", cities: ["郑州", "洛阳", "开封", "南阳", "安阳"] },
  { name: "河北", cities: ["石家庄", "唐山", "保定", "秦皇岛", "承德"] },
  { name: "北京", cities: ["东城", "海淀", "朝阳"] },
  { name: "天津", cities: ["和平", "滨海"] },
  { name: "山西", cities: ["太原", "大同", "运城", "临汾"] },
  { name: "内蒙古", cities: ["呼和浩特", "包头", "鄂尔多斯", "呼伦贝尔"] },
  { name: "辽宁", cities: ["沈阳", "大连", "鞍山", "锦州"] },
  { name: "吉林", cities: ["长春", "吉林", "延边"] },
  { name: "黑龙江", cities: ["哈尔滨", "齐齐哈尔", "牡丹江", "大庆"] },
  { name: "湖北", cities: ["武汉", "宜昌", "襄阳", "十堰", "荆州"] },
  { name: "湖南", cities: ["长沙", "岳阳", "衡阳", "张家界", "湘潭"] },
  { name: "重庆", cities: ["渝中", "江北", "万州"] },
  { name: "四川", cities: ["成都", "绵阳", "乐山", "宜宾", "南充"] },
  { name: "贵州", cities: ["贵阳", "遵义", "六盘水", "毕节"] },
  { name: "云南", cities: ["昆明", "大理", "丽江", "西双版纳", "曲靖"] },
  { name: "陕西", cities: ["西安", "宝鸡", "咸阳", "延安", "汉中"] },
  { name: "甘肃", cities: ["兰州", "敦煌", "天水", "酒泉"] },
  { name: "宁夏", cities: ["银川", "石嘴山", "吴忠"] },
  { name: "青海", cities: ["西宁", "格尔木", "海东"] },
  { name: "新疆", cities: ["乌鲁木齐", "喀什", "吐鲁番", "伊犁", "阿克苏"] },
  { name: "西藏", cities: ["拉萨", "日喀则", "林芝"] },
  { name: "台湾", cities: ["台北", "高雄", "台中", "花莲"] },
  { name: "香港", cities: ["中环", "九龙"] },
  { name: "澳门", cities: ["澳门半岛"] },
];

/** Running start index of each region, so level -> place is O(log n)-ish. */
const OFFSETS: number[] = (() => {
  const out: number[] = [];
  let n = 0;
  for (const r of REGIONS) {
    out.push(n);
    n += r.cities.length;
  }
  return out;
})();

/** Total number of authored levels — finishing them all completes the journey. */
export const TOTAL_LEVELS = OFFSETS[OFFSETS.length - 1] + REGIONS[REGIONS.length - 1].cities.length;

export interface Place {
  region: string;
  city: string;
  /** 1-based index of the region in the journey. */
  regionIndex: number;
  /** True when this level is the first city of its region (arrival moment). */
  isRegionStart: boolean;
  /** True when this level is the last city of its region. */
  isRegionEnd: boolean;
}

/**
 * Where a level sits on the journey. Levels past the end clamp to the final
 * city so an over-run save never crashes (the win screen ends the game there).
 */
export function placeOf(level: number): Place {
  const idx = Math.min(Math.max(level, 1), TOTAL_LEVELS) - 1;
  let r = 0;
  while (r + 1 < REGIONS.length && OFFSETS[r + 1] <= idx) r++;
  const region = REGIONS[r];
  const cityIdx = idx - OFFSETS[r];
  return {
    region: region.name,
    city: region.cities[cityIdx],
    regionIndex: r + 1,
    isRegionStart: cityIdx === 0,
    isRegionEnd: cityIdx === region.cities.length - 1,
  };
}

/** Has the player finished every authored level? */
export function isJourneyComplete(level: number): boolean {
  return level > TOTAL_LEVELS;
}
