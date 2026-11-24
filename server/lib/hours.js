// Market hours (US Eastern), NYSE holidays, and local-time helpers.
// Holiday list: check https://www.nyse.com/markets/hours-calendars each year
// and extend it for 2029 and later.

export const NYSE_HOLIDAYS = new Set([
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  // 2028
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19",
  "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25",
]);

// Days the market closes at 1:00 pm Eastern.
export const NYSE_EARLY_CLOSE = new Set([
  "2026-11-27", "2026-12-24",
  "2027-11-26",
  "2028-07-03", "2028-11-24",
]);

// Wall-clock parts of `date` in an IANA time zone.
export function zonedParts(date, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    weekday: p.weekday, // "Mon".."Sun"
    minutes: Number(p.hour) * 60 + Number(p.minute),
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

// Minutes to add to UTC to get local time in `timeZone` (e.g. -360 for CST).
export function utcOffsetMinutes(date, timeZone) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(date);
  const v = Object.fromEntries(p.map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// status: "open" | "pre" | "after" | "closed" | "weekend" | "holiday"
export function marketStatus(date = new Date()) {
  const et = zonedParts(date, "America/New_York");
  if (et.weekday === "Sat" || et.weekday === "Sun") return { status: "weekend", et };
  if (NYSE_HOLIDAYS.has(et.ymd)) return { status: "holiday", et };
  const close = NYSE_EARLY_CLOSE.has(et.ymd) ? 13 * 60 : 16 * 60;
  const m = et.minutes;
  if (m >= 9 * 60 + 30 && m < close) return { status: "open", et, close };
  if (m >= 4 * 60 && m < 9 * 60 + 30) return { status: "pre", et, close };
  if (m >= close && m < 20 * 60) return { status: "after", et, close };
  return { status: "closed", et, close };
}

// How often the device should fetch, and how long quotes stay fresh.
// Outside market hours prices barely move, but a short interval means edits
// on the settings page show up within ~2 minutes. Quotes stay cached longer
// (see bundle.js), so this costs almost nothing.
export function pollSeconds(status) {
  return status === "open" ? 60 : 120;
}

// Unix seconds of today's opening and closing bell (ET), or [] when the
// market doesn't open today. Early-close days ring at 1:00 pm.
export function bellTimes(now = new Date()) {
  const et = zonedParts(now, "America/New_York");
  if (et.weekday === "Sat" || et.weekday === "Sun" || NYSE_HOLIDAYS.has(et.ymd)) return [];
  const [y, m, d] = et.ymd.split("-").map(Number);
  const offset = utcOffsetMinutes(now, "America/New_York");
  const at = (h, min) => (Date.UTC(y, m - 1, d, h, min) - offset * 60000) / 1000;
  const early = NYSE_EARLY_CLOSE.has(et.ymd);
  return [
    { kind: "open", playAt: at(9, 30) },
    { kind: "close", playAt: early ? at(13, 0) : at(16, 0), label: early ? "1:00 ET" : "4:00 ET" },
  ];
}

// "22:00" -> 1320
export function hhmmToMinutes(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
  if (!m) return fallback;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

// True when local minutes-of-day falls in [start, end), wrapping midnight.
export function inWindow(minutes, start, end) {
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
