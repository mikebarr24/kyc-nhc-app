import {
  STATUSES,
  runSeries,
  parseDuration,
  parseClock,
  elapsedBetween,
  formatDuration,
} from "./nhc.js";

const STORAGE_KEY = "kyc-nhc-data-v1";

// ---- state ----

let data = load();
let view = { tab: "races", raceId: null, draft: null };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalise(JSON.parse(raw));
  } catch {
    // fall through to empty data
  }
  return { boats: [], races: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    alert("Could not save to this browser's storage. Use Data → Export to keep a copy.");
  }
}

function normalise(d) {
  return {
    boats: Array.isArray(d?.boats) ? d.boats : [],
    races: Array.isArray(d?.races) ? d.races : [],
  };
}

const uid = () => Math.random().toString(36).slice(2, 10);

// ---- derived results ----

function raceElapsed(race, entry) {
  if (!entry || entry.status !== "FIN") return null;
  if (race.timeMode === "finish") {
    const start = parseClock(race.start);
    const finish = parseClock(entry.time);
    return start == null || finish == null ? null : elapsedBetween(start, finish);
  }
  return parseDuration(entry.time);
}

function sortedRaces() {
  return data.races
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r.date || "").localeCompare(b.r.date || "") || a.i - b.i)
    .map((x) => x.r);
}

function compute() {
  const races = sortedRaces();
  const input = races.map((race) => ({
    id: race.id,
    results: Object.fromEntries(
      Object.entries(race.entries || {}).map(([boatId, e]) => [
        boatId,
        { status: e.status, elapsed: raceElapsed(race, e) },
      ]),
    ),
  }));
  const out = runSeries(data.boats, input);
  return { races, byRace: new Map(out.races.map((r) => [r.raceId, r.rows])), current: out.current };
}

// ---- helpers ----

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const boatById = (id) => data.boats.find((b) => b.id === id);
const boatLabel = (b) => (b ? `${esc(b.name)}${b.sailNo ? ` <span class="muted">${esc(b.sailNo)}</span>` : ""}` : "?");
const h = (x) => (x == null ? "" : x.toFixed(3));

function change(from, to) {
  const d = Math.round((to - from) * 1000);
  if (d === 0) return `<span class="muted">0</span>`;
  return `<span class="${d > 0 ? "up" : "down"}">${d > 0 ? "+" : ""}${(d / 1000).toFixed(3)}</span>`;
}

function raceTitle(race) {
  return `${esc(race.name || "Race")}${race.date ? ` <span class="muted">${esc(race.date)}</span>` : ""}`;
}

// ---- views ----

function render() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === view.tab));
  const app = document.getElementById("app");
  const results = compute();
  if (view.tab === "fleet") app.innerHTML = fleetView(results);
  else if (view.tab === "handicaps") app.innerHTML = handicapsView(results);
  else if (view.tab === "data") app.innerHTML = dataView();
  else if (view.draft) app.innerHTML = raceEditor();
  else if (view.raceId && data.races.some((r) => r.id === view.raceId)) app.innerHTML = raceResults(results);
  else app.innerHTML = raceList(results);
}

function fleetView({ current }) {
  const rows = data.boats
    .map(
      (b) => `<tr>
        <td><input value="${esc(b.name)}" data-boat-field="name" data-id="${b.id}" /></td>
        <td><input value="${esc(b.sailNo || "")}" data-boat-field="sailNo" data-id="${b.id}" class="num" /></td>
        <td class="n"><input value="${b.h0}" data-boat-field="h0" data-id="${b.id}" class="num" inputmode="decimal" /></td>
        <td class="n">${h(current.get(b.id))}</td>
        <td><button class="danger" data-action="delete-boat" data-id="${b.id}">Remove</button></td>
      </tr>`,
    )
    .join("");
  return `<section class="panel">
    <h2>Fleet</h2>
    <p class="hint">Base handicap (H0) is the boat's NHC base number from the RYA certificate. The current handicap is what it will sail off in the next race.</p>
    ${
      data.boats.length
        ? `<div class="table-wrap"><table>
            <thead><tr><th>Boat</th><th>Sail no.</th><th class="n">Base H0</th><th class="n">Current</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table></div>`
        : `<p class="empty">No boats yet. Add the first one below.</p>`
    }
    <h3>Add a boat</h3>
    <form class="row" data-form="add-boat">
      <label>Boat name<input name="name" required /></label>
      <label>Sail no.<input name="sailNo" class="num" /></label>
      <label>Base handicap<input name="h0" required class="num" inputmode="decimal" placeholder="0.950" /></label>
      <button class="primary" type="submit">Add boat</button>
    </form>
  </section>`;
}

function raceList({ races, byRace }) {
  const rows = [...races]
    .reverse()
    .map((race) => {
      const rows = byRace.get(race.id) || [];
      const finishers = rows.filter((r) => r.place != null).sort((a, b) => a.place - b.place);
      const winner = finishers[0] ? boatById(finishers[0].boatId) : null;
      return `<tr>
        <td><button class="link" data-action="open-race" data-id="${race.id}">${esc(race.name || "Race")}</button></td>
        <td>${esc(race.date || "")}</td>
        <td class="n">${finishers.length}</td>
        <td>${winner ? boatLabel(winner) : '<span class="muted">-</span>'}</td>
      </tr>`;
    })
    .join("");
  return `<section class="panel">
    <h2>Races</h2>
    ${
      data.boats.length === 0
        ? `<p class="empty">Add your boats on the <button class="link" data-action="tab" data-tab="fleet">Fleet</button> tab first.</p>`
        : races.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>Race</th><th>Date</th><th class="n">Finishers</th><th>Winner</th></tr></thead>
              <tbody>${rows}</tbody></table></div>`
          : `<p class="empty">No races yet.</p>`
    }
    ${data.boats.length ? `<div class="actions"><button class="primary" data-action="new-race">New race</button></div>` : ""}
  </section>`;
}

function raceResults({ byRace }) {
  const race = data.races.find((r) => r.id === view.raceId);
  const rows = byRace.get(race.id) || [];
  const finishers = rows.filter((r) => r.place != null).sort((a, b) => a.place - b.place);
  const others = rows.filter((r) => r.place == null && r.status !== "DNC");
  const dnc = rows.filter((r) => r.status === "DNC");

  const finRows = finishers
    .map(
      (r) => `<tr class="${r.extreme ? "extreme" : ""}">
        <td class="n">${r.place}</td>
        <td>${boatLabel(boatById(r.boatId))}</td>
        <td class="n">${formatDuration(r.elapsed)}</td>
        <td class="n">${h(r.h1)}</td>
        <td class="n"><strong>${formatDuration(r.corrected)}</strong></td>
        <td class="n">${h(r.achieved)}</td>
        <td>${r.extreme ? `Extreme ${r.extreme}` : ""}</td>
        <td class="n">${h(r.h2)}</td>
        <td class="n">${change(r.h1, r.h2)}</td>
      </tr>`,
    )
    .join("");
  const otherRows = [...others, ...dnc]
    .map(
      (r) => `<tr>
        <td class="n">${r.status}</td>
        <td>${boatLabel(boatById(r.boatId))}</td>
        <td></td><td class="n">${h(r.h1)}</td><td></td><td></td><td></td>
        <td class="n">${h(r.h2)}</td>
        <td class="n">${change(r.h1, r.h2)}</td>
      </tr>`,
    )
    .join("");

  return `<section class="panel">
    <div class="actions no-print" style="margin:0 0 12px">
      <button data-action="back">← All races</button>
    </div>
    <h2>${raceTitle(race)}</h2>
    <div class="table-wrap"><table>
      <thead><tr>
        <th class="n">Place</th><th>Boat</th><th class="n">Elapsed</th><th class="n">Handicap</th>
        <th class="n">Corrected</th><th class="n">Achieved</th><th></th><th class="n">New handicap</th><th class="n">Change</th>
      </tr></thead>
      <tbody>${finRows}${otherRows}</tbody>
    </table></div>
    <p class="hint">Highlighted boats were extreme performers (corrected time more than one standard deviation from the mean), so their handicap change is capped.
    New handicaps include realignment, so they're the ones to use in the next race.</p>
    <div class="actions">
      <button data-action="edit-race" data-id="${race.id}">Edit</button>
      <button data-action="print">Print</button>
      <button class="danger" data-action="delete-race" data-id="${race.id}">Delete race</button>
    </div>
  </section>`;
}

function raceEditor() {
  const d = view.draft;
  const finishMode = d.timeMode === "finish";
  const rows = data.boats
    .map((b) => {
      const e = d.entries[b.id] || { status: "DNC", time: "" };
      const elapsed = e.status === "FIN" ? raceElapsed(d, e) : null;
      const invalid = e.status === "FIN" && e.time && elapsed == null;
      return `<tr>
        <td>${boatLabel(b)}</td>
        <td><select data-entry="status" data-id="${b.id}">
          ${STATUSES.map((s) => `<option ${s === e.status ? "selected" : ""}>${s}</option>`).join("")}
        </select></td>
        <td><input class="time ${invalid ? "invalid" : ""}" data-entry="time" data-id="${b.id}" value="${esc(e.time)}"
          placeholder="${finishMode ? "hh:mm:ss" : "h:mm:ss"}" ${e.status === "FIN" ? "" : "disabled"} /></td>
        <td class="n muted" data-elapsed="${b.id}">${elapsed != null ? formatDuration(elapsed) : ""}</td>
      </tr>`;
    })
    .join("");
  return `<section class="panel">
    <h2>${d.isNew ? "New race" : "Edit race"}</h2>
    <div class="row">
      <label>Date<input type="date" data-draft="date" value="${esc(d.date)}" /></label>
      <label>Name<input data-draft="name" value="${esc(d.name)}" placeholder="e.g. Wednesday Race 5" /></label>
      <label>Times entered as
        <select data-draft="timeMode">
          <option value="elapsed" ${finishMode ? "" : "selected"}>Elapsed times</option>
          <option value="finish" ${finishMode ? "selected" : ""}>Finish clock times</option>
        </select>
      </label>
      ${finishMode ? `<label>Start time<input class="time" data-draft="start" value="${esc(d.start)}" placeholder="hh:mm:ss" /></label>` : ""}
    </div>
    <p class="hint">Set each boat that raced to FIN and enter its time. Leave boats that didn't come out as DNC. Any other code (DNF, RET…) counts as taking part but keeps the boat's handicap.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Boat</th><th>Result</th><th>${finishMode ? "Finish time" : "Elapsed time"}</th><th class="n">Elapsed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="actions">
      <button class="primary" data-action="save-race">Save &amp; calculate</button>
      <button data-action="cancel-race">Cancel</button>
    </div>
  </section>`;
}

function handicapsView({ races, byRace, current }) {
  if (!data.boats.length) return `<section class="panel"><p class="empty">No boats yet.</p></section>`;
  const head = races.map((r) => `<th class="n" title="${esc(r.name)}">${esc(r.name || "Race")}<br><span class="muted">${esc(r.date || "")}</span></th>`).join("");
  const body = data.boats
    .map((b) => {
      const cells = races
        .map((r) => {
          const row = (byRace.get(r.id) || []).find((x) => x.boatId === b.id);
          return `<td class="n">${row ? h(row.h2) : ""}${row?.place ? ` <span class="muted">(${row.place})</span>` : ""}</td>`;
        })
        .join("");
      return `<tr><td>${boatLabel(b)}</td><td class="n">${h(b.h0)}</td>${cells}<td class="n"><strong>${h(current.get(b.id))}</strong></td></tr>`;
    })
    .join("");
  return `<section class="panel">
    <h2>Handicap progression</h2>
    <p class="hint">Handicap after each race (place in brackets). The last column is the handicap for the next race.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Boat</th><th class="n">Base</th>${head}<th class="n">Next race</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

function dataView() {
  return `<section class="panel">
    <h2>Data</h2>
    <p class="hint">Everything is saved in this browser only. To share results or move to another device, export a file and import it there.
    Whoever keeps the results should export after each race and share the file with the group.</p>
    <div class="actions">
      <button class="primary" data-action="export">Export data file</button>
      <label class="button">Import data file<input type="file" accept="application/json,.json" data-action="import" hidden /></label>
      <button class="danger" data-action="clear">Clear everything</button>
    </div>
  </section>`;
}

// ---- events ----

function startDraft(race) {
  const entries = {};
  for (const b of data.boats) entries[b.id] = { status: "DNC", time: "", ...(race?.entries?.[b.id] || {}) };
  view.draft = race
    ? { ...structuredClone(race), entries, isNew: false }
    : { id: uid(), date: new Date().toISOString().slice(0, 10), name: `Race ${data.races.length + 1}`, timeMode: "elapsed", start: "", entries, isNew: true };
}

function saveDraft() {
  const d = view.draft;
  if (d.timeMode === "finish" && parseClock(d.start) == null) return alert("Enter a valid start time (hh:mm or hh:mm:ss).");
  const bad = data.boats.filter((b) => d.entries[b.id]?.status === "FIN" && raceElapsed(d, d.entries[b.id]) == null);
  if (bad.length) return alert(`Check the time for: ${bad.map((b) => b.name).join(", ")}`);

  const { isNew, ...race } = d;
  race.entries = Object.fromEntries(Object.entries(race.entries).filter(([, e]) => e.status !== "DNC"));
  const i = data.races.findIndex((r) => r.id === race.id);
  if (i >= 0) data.races[i] = race;
  else data.races.push(race);
  save();
  view = { tab: "races", raceId: race.id, draft: null };
  render();
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-tab], [data-action]");
  if (!el || el.tagName === "INPUT") return;
  if (el.dataset.tab) {
    view = { tab: el.dataset.tab, raceId: null, draft: null };
    return render();
  }
  const id = el.dataset.id;
  switch (el.dataset.action) {
    case "new-race":
      startDraft(null);
      break;
    case "edit-race":
      startDraft(data.races.find((r) => r.id === id));
      break;
    case "open-race":
      view.raceId = id;
      break;
    case "back":
      view.raceId = null;
      break;
    case "cancel-race":
      view.draft = null;
      break;
    case "save-race":
      return saveDraft();
    case "delete-race":
      if (!confirm("Delete this race? Handicaps for later races will be recalculated.")) return;
      data.races = data.races.filter((r) => r.id !== id);
      view.raceId = null;
      save();
      break;
    case "delete-boat": {
      const raced = data.races.some((r) => r.entries?.[id]);
      if (!confirm(raced ? "This boat has race results. Removing it deletes them and recalculates everyone's handicaps. Continue?" : "Remove this boat?")) return;
      data.boats = data.boats.filter((b) => b.id !== id);
      data.races.forEach((r) => delete r.entries?.[id]);
      save();
      break;
    }
    case "print":
      return window.print();
    case "export":
      return exportData();
    case "clear":
      if (!confirm("Delete all boats and races from this browser? Export first if you want a copy.")) return;
      data = { boats: [], races: [] };
      save();
      break;
    default:
      return;
  }
  render();
});

document.addEventListener("submit", (ev) => {
  if (ev.target.dataset.form !== "add-boat") return;
  ev.preventDefault();
  const f = new FormData(ev.target);
  const h0 = Number(String(f.get("h0")).trim());
  if (!(h0 > 0)) return alert("Base handicap must be a positive number, e.g. 0.950");
  data.boats.push({ id: uid(), name: String(f.get("name")).trim(), sailNo: String(f.get("sailNo")).trim(), h0 });
  save();
  render();
  document.querySelector('[data-form="add-boat"] input[name="name"]')?.focus();
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.boatField) {
    const b = boatById(el.dataset.id);
    if (el.dataset.boatField === "h0") {
      const v = Number(el.value.trim());
      if (!(v > 0)) return alert("Base handicap must be a positive number.");
      b.h0 = v;
    } else {
      b[el.dataset.boatField] = el.value.trim();
    }
    save();
    render();
  } else if (el.dataset.draft) {
    view.draft[el.dataset.draft] = el.value;
    render();
  } else if (el.dataset.entry === "status") {
    view.draft.entries[el.dataset.id].status = el.value;
    render();
  } else if (el.dataset.action === "import") {
    importData(el.files[0]);
  }
});

// Update elapsed preview while typing without re-rendering (keeps focus).
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.entry !== "time" && el.dataset.draft !== "start") return;
  if (el.dataset.entry) view.draft.entries[el.dataset.id].time = el.value;
  else view.draft.start = el.value;
  for (const b of data.boats) {
    const e = view.draft.entries[b.id];
    const cell = document.querySelector(`[data-elapsed="${b.id}"]`);
    const elapsed = raceElapsed(view.draft, e);
    if (cell) cell.textContent = elapsed != null ? formatDuration(elapsed) : "";
  }
  if (el.dataset.entry) el.classList.toggle("invalid", !!el.value && raceElapsed(view.draft, view.draft.entries[el.dataset.id]) == null);
});

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "kyc-nhc", version: 1, ...data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nhc-results-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.boats) || !Array.isArray(parsed.races)) throw new Error("not an NHC data file");
    if ((data.boats.length || data.races.length) && !confirm("Replace the data in this browser with the imported file?")) return;
    data = normalise(parsed);
    save();
    view = { tab: "races", raceId: null, draft: null };
    render();
  } catch (e) {
    alert(`Couldn't import that file: ${e.message}`);
  }
}

render();
