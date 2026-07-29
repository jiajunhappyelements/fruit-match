#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// One-off asset generation tool (not part of the game build). It talks to an
// image-generation endpoint that must be supplied via the environment:
//   AIHUB_BASE_URL    base URL of the image API
//   AIHUB_SESSION_ID  session id for the chat/image endpoint
//   AIHUB_TOKEN_FILE  file holding BUILT_IN_AIHUB_TOKEN=<token>
// The generated PNGs are committed under public/assets/, so you only need this
// when adding or re-rolling produce art.
const BASE_URL = process.env.AIHUB_BASE_URL;
const SESSION_ID = process.env.AIHUB_SESSION_ID;
const MODEL = process.env.AIHUB_IMAGE_MODEL || "azure-gpt-image-2";
const IMAGE_RESOLUTION = process.env.AIHUB_IMAGE_RESOLUTION || "high";
const ASPECT_RATIO = "1:1";
const TOKEN_FILE =
  process.env.AIHUB_TOKEN_FILE || path.join(os.homedir(), "Documents/aihub.env");
const PACK = process.env.PRODUCE_PACK || "base";
const OUT_DIR = path.resolve(
  process.env.OUT_DIR || (PACK === "extra" ? "public/assets/produce" : "public/assets/fruits"),
);
const TMP_DIR = path.resolve("tmp/aihub-fruits");
const ASSET_SIZE = 256;
const CHROMA_KEY = "#ff00ff";
const CONCURRENCY = Number(process.env.AIHUB_CONCURRENCY || 1);
const FORCE = process.env.FORCE === "1";
const ONLY = new Set(
  (process.env.ITEMS || process.env.FRUITS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const baseProduce = [
  ["watermelon", "a juicy watermelon wedge with red flesh, black seeds, and a green rind"],
  ["strawberry", "a glossy ripe strawberry with leafy green top"],
  ["banana", "a small cheerful bunch of curved ripe yellow bananas"],
  ["blueberry", "a plump cluster of blueberries with natural bloom and tiny crown details"],
  ["lemon", "a bright whole lemon with a small glossy green leaf"],
  ["grape", "a compact bunch of purple grapes with a small green leaf"],
  ["peach", "a soft peach with rosy blush, center groove, and one green leaf"],
  ["apple", "a shiny red apple with a short stem and one green leaf"],
  ["kiwi", "a cut kiwi half showing green flesh, black seeds, and fuzzy brown skin"],
  ["orange", "a glossy orange with dimpled peel and one green leaf"],
  ["pineapple", "a cute small pineapple with golden body and green crown"],
  ["cherry", "two glossy red cherries joined by curved green stems"],
];

const extraProduce = [
  ["mango", "a ripe golden mango with a soft red blush and one small green leaf"],
  ["pear", "a glossy green pear with a short brown stem and one leaf"],
  ["coconut", "a cracked coconut half with white flesh and textured brown shell"],
  ["pomegranate", "a ruby red pomegranate split open with jewel-like seeds"],
  ["dragonfruit", "a vivid pink dragon fruit half with white flesh and tiny black seeds"],
  ["avocado", "a cut avocado half with creamy green flesh and a round brown pit"],
  ["carrot", "a bright orange carrot with fresh leafy green top"],
  ["tomato", "a plump red tomato with glossy skin and green star calyx"],
  ["cucumber", "a crisp green cucumber with subtle bumps and one cut end"],
  ["eggplant", "a shiny purple eggplant with green cap and curved body"],
  ["pumpkin", "a small cute orange pumpkin with ribbed body and green stem"],
  ["corn", "a golden corn cob with a few green husk leaves"],
  ["onion", "a round purple onion with glossy layered skin and tiny roots"],
  ["mushroom", "a cute button mushroom with beige cap and white stem"],
  ["bell-pepper", "a shiny red bell pepper with green stem and chunky silhouette"],
  ["broccoli", "a bright green broccoli crown with short pale stem"],
];

const packs = {
  base: baseProduce,
  extra: extraProduce,
  all: [...baseProduce, ...extraProduce],
};

const produce = (packs[PACK] || packs.base).filter(
  ([key]) => ONLY.size === 0 || ONLY.has(key),
);

function decodeExp(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")).exp || 0;
  } catch {
    return 0;
  }
}

async function readTokenFile() {
  const raw = await fs.readFile(TOKEN_FILE, "utf8");
  const m = raw.match(/^BUILT_IN_AIHUB_TOKEN=(.+)$/m);
  if (!m) throw new Error(`Missing BUILT_IN_AIHUB_TOKEN in ${TOKEN_FILE}`);
  return {
    raw,
    token: m[1].trim().replace(/^["']|["']$/g, ""),
  };
}

async function writeTokenFile(raw, token) {
  const next = raw.replace(
    /^BUILT_IN_AIHUB_TOKEN=.*$/m,
    `BUILT_IN_AIHUB_TOKEN=${token}`,
  );
  const tmp = `${TOKEN_FILE}.tmp`;
  await fs.writeFile(tmp, next, "utf8");
  await fs.rename(tmp, TOKEN_FILE);
}

async function getToken() {
  const cur = await readTokenFile();
  const exp = decodeExp(cur.token);
  const now = Math.floor(Date.now() / 1000);
  if (exp - now > 120 * 60) return cur.token;

  const resp = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cur.token}`,
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`AIHub token refresh failed HTTP ${resp.status}`);
  }
  const json = await resp.json();
  const next = json?.data?.token;
  if (!next) throw new Error("AIHub token refresh returned no token");
  await writeTokenFile(cur.raw, next);
  return next;
}

function promptFor(description) {
  return [
    `Premium casual mobile puzzle game produce icon: ${description}.`,
    "Match a high-end 3D hand-painted casual game asset style: glossy, appetizing, soft studio lighting, crisp silhouette, polished material detail, playful proportions.",
    `Centered single object on a perfectly flat solid ${CHROMA_KEY} chroma-key background for background removal.`,
    "Fruit fills about 78% of the frame with generous padding; keep the full object visible.",
    `Do not use ${CHROMA_KEY} anywhere in the fruit.`,
    "No cast shadow, no contact shadow, no floor plane, no border, no label, no text, no watermark, no UI.",
  ].join(" ");
}

async function postJson(url, token, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 240)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function generateRaw(key, description, token) {
  const body = {
    session_id: SESSION_ID,
    model: MODEL,
    messages: [{ role: "user", content: promptFor(description), attachments: [] }],
    temperature: 0.7,
    max_tokens: 0,
    system_prompt: "",
    ppt_mode: false,
    generation_mode: "image",
    agent_mode: false,
    image_aspect_ratio: ASPECT_RATIO,
    image_resolution: IMAGE_RESOLUTION,
  };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const text = await postJson(`${BASE_URL}/api/ai-chat/completions`, token, body);
      const m = text.match(/\/uploads\/[^\s)"'\\]+/);
      if (!m) throw new Error(`AIHub returned no image URL: ${text.slice(0, 240)}`);
      const imgUrl = m[0].startsWith("http") ? m[0] : BASE_URL + m[0];
      const imgResp = await fetch(imgUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!imgResp.ok) throw new Error(`download HTTP ${imgResp.status}`);
      const rawPath = path.join(TMP_DIR, `${key}-raw.png`);
      await fs.writeFile(rawPath, Buffer.from(await imgResp.arrayBuffer()));
      return { rawPath, imgUrl };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`  ${key}: attempt ${attempt} failed, retrying: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
  }
  throw lastError;
}

function processImage(rawPath, outPath) {
  const script = `
from PIL import Image
import sys

inp, outp, size_s = sys.argv[1], sys.argv[2], sys.argv[3]
size = int(size_s)
img = Image.open(inp).convert("RGBA")
px = img.load()
w, h = img.size
key = (255, 0, 255)
low = 24
high = 92

for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        d = ((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2) ** 0.5
        if d <= low:
            px[x, y] = (r, g, b, 0)
        elif d < high:
            alpha = int(255 * ((d - low) / (high - low)) ** 1.7)
            px[x, y] = (r, g, b, min(a, alpha))

alpha = img.getchannel("A")
bbox = alpha.getbbox()
if not bbox:
    raise SystemExit("no non-transparent pixels found")

pad = max(14, int(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.08))
left = max(0, bbox[0] - pad)
top = max(0, bbox[1] - pad)
right = min(w, bbox[2] + pad)
bottom = min(h, bbox[3] + pad)
crop = img.crop((left, top, right, bottom))
cw, ch = crop.size
scale = min(size * 0.92 / cw, size * 0.92 / ch)
nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
canvas.alpha_composite(crop, ((size - nw) // 2, (size - nh) // 2))
canvas.save(outp)
`;
  execFileSync("python3", ["-c", script, rawPath, outPath, String(ASSET_SIZE)], {
    stdio: "inherit",
  });
}

async function runLimited(items, limit, worker) {
  const executing = new Set();
  const results = [];
  for (const item of items) {
    const promise = Promise.resolve().then(() => worker(item));
    results.push(promise);
    executing.add(promise);
    const clean = () => executing.delete(promise);
    promise.then(clean, clean);
    if (executing.size >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

if (!BASE_URL || !SESSION_ID) {
  console.error(
    "Set AIHUB_BASE_URL and AIHUB_SESSION_ID (and AIHUB_TOKEN_FILE) before running this generator.",
  );
  process.exit(1);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(TMP_DIR, { recursive: true });

const token = await getToken();
console.log(
  `Generating ${produce.length} ${PACK} produce assets with ${MODEL} (${IMAGE_RESOLUTION}), concurrency ${CONCURRENCY}`,
);

const failures = [];
await runLimited(produce, Math.max(1, CONCURRENCY), async ([key, description]) => {
  const outPath = path.join(OUT_DIR, `${key}.png`);
  if (!FORCE) {
    try {
      await fs.access(outPath);
      console.log(`- ${key}: exists, skipping`);
      return;
    } catch {
      // Missing file: generate it below.
    }
  }

  console.log(`- ${key}: requesting AIHub image`);
  try {
    const { rawPath, imgUrl } = await generateRaw(key, description, token);
    processImage(rawPath, outPath);
    console.log(`  saved ${path.relative(process.cwd(), outPath)} from ${imgUrl}`);
  } catch (error) {
    failures.push([key, error]);
    console.error(`  ${key}: failed after retries: ${error.message}`);
  }
});

if (failures.length > 0) {
  console.error("Failed produce:");
  for (const [key, error] of failures) {
    console.error(`- ${key}: ${error.message}`);
  }
  process.exitCode = 1;
}

console.log("Done.");
