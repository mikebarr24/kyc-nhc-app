// NHC (RYA National Handicap for Cruisers) calculations, May 2015 version.
// Source: https://halsail.com/Help/pdfFaq?Faqitem=NhcMaths
//
//   H0  base handicap            H1  handicap used in this race
//   Te  elapsed time (s)         Tc  corrected time = Te * H1 (rounded to 1 s)
//   Ha  achieved handicap        Hp  provisional handicap for next race
//   H2  realigned handicap for next race = Hp * (ΣH0 / ΣHp), rounded to 3 dp

export const ALPHA = 0.3;

export const STATUSES = ["FIN", "DNF", "RET", "DNS", "OCS", "DSQ", "DNC"];

const round3 = (x) => Math.round(x * 1000) / 1000;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * Score one race's finishers.
 * @param {{boatId: string, h1: number, elapsed: number}[]} finishers
 * @returns {Map<string, {corrected, place, achieved, extreme, provisional}>}
 */
export function scoreFinishers(finishers, alpha = ALPHA) {
  const out = new Map();
  if (finishers.length === 0) return out;

  const rows = finishers.map((f) => ({ ...f, corrected: Math.round(f.elapsed * f.h1) }));

  const sumH1 = sum(rows.map((r) => r.h1));
  const sumInvTe = sum(rows.map((r) => 1 / r.elapsed));
  const achievedFor = (te) => sumH1 / (te * sumInvTe);

  // Population standard deviation of corrected times.
  const mean = sum(rows.map((r) => r.corrected)) / rows.length;
  const sd = Math.sqrt(sum(rows.map((r) => (r.corrected - mean) ** 2)) / rows.length);

  const sorted = [...rows].sort((a, b) => a.corrected - b.corrected);
  sorted.forEach((r, i) => {
    // Equal corrected times share the higher place.
    r.place = i > 0 && r.corrected === sorted[i - 1].corrected ? sorted[i - 1].place : i + 1;
  });

  for (const r of rows) {
    let extreme = null;
    let te = r.elapsed;
    if (r.corrected < mean - sd) {
      extreme = "fast";
      te = (mean - sd) / r.h1;
    } else if (r.corrected > mean + sd) {
      extreme = "slow";
      te = (mean + sd) / r.h1;
    }
    const achieved = achievedFor(r.elapsed);
    const provisional = (1 - alpha) * r.h1 + alpha * achievedFor(te);
    out.set(r.boatId, { corrected: r.corrected, place: r.place, achieved, extreme, provisional });
  }
  return out;
}

/**
 * Replay every race in order and work out results and handicaps.
 * @param {{id: string, h0: number}[]} boats
 * @param {{id: string, results: Record<string, {status: string, elapsed?: number}>}[]} races  in sailing order
 * @returns {{races: {raceId, rows}[], current: Map<string, number>}}
 */
export function runSeries(boats, races, alpha = ALPHA) {
  const handicap = new Map(boats.map((b) => [b.id, b.h0]));
  const active = new Set(); // boats with at least one non-DNC result so far
  const raceOutputs = [];

  for (const race of races) {
    const results = race.results || {};
    const entered = boats.filter((b) => results[b.id] && results[b.id].status !== "DNC");
    entered.forEach((b) => active.add(b.id));

    const finishers = entered
      .filter((b) => results[b.id].status === "FIN" && results[b.id].elapsed > 0)
      .map((b) => ({ boatId: b.id, h1: handicap.get(b.id), elapsed: results[b.id].elapsed }));
    const scored = scoreFinishers(finishers, alpha);

    const provisional = new Map();
    for (const b of boats) {
      provisional.set(b.id, scored.get(b.id)?.provisional ?? handicap.get(b.id));
    }

    const activeBoats = boats.filter((b) => active.has(b.id));
    const factor = activeBoats.length
      ? sum(activeBoats.map((b) => b.h0)) / sum(activeBoats.map((b) => provisional.get(b.id)))
      : 1;

    const rows = boats.map((b) => {
      const r = results[b.id];
      const h1 = handicap.get(b.id);
      const h2 = active.has(b.id) ? round3(provisional.get(b.id) * factor) : h1;
      const s = scored.get(b.id);
      return {
        boatId: b.id,
        status: s ? "FIN" : r?.status === "FIN" ? "DNF" : r?.status ?? "DNC",
        elapsed: s ? r.elapsed : null,
        h1,
        corrected: s?.corrected ?? null,
        place: s?.place ?? null,
        achieved: s?.achieved ?? null,
        extreme: s?.extreme ?? null,
        provisional: provisional.get(b.id),
        h2,
      };
    });

    for (const row of rows) handicap.set(row.boatId, row.h2);
    raceOutputs.push({ raceId: race.id, rows });
  }

  return { races: raceOutputs, current: handicap };
}

// ---- time helpers ----

/** Parse "H:MM:SS", "MM:SS" or "HH:MM" style strings into seconds. Returns null if invalid. */
export function parseDuration(text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const parts = t.split(/[:.]/).map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  if (m >= 60 && nums.length === 3) return null;
  if (s >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/** Parse a clock time "HH:MM" or "HH:MM:SS" into seconds after midnight. */
export function parseClock(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

/** Elapsed seconds between two clock times, assuming finish is within 24h after start. */
export function elapsedBetween(startSecs, finishSecs) {
  let d = finishSecs - startSecs;
  if (d <= 0) d += 24 * 3600;
  return d;
}

export function formatDuration(secs) {
  if (secs == null) return "";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
