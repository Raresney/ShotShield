import { test } from "@playwright/test";

// Every value below is made up. Keys are split so no scanner mistakes this
// file for a leak.
const ENV = [
  "# api/.env",
  "NODE_ENV=production",
  "DATABASE_URL=postgres://admin:" + "Tr0ub4dor-77@db.internal:5432/app",
  "STRIPE_SECRET_KEY=sk_" + "live_" + "51Hq8kLmN2pQ7rS4tU6vW8xY0zA",
  "GITHUB_TOKEN=ghp_" + "R7nQ2mK9xV4bT6wL1pZ8cJ3hF5dS0aE2yU7i",
  "SUPPORT_EMAIL=maria.popescu@example.com",
  "SUPPORT_PHONE=+40 721 234 567",
  "PAYOUT_IBAN=RO49AAAA1B31007593840000",
  "LOG_LEVEL=info",
];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("demo", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // An editor-style screenshot of the file, drawn in the page.
  const png = await page.evaluate((lines) => {
    const c = document.createElement("canvas");
    c.width = 1100;
    c.height = 60 + lines.length * 46;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1e1f24";
    g.fillRect(0, 0, c.width, c.height);
    g.font = "26px Consolas, 'Cascadia Mono', monospace";
    lines.forEach((l, i) => {
      g.fillStyle = "#6b7280";
      g.fillText(String(i + 1).padStart(2, " "), 20, 56 + i * 46);
      g.fillStyle = l.startsWith("#") ? "#7f8796" : "#e6e6e6";
      g.fillText(l, 80, 56 + i * 46);
    });
    return c.toDataURL("image/png").split(",")[1]!;
  }, ENV);

  await pause(900);
  await page.locator("#file").setInputFiles({ name: "env.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForFunction(() => /covered/.test(document.querySelector("#summary")?.textContent ?? ""), null, { timeout: 60_000 });
  await pause(1600);

  // Peek at one finding, then cover it again.
  const row = page.locator("#results .hit", { hasText: "Email" });
  await row.hover();
  await pause(700);
  await row.click();
  await pause(1100);
  await row.click();
  await pause(900);

  // Hold compare to see the original for a moment.
  const compare = page.locator("#compare");
  const box = (await compare.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await pause(1100);
  await page.mouse.up();
  await pause(1400);
});
