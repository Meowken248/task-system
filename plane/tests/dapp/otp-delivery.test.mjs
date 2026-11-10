// oxlint-disable-next-line import/no-unassigned-import -- Isolated browser storage before auth modules.
import "./browser.mjs";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { handleRoute } from "../../packages/services/src/dapp/routes.ts";
import { getStoredOtpMap, generateAndStoreOtp, verifyOtpCode } from "../../packages/services/src/dapp/auth.ts";

let sends, accept;
const email = "otp@example.invalid";
const request = (target = email) => handleRoute("post", "/auth/magic-generate/", { email: target });
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.cookie = "";
  Object.assign(process.env, {
    VITE_MAIL_PROXY_URL: "https://mail.fixture", VITE_BREVO_API_KEY: "",
    VITE_EMAIL_SENDER_ADDRESS: "sender@example.invalid", VITE_AUTO_COMMIT_ONCHAIN: "false",
  });
  sends = [];
  accept = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://mail.fixture");
    assert(options.signal instanceof AbortSignal);
    sends.push(JSON.parse(options.body));
    return new Response("{}", { status: accept ? 201 : 503 });
  };
});

test("unconfigured email returns a delivery failure and stores no new OTP", async () => {
  process.env.VITE_MAIL_PROXY_URL = "";
  assert.equal((await request()).status, 503);
  assert.equal(sends.length, 0);
  assert.equal(getStoredOtpMap()[email], undefined);
});

test("HTTP rejection is surfaced and does not invalidate an earlier delivered code", async () => {
  const old = await generateAndStoreOtp(email);
  accept = false;
  assert.equal((await request()).status, 503);
  assert.equal((await verifyOtpCode(email, old)).valid, true);
});

test("network or abort failures never claim successful delivery", async () => {
  globalThis.fetch = async () => { throw new DOMException("fixture timeout", "AbortError"); };
  const result = await request();
  assert.equal(result.status, 503);
  assert.equal(result.data.code, "OTP_DELIVERY_FAILED");
  assert.equal(getStoredOtpMap()[email], undefined);
});

test("successful provider acceptance stores only the hash of the emailed code", async () => {
  assert.equal((await request()).status, 200);
  const match = sends[0].htmlContent.match(/>\s*(\d{6})\s*</);
  assert(match, "fixture email contains a six-digit code");
  assert.equal((await verifyOtpCode(email, match[1])).valid, true);
  const record = getStoredOtpMap()[email];
  assert.equal(record.code, undefined);
  assert(record.codeHash.startsWith("sha256:"));
});

test("double submissions share a single email and wait for provider acceptance", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (_url, options) => {
    sends.push(JSON.parse(options.body));
    await waiting;
    return new Response("{}", { status: 201 });
  };
  const first = request();
  const second = request(" OTP@example.invalid ");
  assert.equal(sends.length, 1);
  assert.equal(getStoredOtpMap()[email], undefined, "pending sends cannot replace the active code");
  release();
  assert.deepEqual((await Promise.all([first, second])).map((result) => result.status), [200, 200]);
  assert.equal(sends.length, 1);
});

test("different emails generated concurrently retain both stored codes", async () => {
  const other = "other@example.invalid";
  const results = await Promise.all([request(email), request(other)]);
  assert(results.every((result) => result.status === 200));
  assert(getStoredOtpMap()[email]);
  assert(getStoredOtpMap()[other]);
});

test("failed requests can be retried after mail recovers", async () => {
  accept = false;
  assert.equal((await request()).status, 503);
  accept = true;
  assert.equal((await request()).status, 200);
  assert.equal(sends.length, 2);
});

test("invalid emails and GET requests cannot send email", async () => {
  assert.equal((await request("not-an-email")).status, 400);
  assert.equal((await handleRoute("get", "/auth/magic-generate/", { email })).status, 405);
  assert.equal(sends.length, 0);
});

test("blocked browser storage surfaces a storage failure after provider acceptance", async () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("fixture storage blocked"); };
  try {
    const result = await request();
    assert.equal(result.status, 503);
    assert.equal(result.data.code, "OTP_STORAGE_FAILED");
  } finally {
    localStorage.setItem = original;
  }
});
