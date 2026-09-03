// ---------------------------------------------------------------------------
// 答题面板：结算页点「答题攒钥匙」弹出，答对一题得一把钥匙。
// 纯 Phaser 对象搭的浮层，不新开 Scene —— 结算页已经 gameOver，主场景是静止的。
// ---------------------------------------------------------------------------
import Phaser from "phaser";
import { WIDTH, HEIGHT } from "../config";
import { sfx } from "../audio";
import { nextQuestion, type Question } from "./index";

const CARD_X = 40;
const CARD_W = WIDTH - 80;
const CARD_Y = 210;
const CARD_H = 860;
const DEPTH = 60;

export interface QuizPanelOpts {
  rounds: number;
  /** 每答对一题回调一次，用来加钥匙、刷新 HUD。 */
  onCorrect: () => void;
  onClose: () => void;
}

export function showQuizPanel(scene: Phaser.Scene, opts: QuizPanelOpts): void {
  const layer = scene.add.container(0, 0).setDepth(DEPTH);

  // 吃掉点击，免得穿透到底下的水果/按钮
  const dim = scene.add
    .rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x000000, 0.78)
    .setInteractive();
  const card = scene.add.graphics();
  card.fillStyle(0xfdf6e3, 1);
  card.fillRoundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, 28);
  card.lineStyle(6, 0xc98f4a, 1);
  card.strokeRoundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, 28);
  layer.add([dim, card]);

  const progress = scene.add
    .text(WIDTH / 2, CARD_Y + 44, "", {
      fontSize: "30px",
      fontStyle: "bold",
      color: "#8a5a24",
    })
    .setOrigin(0.5);
  const topic = scene.add
    .text(WIDTH / 2, CARD_Y + 88, "", { fontSize: "24px", color: "#a8823f" })
    .setOrigin(0.5);
  const prompt = scene.add
    .text(WIDTH / 2, CARD_Y + 190, "", {
      fontSize: "36px",
      fontStyle: "bold",
      color: "#3b2b17",
      align: "center",
      wordWrap: { width: CARD_W - 70 },
    })
    .setOrigin(0.5);
  const feedback = scene.add
    .text(WIDTH / 2, CARD_Y + CARD_H - 78, "", {
      fontSize: "26px",
      fontStyle: "bold",
      color: "#3aa655",
      align: "center",
      wordWrap: { width: CARD_W - 60 },
    })
    .setOrigin(0.5);
  layer.add([progress, topic, prompt, feedback]);

  // 四个选项按钮，复用同一批对象逐题换文字（不反复创建销毁）
  const OPT_W = CARD_W - 90;
  const OPT_H = 84;
  const OPT_TOP = CARD_Y + 300;
  const boxes: Phaser.GameObjects.Rectangle[] = [];
  const labels: Phaser.GameObjects.Text[] = [];
  for (let i = 0; i < 4; i++) {
    const y = OPT_TOP + i * (OPT_H + 22);
    const box = scene.add
      .rectangle(WIDTH / 2, y, OPT_W, OPT_H, 0xffffff)
      .setStrokeStyle(4, 0xd8b98a)
      .setInteractive({ useHandCursor: true });
    const label = scene.add
      .text(WIDTH / 2, y, "", { fontSize: "34px", color: "#3b2b17" })
      .setOrigin(0.5);
    box.on("pointerdown", () => choose(i));
    boxes.push(box);
    labels.push(label);
    layer.add([box, label]);
  }

  let round = 0;
  let correct = 0;
  let current: Question | null = null;
  let locked = false;
  let lastTopic: string | undefined;

  function paintIdle(): void {
    boxes.forEach((b) => {
      b.setFillStyle(0xffffff);
      b.setStrokeStyle(4, 0xd8b98a);
    });
  }

  function ask(): void {
    current = nextQuestion(lastTopic);
    if (!current) return finish();
    lastTopic = current.topic;
    round++;
    progress.setText(`答题攒钥匙  ${round}/${opts.rounds}`);
    topic.setText(current.topic);
    prompt.setText(current.prompt);
    feedback.setText("");
    current.options.forEach((o, i) => labels[i].setText(o));
    paintIdle();
    locked = false;
  }

  function choose(i: number): void {
    if (locked || !current) return;
    locked = true;
    const right = i === current.answer;
    boxes[i].setFillStyle(right ? 0xd7f5cf : 0xffd9d6);
    boxes[i].setStrokeStyle(5, right ? 0x3aa655 : 0xd9534f);
    if (!right) {
      boxes[current.answer].setFillStyle(0xd7f5cf);
      boxes[current.answer].setStrokeStyle(5, 0x3aa655);
    }
    if (right) {
      correct++;
      opts.onCorrect();
      sfx.unlock();
      feedback.setColor("#3aa655").setText("答对啦，+1 🔑");
    } else {
      sfx.shuffle();
      feedback.setColor("#c0392b").setText(current.explain ?? "再看看这一题的算法");
    }
    scene.time.delayedCall(right ? 750 : 2100, () => {
      if (round >= opts.rounds) finish();
      else ask();
    });
  }

  function finish(): void {
    boxes.forEach((b) => b.disableInteractive().setVisible(false));
    labels.forEach((l) => l.setVisible(false));
    topic.setText("");
    progress.setText("答完啦");
    prompt.setText(
      correct > 0
        ? `答对 ${correct} 题，拿到 ${correct} 把钥匙 🔑`
        : "这次一把也没拿到，下次再来～",
    );
    feedback.setColor("#8a5a24").setText("钥匙可以在游戏里点砖块解锁底部空位");
    const btn = scene.add
      .rectangle(WIDTH / 2, CARD_Y + CARD_H - 150, 280, 88, 0x3aa655)
      .setStrokeStyle(5, 0x24602a)
      .setInteractive({ useHandCursor: true });
    const btnTxt = scene.add
      .text(WIDTH / 2, CARD_Y + CARD_H - 150, "好的", {
        fontSize: "38px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    btn.on("pointerdown", () => {
      layer.destroy(true);
      opts.onClose();
    });
    layer.add([btn, btnTxt]);
  }

  ask();
}
