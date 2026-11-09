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
