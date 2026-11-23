import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAnimation, decodeFrame } from "../lib/animation.js";
import { sanitizeConfig, DEFAULT_CONFIG } from "../lib/config.js";
import { buildScreens, encodeBundle, isBirthday } from "../lib/bundle.js";
import { decodeBundle, parseAnimation as parseInBrowser, animationFrameAt } from "../public/decode.js";

// A tiny 3-frame TKA1: solid red (RLE), raw gradient, solid blue (RLE).
function sampleAnimation() {
  const frames = [];
  const rle = (color) => {
    const b = Buffer.alloc(3 * 9);
    let n = 2048, o = 0;
    while (n > 0) { const run = Math.min(255, n); b.writeUInt8(run, o); b.writeUInt16LE(color, o + 1); o += 3; n -= run; }
    return b.subarray(0, o);
  };
  const raw = Buffer.alloc(4096);
  for (let i = 0; i < 2048; i++) raw.writeUInt16LE(i, i * 2);
  for (const [ms, enc, data] of [[100, 1, rle(0xf800)], [200, 0, raw], [300, 1, rle(0x001f)]]) {
    const h = Buffer.alloc(5);
    h.writeUInt16LE(ms, 0); h.writeUInt8(enc, 2); h.writeUInt16LE(data.length, 3);
    frames.push(h, data);
  }
  const head = Buffer.alloc(14);
  head.write("TKA1", 0, "ascii");
  head.writeUInt16LE(64, 4); head.writeUInt16LE(32, 6); head.writeUInt16LE(3, 8); head.writeUInt32LE(600, 10);
  return Buffer.concat([head, ...frames]);
}

test("TKA1 parse and decode", () => {
  const buf = sampleAnimation();
  const a = parseAnimation(buf);
  assert.equal(a.frames.length, 3);
  assert.equal(a.totalMs, 600);
  assert.ok(decodeFrame(buf, a.frames[0]).every((v) => v === 0xf800));
  assert.equal(decodeFrame(buf, a.frames[1])[2047], 2047);
  assert.throws(() => parseAnimation(buf.subarray(0, buf.length - 1)));
  // browser decoder agrees, and picks frames by time (looping)
  const b = parseInBrowser(new Uint8Array(buf));
  assert.equal(animationFrameAt(b, 50)[0], 0xf800);
  assert.equal(animationFrameAt(b, 150)[5], 5);
  assert.equal(animationFrameAt(b, 599)[0], 0x001f);
  assert.equal(animationFrameAt(b, 650)[0], 0xf800);
});

test("birthday screen: animation for fw 3+, still poster for older firmware", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tka-"));
  writeFileSync(join(dir, "birthday.tka"), sampleAnimation());
  process.env.LOCAL_ASSETS = dir;
  const config = sanitizeConfig({ ...DEFAULT_CONFIG, screens: [{ id: "birthday", enabled: true }] });
  const now = new Date("2026-11-27T18:00:00Z"); // noon Central on his birthday

  const v3 = decodeBundle(new Uint8Array(encodeBundle(await buildScreens({ now, config, fw: 3 }), now)));
  const s3 = v3.screens.find((s) => s.id === "birthday");
  assert.equal(s3.kind, 1);
  assert.equal(s3.assetId, "birthday");
  assert.equal(s3.assetSize, sampleAnimation().length);
  assert.equal(v3.header.autoplayMinutes, 5);
  const night = new Date("2026-11-28T05:00:00Z"); // 11 pm Central on Nov 27
  const atNight = decodeBundle(new Uint8Array(encodeBundle(await buildScreens({ now: night, config, fw: 3 }), night)));
  assert.equal(atNight.header.autoplayMinutes, 0, "no autoplay overnight");

  const v2 = decodeBundle(new Uint8Array(encodeBundle(await buildScreens({ now, config, fw: 0 }), now)));
  const s2 = v2.screens.find((s) => s.id === "birthday");
  assert.equal(s2.kind, 0);
  assert.equal(s2.bg[0], 0x001f, "poster is the last frame when the animation is shorter than 130 frames");
  delete process.env.LOCAL_ASSETS;
});

test("birthday autoplay only on Nov 27 in his time zone", () => {
  const c = sanitizeConfig(DEFAULT_CONFIG);
  assert.equal(isBirthday(c, new Date("2026-11-27T12:00:00Z")), true); // 6 am CT Nov 27
  assert.equal(isBirthday(c, new Date("2026-11-28T03:00:00Z")), true); // 9 pm CT Nov 27
  assert.equal(isBirthday(c, new Date("2026-11-28T07:00:00Z")), false); // 1 am CT Nov 28
});
