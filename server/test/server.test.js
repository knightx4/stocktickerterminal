import { test } from "node:test";
import assert from "node:assert/strict";
import { marketStatus, utcOffsetMinutes, pollSeconds } from "../lib/hours.js";
import { sanitizeConfig, DEFAULT_CONFIG } from "../lib/config.js";
import { buildScreens, encodeBundle, brightnessFor } from "../lib/bundle.js";
import { decodeBundle, composite, clockText } from "../public/decode.js";
import { fmtPct, fmtPrice, fmtGainPct } from "../lib/screens.js";

const at = (iso) => new Date(iso);

test("market status in Eastern time", () => {
  assert.equal(marketStatus(at("2026-11-23T15:00:00Z")).status, "open"); // Mon 10:00 ET
  assert.equal(marketStatus(at("2026-11-23T14:00:00Z")).status, "pre"); // 9:00 ET
  assert.equal(marketStatus(at("2026-11-23T21:30:00Z")).status, "after"); // 16:30 ET
  assert.equal(marketStatus(at("2026-11-24T03:00:00Z")).status, "closed"); // 22:00 ET
  assert.equal(marketStatus(at("2026-11-22T16:00:00Z")).status, "weekend"); // Sunday
  assert.equal(marketStatus(at("2026-11-26T16:00:00Z")).status, "holiday"); // Thanksgiving
  // Day after Thanksgiving (Dad's birthday) closes at 1 pm ET
  assert.equal(marketStatus(at("2026-11-27T17:30:00Z")).status, "open"); // 12:30 ET
  assert.equal(marketStatus(at("2026-11-27T18:30:00Z")).status, "after"); // 13:30 ET
  // Summer (EDT): 13:35 UTC = 9:35 ET
  assert.equal(marketStatus(at("2026-07-06T13:35:00Z")).status, "open");
  assert.equal(pollSeconds("open"), 60);
});

test("Central time offset follows DST", () => {
  assert.equal(utcOffsetMinutes(at("2026-11-23T12:00:00Z"), "America/Chicago"), -360);
  assert.equal(utcOffsetMinutes(at("2026-07-01T12:00:00Z"), "America/Chicago"), -300);
});

test("config sanitizing rejects junk and fills defaults", () => {
  const c = sanitizeConfig({
    symbols: [{ symbol: "aapl<script>" }, { symbol: "" }, ...Array(40).fill({ symbol: "X" })],
    screens: [{ id: "bogus" }, { id: "firm", enabled: true }],
    display: { dayBrightness: 999, timezone: "Not/AZone", nightStart: "nope" },
    firmware: { url: "http://insecure", md5: "zz" },
  });
  assert.equal(c.symbols[0].symbol, "AAPLSCRIPT");
  assert.ok(c.symbols.length <= 25);
  assert.equal(c.screens[0].id, "firm");
  assert.equal(c.screens.length, 5);
  assert.equal(c.display.dayBrightness, 100);
  assert.equal(c.display.timezone, "America/Chicago");
  assert.equal(c.display.nightStart, "22:00");
  assert.equal(c.firmware.url, "");
  assert.equal(sanitizeConfig(null).symbols.length, DEFAULT_CONFIG.symbols.length);
});

test("brightness follows the night window in local time", () => {
  const c = sanitizeConfig(DEFAULT_CONFIG);
  assert.equal(brightnessFor(c, at("2026-11-23T18:00:00Z")), Math.round(0.7 * 255)); // noon CT
  assert.equal(brightnessFor(c, at("2026-11-24T05:00:00Z")), Math.round(0.12 * 255)); // 11 pm CT
});

test("bundle encodes, decodes and obeys device limits", async () => {
  const config = sanitizeConfig({
    ...DEFAULT_CONFIG,
    screens: DEFAULT_CONFIG.screens.map((s) => ({ ...s, enabled: true })),
    messages: [{ text: "HI DAD", color: "#ffffff" }, { text: "A VERY LONG MESSAGE THAT MUST SCROLL ACROSS", color: "#ff0000" }],
  });
  const now = at("2026-11-23T16:42:00Z");
  const buf = encodeBundle(await buildScreens({ now, config }), now);
  const { header, screens } = decodeBundle(new Uint8Array(buf));
  assert.equal(header.count, screens.length);
  assert.ok(screens.length <= 16);
  assert.ok(buf.length < 512 * 1024);
  assert.equal(header.utcOffset, -360);
  assert.equal(clockText(header.time, header.utcOffset, false), "10:42");
  assert.deepEqual(screens.map((s) => s.id), ["ticker", "since1968", "indices", "message", "message2", "firm"]);
  for (const s of screens) {
    if (s.clockX !== 255) assert.ok(s.clockX <= 63 && s.clockY <= 27, s.id);
    assert.ok(s.stripY + s.stripH <= 32, s.id);
    if (s.speed) assert.ok(s.stripW > 64);
    composite(s, header, 1000); // must not throw
  }
  assert.ok(screens[0].stripW > 64 && screens[0].speed > 0, "ticker scrolls");
  assert.ok(screens[4].stripW > 64, "long message scrolls");
});

test("number formatting", () => {
  assert.equal(fmtPct(1.234), "+1.23%");
  assert.equal(fmtPct(-12.34), "-12.3%");
  assert.equal(fmtPct(0), "+0.00%");
  assert.equal(fmtPrice(1234.5), "1,234.50");
  assert.equal(fmtPrice(43210.9), "43,211");
  assert.equal(fmtGainPct(7177 / 107.76), "+6,560%");
});
