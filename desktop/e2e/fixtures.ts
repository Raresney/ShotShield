import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

const require = createRequire(import.meta.url);
prepareZXingModule({
  overrides: { wasmBinary: readFileSync(require.resolve("zxing-wasm/writer/zxing_writer.wasm")).buffer as ArrayBuffer },
});

// Fake data only: an example.com address and the IBAN from the ECBS examples.
export const EMAIL = "maria.popescu@example.com";
export const IBAN = "RO49AAAA1B31007593840000";

/**
 * A small digital PDF, one page per entry, set in Helvetica (not embedded).
 * `rotate` sets every page's /Rotate, as a scanner app does for a page fed in
 * upside down.
 */
export function textPdf(pages: string[][], rotate = 0): Buffer {
  const objs: string[] = [];
  const add = (body: string): number => objs.push(body);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objs.length + 1 + pages.length * 2;
  const kids: number[] = [];
  for (const lines of pages) {
    const ops = `BT /F1 16 Tf 60 760 Td 24 TL ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    const content = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Rotate ${rotate} /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`,
      ),
    );
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Draw lines of text into a PNG inside the page, the way a screenshot looks. */
export async function screenshotPng(page: Page, lines: string[]): Promise<Buffer> {
  const dataUrl = await page.evaluate((text) => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 80 + text.length * 48;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111111";
    g.font = "28px Arial, sans-serif";
    text.forEach((l, i) => g.fillText(l, 40, 70 + i * 48));
    return c.toDataURL("image/png");
  }, lines);
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

/** Settled filmstrip labels, e.g. ["2 covered"], once nothing is still scanning. */
export async function settledFilms(page: Page, count: number): Promise<string[]> {
  const films = page.locator("#filmstrip .film");
  await page.waitForFunction(
    (n) => {
      const f = [...document.querySelectorAll("#filmstrip .film")];
      return f.length === n && f.every((el) => /covered|exposed/.test(el.textContent ?? ""));
    },
    count,
    { timeout: 80_000 },
  );
  return (await films.allTextContents()).map((t) => t.trim());
}

/** A screenshot with a line of text and a QR code holding `payload` beside it. */
export async function qrPng(page: Page, caption: string, payload: string): Promise<Buffer> {
  const { svg, error } = await writeBarcode(payload, { format: "QRCode" });
  if (error) throw new Error(error);
  const dataUrl = await page.evaluate(
    async ({ caption, svg }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 900;
      c.height = 420;
      const g = c.getContext("2d")!;
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "#111111";
      g.font = "28px Arial, sans-serif";
      g.fillText(caption, 40, 70);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 560, 100, 280, 280);
      return c.toDataURL("image/png");
    },
    { caption, svg },
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}
