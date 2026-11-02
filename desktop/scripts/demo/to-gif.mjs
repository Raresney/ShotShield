// Turn the recorded demo video into docs/demo.gif with ffmpeg (two passes: a
// palette tuned to the clip, then the GIF). Needs ffmpeg on PATH.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const videos = readdirSync(out, { recursive: true })
  .map(String)
  .filter((f) => f.endsWith(".webm"))
  .map((f) => join(out, f));
if (videos.length === 0) throw new Error("No recording found: run `npm run demo -w desktop` first.");
const video = videos.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

const gif = join(here, "..", "..", "..", "docs", "demo.gif");
const filters = "fps=12,scale=960:-1:flags=lanczos";
execFileSync(
  "ffmpeg",
  [
    "-y", "-i", video,
    "-vf", `${filters},split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    gif,
  ],
  { stdio: "inherit" },
);
console.log(`wrote ${gif} (${(statSync(gif).size / 1024 / 1024).toFixed(2)} MB)`);
