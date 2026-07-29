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
      gravity: { x: 0, y: 0.85 },
      // More solver iterations so fast-falling fruit can't tunnel through walls.
      positionIterations: 12,
      velocityIterations: 8,
      debug: false,
    },
  },
  scene: [GameScene],
};

new Phaser.Game(config);
