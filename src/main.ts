import Phaser from "phaser";
import { WIDTH, HEIGHT } from "./config";
import { GameScene } from "./scenes/GameScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#aee3ff",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WIDTH,
    height: HEIGHT,
  },
  physics: {
    default: "matter",
    matter: {
      // 下落手感：1006px 的自由落体 0.85→1.83s、1.3→1.43s（快 22%）。
      // 卡手感的是重力不是 MAX_FALL_SPEED —— 0.85 时峰值只有 15.6，
      // 根本碰不到 22 的限速；1.3 时峰值 20.6，仍在限速内、离最薄的墙(40px)
      // 还有近一倍余量。再往上到 1.5 就顶到限速了，加也白加。
      gravity: { x: 0, y: 1.3 },
      // More solver iterations so fast-falling fruit can't tunnel through walls.
      positionIterations: 12,
      velocityIterations: 8,
      debug: false,
    },
  },
  scene: [GameScene],
};

new Phaser.Game(config);

// 注册 service worker —— 这是 Chrome 安卓版把网页当「应用」安装的前提，
// 装出来才会全屏启动而不是开一个 Chrome 页签（顺带离线可玩）。
// 只在打包产物里注册：开发服务器上注册会缓存住 HMR 的模块，改了代码看不到。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // 相对当前页面解析，所以在 GitHub Pages 的 /fruit-match/ 子路径下也对
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* 装不上就当普通网页玩，不打扰 */
    });
  });
}
