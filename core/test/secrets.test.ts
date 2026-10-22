import { test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../src/index.ts";
import { bech32Valid, publicIpv4 } from "../src/validators.ts";

// Every key-shaped fixture is split across a "+" so the contiguous token never
// lands in a blob — GitHub push protection rejects the branch otherwise.

const ALNUM = "A1b2C3d4E5f6G7h8J9k0";
const body = (n: number): string => ALNUM.repeat(Math.ceil(n / ALNUM.length)).slice(0, n);
const hex = (n: number): string => "0123456789abcdef".repeat(Math.ceil(n / 16)).slice(0, n);

const labels = (text: string): string[] => scan(text).map((d) => d.label);
const only = (text: string) => {
  const d = scan(text);
  assert.equal(d.length, 1, `expected one hit in ${JSON.stringify(text)}, got ${JSON.stringify(d)}`);
  return d[0]!;
};

test("vendor key formats are labelled by vendor", () => {
  const cases: [string, string][] = [
    ["sk-" + "ant-api03-" + body(40), "Anthropic API key"],
    ["sk-" + "proj-" + body(40), "OpenAI API key"],
    ["github" + "_pat_" + body(22) + "_" + body(59), "GitHub token"],
    ["glpat" + "-" + body(20), "GitLab token"],
    ["npm" + "_" + body(36), "npm token"],
    ["hf" + "_" + body(34), "Hugging Face token"],
    ["ASIA" + "ABCDEFGHIJKLMNOP", "AWS access key ID"],
    ["ya29" + "." + body(30), "Google OAuth token"],
    ["https://hooks.slack.com/services/" + "T0123ABCD/B0123ABCD/" + body(24), "Slack webhook"],
    ["https://discord.com/api/webhooks/" + "123456789012345678/" + body(68), "Discord webhook"],
    ["123456789" + ":AA" + body(33), "Telegram bot token"],
    ["whsec" + "_" + body(32), "Stripe webhook secret"],
    ["shpat" + "_" + hex(32), "Shopify token"],
    ["dop" + "_v1_" + hex(64), "DigitalOcean token"],
    ["SK" + hex(32), "Twilio API key"],
  ];
  for (const [text, label] of cases) {
    assert.equal(only(`${text} end`).label, label, text);
  }
});

test("an Anthropic key is no longer mislabelled as OpenAI", () => {
  assert.deepEqual(labels("sk-" + "ant-api03-" + body(60)), ["Anthropic API key"]);
});

test("OCR reading a prefix underscore as a space still matches", () => {
  // What Tesseract actually returned for a Stripe key in a screenshot.
  const d = only("key sk_live " + "4eC39HqLyjWDarjtT1zdp/dc");
  assert.equal(d.label, "Stripe secret key");
  assert.equal(only("gh" + "p " + body(36)).label, "GitHub token");
});

test("a key body split by OCR is covered across the gap", () => {
  const first = "sk-" + "proj-" + body(24);
  const second = "9x" + body(14);
  const d = only(`${first} ${second} is the key`);
  assert.equal(d.text, `${first} ${second}`);
});

test("a split tail never glues an ordinary word onto a key", () => {
  const key = "sk-" + "proj-" + body(24);
  assert.equal(only(`${key} production environment`).text, key);
});

test("secrets assigned to a name are covered, the name stays visible", () => {
  const d = only("DB_PASSWORD=Tr0ub4dor&3");
  assert.equal(d.category, "credential");
  assert.equal(d.text, "Tr0ub4dor&3");
  assert.equal(only('"client_secret": "' + body(24) + '"').text, body(24));
  assert.equal(only("Parola: hunter2!").text, "hunter2!");
});

test("placeholders, masks and code are not flagged as secrets", () => {
  for (const t of [
    "password: ********",
    "password = ${DB_PASS}",
    "password = getPassword()",
    "api_key: process.env.API_KEY",
    "password: <your password>",
    "password: required",
    "password=pass",
  ]) {
    assert.deepEqual(scan(t), [], t);
  }
});

test("Authorization headers are caught", () => {
  assert.equal(only("Authorization: Bearer " + body(32)).label, "Bearer token");
  assert.equal(only("Authorization: Basic " + "dXNlcjpwYXNzd29yZA==").label, "Basic auth credentials");
});

test("credentials embedded in a URL are caught, plain URLs are not", () => {
  const d = only("postgres://admin:" + "S3cr3tPw@db.internal:5432/app");
  assert.equal(d.label, "Credentials in URL");
  const creds = (t: string) => scan(t).filter((x) => x.category === "credential");
  assert.deepEqual(creds("see https://example.com/docs and git@github.com:org/repo"), []);
  assert.deepEqual(creds("https://user:password@example.com"), [], "placeholder password");
});

test("bech32 checksum follows BIP-173 / BIP-350", () => {
  assert.ok(bech32Valid("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"));
  assert.ok(bech32Valid("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"));
  assert.ok(bech32Valid("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"));
  assert.ok(!bech32Valid("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"), "one char off");
  assert.ok(!bech32Valid("bc1Qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), "mixed case");
});

test("wallet addresses are caught, other hex is not", () => {
  assert.equal(only("send to bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4").label, "Bitcoin address");
  assert.equal(only("0x" + hex(40)).label, "Ethereum address");
  assert.deepEqual(scan("tx 0x" + hex(64)), [], "a 64-char tx hash is not an address");
  assert.deepEqual(scan("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"), [], "bad checksum");
});

test("public IPs are listed but not covered by default; private ones are ignored", () => {
  const d = only("server at 203.0.113.42.");
  assert.equal(d.category, "ip_address");
  assert.equal(d.text, "203.0.113.42");
  assert.equal(d.redactByDefault, false);
  for (const t of ["10.0.0.1", "192.168.1.20", "172.20.4.4", "127.0.0.1", "0.0.0.0", "v1.2.3.4", "1.2.3.4.5", "256.1.1.1"]) {
    assert.deepEqual(scan(t), [], t);
  }
  assert.ok(publicIpv4("8.8.8.8"));
  assert.ok(!publicIpv4("100.64.0.1"), "CGNAT");
  assert.ok(!publicIpv4("01.2.3.4"), "leading zero");
});
