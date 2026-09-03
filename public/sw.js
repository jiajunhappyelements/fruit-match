// ---------------------------------------------------------------------------
// Service worker.
//
// 两个作用：
// 1. Chrome 安卓版认「装得了的应用」的硬性条件之一就是有注册过、且带 fetch
//    处理的 service worker。没有它，菜单里只有「添加到主屏幕」，做出来是书签，
//    点开还是 Chrome 页签；有它才会出现「安装应用」，才是 manifest 里
//    display:fullscreen 说的那种全屏启动。
// 2. 顺带离线可玩 —— 孩子在电梯里、地铁上也能打开。
// ---------------------------------------------------------------------------
const CACHE = "fruit-match-v1";

self.addEventListener("install", () => {
  // 不等旧版本的页面关掉，新版本立刻接管
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 打开页面：网络优先。这样每次发布的新版本都能拿到，
  // 断网时才退回缓存里的上一份。
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (
            (await caches.match(req)) ??
            (await caches.match("./")) ??
            new Response("离线了，联网后再打开一次就好", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  // 静态资源（打包产物带哈希名、水果图不变）：缓存优先，后台顺手更新。
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req)
        .then(async (res) => {
          if (res && res.ok) {
            const cache = await caches.open(CACHE);
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => null);
      return cached ?? (await network) ?? Response.error();
    })(),
  );
});
