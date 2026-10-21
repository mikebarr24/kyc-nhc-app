import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreFinishers, runSeries, parseDuration, parseClock, elapsedBetween } from "../js/nhc.js";

const approx = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("equal elapsed times: achieved handicap is mean of H1", () => {
  const out = scoreFinishers([
    { boatId: "a", h1: 1.0, elapsed: 3600 },
    { boatId: "b", h1: 0.9, elapsed: 3600 },
  ]);
  approx(out.get("a").achieved, 0.95);
  approx(out.get("b").achieved, 0.95);
});

test("boats given their achieved handicap would all tie", () => {
  const fs = [
    { boatId: "a", h1: 1.0, elapsed: 3600 },
    { boatId: "b", h1: 0.95, elapsed: 3700 },
    { boatId: "c", h1: 0.9, elapsed: 4100 },
  ];
  const out = scoreFinishers(fs);
  const tcs = fs.map((f) => f.elapsed * out.get(f.boatId).achieved);
  tcs.forEach((tc) => approx(tc, tcs[0], 1e-6));
});

test("non-extreme provisional handicap blends H1 and Ha with alpha 0.3", () => {
  const out = scoreFinishers([
    { boatId: "a", h1: 1.0, elapsed: 3600 },
    { boatId: "b", h1: 1.0, elapsed: 3660 },
  ]);
  // Two boats: each is exactly one SD from the mean, so neither is extreme.
  const a = out.get("a");
  assert.equal(a.extreme, null);
  approx(a.provisional, 0.7 * 1.0 + 0.3 * a.achieved);
});

test("places are ordered by corrected time with ties sharing a place", () => {
  const out = scoreFinishers([
    { boatId: "a", h1: 1.0, elapsed: 4000 },
    { boatId: "b", h1: 1.0, elapsed: 3600 },
    { boatId: "c", h1: 1.0, elapsed: 3600 },
  ]);
  assert.equal(out.get("b").place, 1);
  assert.equal(out.get("c").place, 1);
  assert.equal(out.get("a").place, 3);
});

test("extreme performer change is capped at one standard deviation", () => {
  const fs = [
    { boatId: "a", h1: 1, elapsed: 3600 },
    { boatId: "b", h1: 1, elapsed: 3610 },
    { boatId: "c", h1: 1, elapsed: 3620 },
    { boatId: "d", h1: 1, elapsed: 3630 },
    { boatId: "slow", h1: 1, elapsed: 7200 }, // gear failure
  ];
  const out = scoreFinishers(fs);
  const slow = out.get("slow");
  assert.equal(slow.extreme, "slow");

  const tcs = fs.map((f) => f.elapsed);
  const mean = tcs.reduce((a, b) => a + b) / tcs.length;
  const sd = Math.sqrt(tcs.reduce((a, t) => a + (t - mean) ** 2, 0) / tcs.length);
  const tt = mean + sd;
  const sumInv = fs.reduce((a, f) => a + 1 / f.elapsed, 0);
  approx(slow.provisional, 0.7 + 0.3 * (5 / (tt * sumInv)));
  // Capped change is smaller than the uncapped one.
  assert.ok(slow.provisional > 0.7 + 0.3 * slow.achieved);
});

test("realignment keeps sum of handicaps equal to sum of base numbers", () => {
  const boats = [
    { id: "a", h0: 1.0 },
    { id: "b", h0: 0.95 },
    { id: "c", h0: 0.9 },
  ];
  const races = [
    { id: "r1", results: { a: { status: "FIN", elapsed: 3600 }, b: { status: "FIN", elapsed: 3800 }, c: { status: "FIN", elapsed: 3900 } } },
    { id: "r2", results: { a: { status: "FIN", elapsed: 3500 }, b: { status: "DNF" }, c: { status: "FIN", elapsed: 4100 } } },
  ];
  const { races: out, current } = runSeries(boats, races);
  for (const r of out) {
    const total = r.rows.reduce((s, row) => s + row.h2, 0);
    approx(total, 2.85, 0.002); // 3 dp rounding
  }
  // DNF keeps its H1 before realignment.
  const bRow = out[1].rows.find((r) => r.boatId === "b");
  approx(bRow.provisional, bRow.h1);
  assert.equal(current.size, 3);
});

test("boats yet to sail are not realigned and stay on H0", () => {
  const boats = [
    { id: "a", h0: 1.0 },
    { id: "b", h0: 0.9 },
    { id: "new", h0: 1.1 },
  ];
  const races = [
    { id: "r1", results: { a: { status: "FIN", elapsed: 3600 }, b: { status: "FIN", elapsed: 3700 } } },
  ];
  const { races: out, current } = runSeries(boats, races);
  assert.equal(current.get("new"), 1.1);
  const total = out[0].rows.filter((r) => r.boatId !== "new").reduce((s, r) => s + r.h2, 0);
  approx(total, 1.9, 0.002);
});

test("DNC boat that has raced before is still realigned", () => {
  // Without an extreme performer the blend preserves ΣH, so realignment only
  // moves handicaps when someone's change has been capped.
  const ids = ["a", "b", "c", "d", "e", "f"];
  const boats = ids.map((id) => ({ id, h0: 1.0 }));
  const fin = (elapsed) => ({ status: "FIN", elapsed });
  const races = [
    { id: "r1", results: Object.fromEntries(ids.map((id) => [id, fin(3600)])) },
    { id: "r2", results: { a: fin(3600), b: fin(3610), d: fin(3620), e: fin(3630), f: fin(7200) } },
  ];
  const { races: out } = runSeries(boats, races);
  const c = out[1].rows.find((r) => r.boatId === "c");
  assert.equal(c.status, "DNC");
  approx(c.provisional, c.h1);
  assert.notEqual(c.h2, Math.round(c.h1 * 1000) / 1000);
});

test("time parsing", () => {
  assert.equal(parseDuration("1:02:03"), 3723);
  assert.equal(parseDuration("45:10"), 2710);
  assert.equal(parseDuration("abc"), null);
  assert.equal(parseClock("14:05"), 50700);
  assert.equal(parseClock("14:05:30"), 50730);
  assert.equal(elapsedBetween(parseClock("23:30"), parseClock("00:15")), 2700);
});
