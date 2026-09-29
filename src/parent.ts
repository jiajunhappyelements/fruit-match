// ---------------------------------------------------------------------------
// 家长看板：网址后加 ?parent=1 打开。
//
// 只读 localStorage 里的答题记录，所以看到的是「这台设备上」孩子答过的题——
// 在孩子玩的那台手机上，用浏览器打开带参数的地址即可（装到桌面的 App 和
// Chrome 共用同一份存储）。孩子点图标进游戏永远不会走到这里。
// ---------------------------------------------------------------------------
import { loadHistory, topicStats, type TopicStat } from "./quiz/history";
import type { AnswerRecord } from "./quiz/history";

const SUBJECT_NAME: Record<string, string> = { math: "数学", chinese: "语文", english: "英语" };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const pct = (ok: number, n: number) => (n === 0 ? 0 : Math.round((ok / n) * 100));

function when(t: number): string {
  const d = new Date(t);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// 最该多练：至少做过 3 次、最近几次正确率低于 75%，按正确率从低到高——
// 和游戏里抽题加权用的是同一个口径。门槛不能是「最近错过一次」：8 对 7 的题型
// 已经会了，列进来会让家长以为样样都要补。
const WEAK_BELOW = 0.75;
function weakest(stats: TopicStat[]): TopicStat[] {
  return stats
    .filter((s) => s.n >= 3 && s.recentN > 0 && s.recentOk / s.recentN < WEAK_BELOW)
    .sort((a, b) => a.recentOk / a.recentN - b.recentOk / b.recentN || b.n - a.n)
    .slice(0, 3);
}

function bar(p: number): string {
  const hue = p >= 85 ? 140 : p >= 60 ? 40 : 5; // 绿 / 黄 / 红
  return `<span class="bar"><span style="width:${p}%;background:hsl(${hue} 60% 48%)"></span></span>`;
}

function wrongRow(r: AnswerRecord): string {
  return `<li>
    <div class="q">${esc(r.prompt)}</div>
    <div class="a"><span class="bad">✗ ${esc(r.picked)}</span><span class="good">✓ ${esc(r.answer)}</span></div>
    <div class="meta">${esc(r.topic)} · ${when(r.t)}</div>
  </li>`;
}

export function renderParentReport(): void {
  // 游戏页为了防误触把滚动和手势全关了，看板要恢复成普通网页
  document.documentElement.style.cssText = "overflow:auto;height:auto;background:#f6f4ef";
  document.body.style.cssText = "overflow:auto;height:auto;touch-action:auto;background:#f6f4ef;margin:0";
  document.getElementById("game")?.remove();
  document.title = "学习记录 · 水果掉掉乐";

  const hist = loadHistory();
  const stats = [...topicStats(hist).values()];
  const total = hist.length;
  const ok = hist.filter((r) => r.ok).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const week = hist.filter((r) => r.t >= weekAgo);
  const wrong = hist.filter((r) => !r.ok).slice(-12).reverse();
  const weak = weakest(stats);
  const table = [...stats].sort((a, b) => pct(a.ok, a.n) - pct(b.ok, b.n) || b.n - a.n);

  const root = document.createElement("main");
  root.innerHTML = `
  <style>
    main{max-width:640px;margin:0 auto;padding:20px 16px 48px;color:#2b2620;
      font:15px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
    h1{font-size:24px;margin:4px 0 2px}
    .sub{color:#8a8275;font-size:13px;margin-bottom:18px}
    h2{font-size:16px;margin:26px 0 10px;color:#5b4a36}
    .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .tile{background:#fff;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 2px #0001}
    .tile b{display:block;font-size:24px;font-variant-numeric:tabular-nums}
    .tile span{font-size:12px;color:#8a8275}
    .card{background:#fff;border-radius:12px;padding:4px 14px;box-shadow:0 1px 2px #0001}
    .weak{background:#fff6ed;border:1px solid #f3d9bd;border-radius:12px;padding:10px 14px;margin-bottom:8px}
    .weak .t{font-weight:600}
    .weak .d{font-size:13px;color:#7a6a57;margin-top:2px}
    .weak .ex{font-size:13px;margin-top:6px;padding-top:6px;border-top:1px dashed #f0d6b8}
    .weak .ex .bad,.weak .ex .good{margin-left:10px}
    .ok-all{background:#eef8ef;border:1px solid #cfe9d2;border-radius:12px;padding:12px 14px;color:#2e6b3c}
    table{width:100%;border-collapse:collapse;font-size:14px}
    td{padding:9px 0;border-bottom:1px solid #f0ece4;vertical-align:middle}
    tr:last-child td{border-bottom:0}
    td.n{text-align:right;color:#8a8275;white-space:nowrap;padding-left:8px;font-variant-numeric:tabular-nums}
    td.p{width:38%;padding-left:10px;white-space:nowrap;font-variant-numeric:tabular-nums}
    .bar{display:inline-block;width:56%;height:7px;background:#eee8dd;border-radius:4px;
      overflow:hidden;vertical-align:middle;margin-right:6px}
    .bar span{display:block;height:100%}
    .tag{font-size:11px;color:#a0937f;margin-left:4px}
    ul{list-style:none;margin:0;padding:0}
    li{padding:10px 0;border-bottom:1px solid #f0ece4}
    li:last-child{border-bottom:0}
    .q{font-weight:600}
    .a{margin-top:3px;display:flex;gap:14px;font-variant-numeric:tabular-nums}
    .bad{color:#c0392b}.good{color:#2e8b46}
    .meta{font-size:12px;color:#a0937f;margin-top:2px}
    .empty{background:#fff;border-radius:12px;padding:28px 18px;text-align:center;color:#7a6a57}
    .foot{font-size:12px;color:#a0937f;margin-top:28px;line-height:1.7}
  </style>
  <h1>📒 学习记录</h1>
  <div class="sub">水果掉掉乐 · 统计的是这台设备上孩子答过的题</div>
  ${
    total === 0
      ? `<div class="empty">还没有答题记录。<br>孩子过关或失败后点「答题攒钥匙」，就会开始记录。</div>`
      : `
  <div class="tiles">
    <div class="tile"><b>${total}</b><span>共答题</span></div>
    <div class="tile"><b>${pct(ok, total)}%</b><span>总正确率</span></div>
    <div class="tile"><b>${week.length}</b><span>最近 7 天</span></div>
  </div>

  ${
    weak.length
      ? `<h2>最该多练的</h2>
  ${weak
    .map(
      (s) => `<div class="weak">
    <div class="t">${esc(s.topic)}<span class="tag">${SUBJECT_NAME[s.subject] ?? ""}</span></div>
    <div class="d">最近 ${s.recentN} 次对了 ${s.recentOk} 次</div>${
      s.lastWrong
        ? `<div class="ex">上次错题：<b>${esc(s.lastWrong.prompt)}</b>
      <span class="bad">✗ ${esc(s.lastWrong.picked)}</span><span class="good">✓ ${esc(s.lastWrong.answer)}</span></div>`
        : ""
    }
  </div>`,
    )
    .join("")}`
      : `<h2>最该多练的</h2><div class="ok-all">👍 最近各题型正确率都在 75% 以上，没有特别需要补的。</div>`
  }

  <h2>各题型</h2>
  <div class="card"><table>
    ${table
      .map(
        (s) => `<tr>
      <td>${esc(s.topic)}<span class="tag">${SUBJECT_NAME[s.subject] ?? ""}</span></td>
      <td class="p">${bar(pct(s.ok, s.n))}${pct(s.ok, s.n)}%</td>
      <td class="n">${s.ok}/${s.n}</td>
    </tr>`,
      )
      .join("")}
  </table></div>

  ${wrong.length ? `<h2>最近答错的题</h2><div class="card"><ul>${wrong.map(wrongRow).join("")}</ul></div>` : ""}
  `
  }
  <div class="foot">
    正确率低的题型，游戏里会更常出现（最近几次全错的，出现机会大约是全对的 4 倍）。<br>
    这个页面只有在网址后加 <code>?parent=1</code> 才能打开，孩子正常进游戏看不到。<br>
    记录存在这台设备的浏览器里，最多保留最近 600 题。
  </div>`;
  document.body.appendChild(root);
}
