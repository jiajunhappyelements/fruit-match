// ---------------------------------------------------------------------------
// 答题面板：代替原版的「看广告」。点解锁 / 消除 / 打乱时弹出，连答 rounds 题，
// 答对 pass 题道具才生效。纯 Phaser 对象搭的浮层，不新开 Scene——打开期间由
// GameScene 负责暂停物理和 update，这里只管答题。
// ---------------------------------------------------------------------------
import Phaser from "phaser";
import { WIDTH, HEIGHT } from "../config";
import { sfx } from "../audio";
import { nextQuestion, recordAnswer, type Question } from "./index";

const CARD_X = 40;
const CARD_W = WIDTH - 80;
const CARD_Y = 210;
const CARD_H = 860;
const DEPTH = 60;

// Phaser 用「|MÉqgy」量字高，不含中文；安卓上中文字形比它高，不留白就会被切掉顶部
// （实测「丈」出头的那一撇被切掉，看起来像少一点的「文」）。
// 字体也显式给黑体：Phaser 默认 Courier，拼音会变成打字机等宽字。
const FONT = {
  fontFamily: '-apple-system, "PingFang SC", "Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  padding: { top: 10, bottom: 10 },
};

// 中文排版的「避头点」：逗号、句号、问号、右引号这类标点不能出现在行首。
// Phaser 的换行不懂这条，一行刚好排满时，问号会自己掉到下一行
// （实测「7500000000 改写成用『亿』作单位的数是多少？」第三行只剩一个「？」）。
// 做法：让 Phaser 先按宽度换行，再看哪一行是标点开头，就把上一行最后一个字挪下来作伴。
const NO_LINE_START = /^[，。？！、；：）」』》…”’]/u;
function setWrapped(t: Phaser.GameObjects.Text, str: string): void {
  t.setText(str);
  const lines = t.getWrappedText().map((l) => Array.from(l));
  for (let i = 1; i < lines.length; i++) {
    while (lines[i].length && NO_LINE_START.test(lines[i][0]) && lines[i - 1].length > 1) {
      lines[i].unshift(lines[i - 1].pop()!);
    }
  }
  t.setText(lines.map((l) => l.join("")).join("\n"));
}

export interface QuizPanelOpts {
  /** 道具名，比如「解锁」，显示在标题和结果里 */
  what: string;
  rounds: number;
  /** 答对几题算过 */
  pass: number;
  /** 面板关闭时回调，passed = 是否答对够数 */
  onClose: (passed: boolean) => void;
  /** 要不要写答题记录。调试跳关（?level=N）的会话传 false，免得测试数据混进家长看板。 */
  record: boolean;
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
      ...FONT,
      fontSize: "30px",
      fontStyle: "bold",
      color: "#8a5a24",
    })
    .setOrigin(0.5);
  const topic = scene.add
    .text(WIDTH / 2, CARD_Y + 88, "", { ...FONT, fontSize: "24px", color: "#a8823f" })
    .setOrigin(0.5);
  const prompt = scene.add
    .text(WIDTH / 2, CARD_Y + 200, "", {
      ...FONT,
      fontSize: "36px",
      fontStyle: "bold",
      color: "#3b2b17",
      align: "center",
      // 必须用高级换行：Phaser 默认只在空格处断行，中文句子中间没有空格，整句
      // 不换行直接冲出卡片（实测「《出塞》的作者王昌龄是哪个朝代的？」宽 792px，
      // 卡片只有 570px；线上约 14% 的语文题都这样）。高级换行会在字与字之间断开。
      wordWrap: { width: CARD_W - 70, useAdvancedWrap: true },
    })
    .setOrigin(0.5);
  const feedback = scene.add
    .text(WIDTH / 2, CARD_Y + CARD_H - 78, "", {
      ...FONT,
      fontSize: "26px",
      fontStyle: "bold",
      color: "#3aa655",
      align: "center",
      wordWrap: { width: CARD_W - 60, useAdvancedWrap: true }, // 讲解同理，古诗讲解常常一整句没有空格
    })
    .setOrigin(0.5);
  layer.add([progress, topic, prompt, feedback]);

  // 四个选项按钮，复用同一批对象逐题换文字（不反复创建销毁）
  const OPT_W = CARD_W - 90;
  const OPT_H = 84;
  const OPT_TOP = CARD_Y + 330; // 古诗题题面有 3 行，给足空间
  const boxes: Phaser.GameObjects.Rectangle[] = [];
  const labels: Phaser.GameObjects.Text[] = [];
  for (let i = 0; i < 4; i++) {
    const y = OPT_TOP + i * (OPT_H + 22);
    const box = scene.add
      .rectangle(WIDTH / 2, y, OPT_W, OPT_H, 0xffffff)
      .setStrokeStyle(4, 0xd8b98a)
      .setInteractive({ useHandCursor: true });
    const label = scene.add
      .text(WIDTH / 2, y, "", { ...FONT, fontSize: "34px", color: "#3b2b17" })
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
    // 开发环境给自动化测试看当前题（要知道哪个是对的才能测「过关」那条路）
    if ((import.meta as any).env?.DEV) (window as any).__quizCurrent = current;
    lastTopic = current.topic;
    round++;
    progress.setText(`答题${opts.what}  ${round}/${opts.rounds}`);
    topic.setText(current.topic);
    setWrapped(prompt, current.prompt);
    feedback.setText("");
    current.options.forEach((o, i) => labels[i].setText(o));
    paintIdle();
    locked = false;
  }

  function choose(i: number): void {
    if (locked || !current) return;
    locked = true;
    const right = i === current.answer;
    if (opts.record) {
      recordAnswer({
        t: Date.now(),
        subject: current.subject,
        topic: current.topic,
        prompt: current.prompt,
        picked: current.options[i],
        answer: current.options[current.answer],
        ok: right,
      });
    }
    boxes[i].setFillStyle(right ? 0xd7f5cf : 0xffd9d6);
    boxes[i].setStrokeStyle(5, right ? 0x3aa655 : 0xd9534f);
    if (!right) {
      boxes[current.answer].setFillStyle(0xd7f5cf);
      boxes[current.answer].setStrokeStyle(5, 0x3aa655);
    }
    if (right) {
      correct++;
      sfx.unlock();
      feedback.setColor("#3aa655").setText(`答对啦！（已对 ${correct} 题，要对 ${opts.pass} 题）`);
    } else {
      sfx.shuffle();
      feedback.setColor("#c0392b");
      setWrapped(feedback, current.explain ?? "再看看这一题");
    }
    scene.time.delayedCall(right ? 750 : 2100, () => {
      if (round >= opts.rounds) finish();
      else ask();
    });
  }

  function finish(): void {
    boxes.forEach((b) => b.disableInteractive().setVisible(false));
    labels.forEach((l) => l.setVisible(false));
    const passed = correct >= opts.pass;
    topic.setText("");
    progress.setText("答完啦");
    prompt.setText(
      passed
        ? `答对 ${correct} 题\n${opts.what}成功！🎉`
        : `答对 ${correct} 题\n要答对 ${opts.pass} 题才能${opts.what}`,
    );
    feedback
      .setColor("#8a5a24")
      .setText(passed ? "" : `再点一次「${opts.what}」可以重新答`);
    const btn = scene.add
      .rectangle(WIDTH / 2, CARD_Y + CARD_H - 150, 280, 88, 0x3aa655)
      .setStrokeStyle(5, 0x24602a)
      .setInteractive({ useHandCursor: true });
    const btnTxt = scene.add
      .text(WIDTH / 2, CARD_Y + CARD_H - 150, "好的", {
        ...FONT,
        fontSize: "38px",
        fontStyle: "bold",
        color: "#ffffff",
      })
      .setOrigin(0.5);
    btn.on("pointerdown", () => {
      layer.destroy(true);
      opts.onClose(passed);
    });
    layer.add([btn, btnTxt]);
  }

  ask();
}
