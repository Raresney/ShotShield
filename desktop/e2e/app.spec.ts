import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { EMAIL, IBAN, screenshotPng, settledFilms, textPdf } from "./fixtures.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("text mode finds secrets as you type and copies a redacted version", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator("#modeText").click();
  await page.locator("#input").fill(`Contact ${EMAIL}\nIBAN ${IBAN}`);

  await expect(page.locator("#findingsCount")).toHaveText("2");
  await expect(page.locator("#results .hit-label")).toHaveText(["IBAN", "Email address"]);

  await page.locator("#copyClipboard").click();
  // The Windows clipboard hands newlines back as CRLF.
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  expect(copied).toBe("Contact [REDACTED]\nIBAN [REDACTED]");
});

test("an image is read, covered, toggled and saved", async ({ page }) => {
  const png = await screenshotPng(page, ["Invoice 2026-114", `Email: ${EMAIL}`, `IBAN: ${IBAN}`]);
  await page.locator("#file").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: png });

  await expect(page.locator("#summary")).toHaveText("2 of 2 covered", { timeout: 80_000 });
  const iban = page.locator("#results .hit", { hasText: "IBAN" });
  await expect(iban).toHaveAttribute("aria-pressed", "true");

  // Uncover one finding, then cover it again from the list.
  await iban.click();
  await expect(page.locator("#summary")).toHaveText("1 of 2 covered");
  await iban.click();
  await expect(page.locator("#summary")).toHaveText("2 of 2 covered");

  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("invoice-redacted.png");
  const bytes = await readFile((await file.path())!);
  expect([...bytes.subarray(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
});

test("an ID card's CNP is covered through its MRZ even when misread", async ({ page }) => {
  // A made-up card. The "#" stands in for a mark OCR reads inside the number,
  // which no CNP pattern accepts; the card's MRZ still spells the CNP out.
  const png = await screenshotPng(page, [
    "ROMANIA CARTE DE IDENTITATE",
    "CNP 2950312#401231",
    "IDROUPOPESCU<<ANA<<<<<<<<<<<<<<<<<<<",
    "ZZ123456<1ROU9503124F301015024012313",
  ]);
  await page.locator("#file").setInputFiles({ name: "card.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#summary")).toHaveText(/^(\d+) of \1 covered$/, { timeout: 80_000 });
  const labels = await page.locator("#results .hit-label").allTextContents();
  expect(labels.filter((l) => l === "CNP (RO)")).toHaveLength(1);
  expect(labels.filter((l) => l === "ID machine-readable zone")).toHaveLength(2);
});

test("a settings change keeps what was covered or uncovered by hand", async ({ page }) => {
  const png = await screenshotPng(page, [`Email: ${EMAIL}`, `IBAN: ${IBAN}`]);
  await page.locator("#file").setInputFiles({ name: "mixed.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#summary")).toHaveText("2 of 2 covered", { timeout: 80_000 });

  await page.locator("#results .hit", { hasText: "IBAN" }).click();
  await expect(page.locator("#summary")).toHaveText("1 of 2 covered");

  await page.locator("#settingsBtn").click();
  await page.getByRole("radio", { name: "Mosaic" }).click();
  await expect(page.locator("#summary")).toHaveText("1 of 2 covered");
  await expect(page.locator("#results .hit", { hasText: "IBAN" })).toHaveAttribute("aria-pressed", "false");
});

test("a PDF opens page by page and saves back as a redacted PDF", async ({ page }) => {
  const pdf = textPdf([
    ["Statement", `Email: ${EMAIL}`],
    ["Payment details", `IBAN: ${IBAN}`],
  ]);
  await page.locator("#file").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: pdf });

  expect(await settledFilms(page, 2)).toEqual(["1 covered", "1 covered"]);
  const savePdf = page.locator("#exportPdf");
  await expect(savePdf).toHaveText("Save as PDF · 2 pages");

  const download = page.waitForEvent("download");
  await savePdf.click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("statement-redacted.pdf");
  const text = (await readFile((await file.path())!)).toString("latin1");
  expect(text.startsWith("%PDF-")).toBe(true);
  expect(text).toContain("/Count 2");
  // Flattened pages: the original text never makes it into the copy.
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain("/Font");
});

for (const rotate of [0, 90, 180, 270]) {
  test(`a PDF page turned ${rotate}° is covered where its text is drawn`, async ({ page }) => {
    // The address is the only ink on the page, so the dark pixels of the
    // uncovered page are exactly the text, and the pixels the cover changes are
    // exactly the cover.
    await page.locator("#file").setInputFiles({
      name: "turned.pdf",
      mimeType: "application/pdf",
      buffer: textPdf([[EMAIL]], rotate),
    });
    await expect(page.locator("#summary")).toHaveText("1 of 1 covered", { timeout: 80_000 });

    // Keep the covered pixels in the page; shipping a whole page over CDP is slow.
    await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>("#canvas")!;
      (window as unknown as { covered: Uint8ClampedArray }).covered = c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height).data;
    });
    await page.locator("#results .hit").click();
    await expect(page.locator("#summary")).toHaveText("0 of 1 covered");

    const { ink, cover } = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>("#canvas")!;
      const open = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      const covered = (window as unknown as { covered: Uint8ClampedArray }).covered;
      const bounds = (keep: (i: number) => boolean) => {
        const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (let i = 0; i < open.length; i += 4) {
          if (!keep(i)) continue;
          const x = (i / 4) % c.width;
          const y = Math.floor(i / 4 / c.width);
          if (x < r.x0) r.x0 = x;
          if (x > r.x1) r.x1 = x;
          if (y < r.y0) r.y0 = y;
          if (y > r.y1) r.y1 = y;
        }
        return r;
      };
      return { ink: bounds((i) => open[i]! < 128), cover: bounds((i) => open[i] !== covered[i]) };
    });
    expect(ink.x1).toBeGreaterThan(ink.x0);
    expect(cover.x0).toBeLessThanOrEqual(ink.x0);
    expect(cover.y0).toBeLessThanOrEqual(ink.y0);
    expect(cover.x1).toBeGreaterThanOrEqual(ink.x1);
    expect(cover.y1).toBeGreaterThanOrEqual(ink.y1);
  });
}

test("right-click a finding to never cover it again", async ({ page }) => {
  await page.locator("#modeText").click();
  await page.locator("#input").fill(`Me: ${EMAIL}, them: eve@evil.example`);
  await expect(page.locator("#findingsCount")).toHaveText("2");

  await page.locator("#results .hit").first().click({ button: "right" });
  await page.locator(".allow-menu button").click();
  await expect(page.locator("#findingsCount")).toHaveText("1");

  // It sticks: the allow list is saved with the settings.
  await page.reload();
  await page.locator("#modeText").click();
  await page.locator("#input").fill(`Me: ${EMAIL}, them: eve@evil.example`);
  await expect(page.locator("#findingsCount")).toHaveText("1");
});

test("a hand-drawn box covers what the scan missed and undoes cleanly", async ({ page }) => {
  const png = await screenshotPng(page, ["Nothing sensitive here", "Just a note"]);
  await page.locator("#file").setInputFiles({ name: "note.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#summary")).toHaveText(/Nothing sensitive/, { timeout: 80_000 });

  const box = (await page.locator("#canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#results .hit-manual")).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect(page.locator("#results .hit-manual")).toHaveCount(0);
});
