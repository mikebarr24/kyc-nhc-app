import {
  STATUSES,
  runSeries,
  parseDuration,
  parseClock,
  elapsedBetween,
  formatDuration,
} from "./nhc.js";
import { isShared, openLocal, openClub } from "./store.js";

// ---- state ----

let store;
let data = { boats: [], races: [] };
let view = { tab: "races", raceId: null, draft: null };
let status = { loading: true, error: null, busy: false, clubError: null };

const CLUB_KEY = "nhc-club-code";
const canEdit = () => !!store;

async function reload() {
  try {
    data = await store.load();
    status.error = null;
  } catch (e) {
    status.error = `Couldn't load results: ${e.message}`;
  }
  status.loading = false;
  render();
}

// Run a store write, then reload so every view reflects what was saved.
async function persist(fn) {
  status.busy = true;
  render();
  try {
    await fn();
  } catch (e) {
    alert(`Couldn't save: ${e.message}`);
  }
  status.busy = false;
  await reload();
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
  document.querySelector("nav").hidden = !store;
  document.getElementById("account").innerHTML = accountView();
  document.body.classList.toggle("busy", status.busy);
  const app = document.getElementById("app");
  if (status.loading) return (app.innerHTML = `<p class="empty">Loading…</p>`);
  if (!store) return (app.innerHTML = landingView());
  const banner = status.error ? `<p class="panel error">${esc(status.error)}</p>` : "";
  const results = compute();
  let body;
  if (view.tab === "fleet") body = fleetView(results);
  else if (view.tab === "handicaps") body = handicapsView(results);
  else if (view.tab === "data") body = dataView();
  else if (view.draft && canEdit()) body = raceEditor();
  else if (view.raceId && data.races.some((r) => r.id === view.raceId)) body = raceResults(results);
  else body = raceList(results);
  app.innerHTML = banner + body;
}

function accountView() {
  if (!store?.club) return "";
  return `<strong>${esc(store.club.name)}</strong> <button data-action="change-club">Change club</button>`;
}

function landingView() {
  return `<section class="panel landing">
    <h2>Open your club</h2>
    <p class="hint">Enter the code your club gave you to see and enter its results.</p>
    <form data-form="club" class="row">
      <input name="code" required autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Club code" aria-label="Club code" />
      <button class="primary" type="submit">Open</button>
    </form>
    ${status.clubError ? `<p class="error">${esc(status.clubError)}</p>` : ""}
  </section>`;
}

function fleetView({ current }) {
  const edit = canEdit();
  const rows = data.boats
    .map((b) =>
      edit
        ? `<tr>
            <td><input value="${esc(b.name)}" data-boat-field="name" data-id="${b.id}" /></td>
            <td><input value="${esc(b.sailNo || "")}" data-boat-field="sailNo" data-id="${b.id}" class="num" /></td>
            <td class="n"><input value="${b.h0}" data-boat-field="h0" data-id="${b.id}" class="num" inputmode="decimal" /></td>
            <td class="n">${h(current.get(b.id))}</td>
            <td><button class="danger" data-action="delete-boat" data-id="${b.id}">Remove</button></td>
          </tr>`
        : `<tr>
            <td>${esc(b.name)}</td><td>${esc(b.sailNo || "")}</td>
            <td class="n">${h(b.h0)}</td><td class="n">${h(current.get(b.id))}</td><td></td>
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
        : `<p class="empty">No boats yet.${edit ? " Add the first one below." : ""}</p>`
    }
    ${
      edit
        ? `<h3>Add a boat</h3>
          <form class="row" data-form="add-boat">
            <label>Boat name<input name="name" required /></label>
            <label>Sail no.<input name="sailNo" class="num" /></label>
            <label>Base handicap<input name="h0" required class="num" inputmode="decimal" placeholder="0.950" /></label>
            <button class="primary" type="submit">Add boat</button>
          </form>`
        : ""
    }
  </section>`;
}

function raceList({ races, byRace }) {
  const edit = canEdit();
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
  let empty = "";
  if (data.boats.length === 0) {
    empty = edit
      ? `<p class="empty">Add your boats on the <button class="link" data-tab="fleet">Fleet</button> tab first.</p>`
      : `<p class="empty">No results yet.</p>`;
  } else if (!races.length) {
    empty = `<p class="empty">No races yet.</p>`;
  }
  return `<section class="panel">
    <h2>Races</h2>
    ${
      empty ||
      `<div class="table-wrap"><table>
        <thead><tr><th>Race</th><th>Date</th><th class="n">Finishers</th><th>Winner</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    }
    ${edit && data.boats.length ? `<div class="actions"><button class="primary" data-action="new-race">New race</button></div>` : ""}
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
      ${canEdit() ? `<button data-action="edit-race" data-id="${race.id}">Edit</button>` : ""}
      <button data-action="print">Print</button>
      ${canEdit() ? `<button class="danger" data-action="delete-race" data-id="${race.id}">Delete race</button>` : ""}
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
  const edit = canEdit();
  const hint = store.shared
    ? "Results are shared with everyone who has your club's code. Export a file now and then as a backup."
    : "Everything is saved in this browser only. To move to another device, export a file and import it there.";
  return `<section class="panel">
    <h2>Data</h2>
    <p class="hint">${hint}</p>
    <div class="actions">
      <button class="primary" data-action="export">Export data file</button>
      ${
        edit
          ? `<label class="button">Import data file<input type="file" accept="application/json,.json" data-action="import" hidden /></label>
             <button class="danger" data-action="clear">Clear everything</button>`
          : ""
      }
    </div>
    ${edit && store.shared ? `<p class="hint">Importing replaces all shared boats and races with the contents of the file.</p>` : ""}
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

async function saveDraft() {
  const d = view.draft;
  if (d.timeMode === "finish" && parseClock(d.start) == null) return alert("Enter a valid start time (hh:mm or hh:mm:ss).");
  const bad = data.boats.filter((b) => d.entries[b.id]?.status === "FIN" && raceElapsed(d, d.entries[b.id]) == null);
  if (bad.length) return alert(`Check the time for: ${bad.map((b) => b.name).join(", ")}`);

  const { isNew, ...race } = d;
  race.entries = Object.fromEntries(Object.entries(race.entries).filter(([, e]) => e.status !== "DNC"));
  view = { tab: "races", raceId: race.id, draft: null };
  await persist(() => store.saveRace(race));
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-tab], [data-action]");
  if (!el || el.tagName === "INPUT" || status.busy) return;
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
      view.raceId = null;
      return persist(() => store.deleteRace(id));
    case "delete-boat": {
      const raced = data.races.some((r) => r.entries?.[id]);
      if (!confirm(raced ? "This boat has race results. Removing it deletes them and recalculates everyone's handicaps. Continue?" : "Remove this boat?")) return;
      return persist(() => store.deleteBoat(id));
    }
    case "print":
      return window.print();
    case "export":
      return exportData();
    case "clear":
      if (!confirm(store.shared ? "Delete ALL of the club's boats and races, for everyone? Export first if you want a copy." : "Delete all boats and races from this browser? Export first if you want a copy.")) return;
      return persist(() => store.replaceAll({ boats: [], races: [] }));
    case "change-club":
      try {
        localStorage.removeItem(CLUB_KEY);
      } catch {
        // nothing saved
      }
      store.close();
      store = null;
      data = { boats: [], races: [] };
      view = { tab: "races", raceId: null, draft: null };
      break;
    default:
      return;
  }
  render();
});

document.addEventListener("submit", async (ev) => {
  const form = ev.target.dataset.form;
  if (!form) return;
  ev.preventDefault();
  const f = new FormData(ev.target);
  if (form === "club") {
    const code = String(f.get("code")).trim();
    status.busy = true;
    render();
    const opened = await connect(code);
    status.busy = false;
    if (!opened) return render();
    try {
      localStorage.setItem(CLUB_KEY, code);
    } catch {
      // they'll just have to enter it again next time
    }
    await reload();
  } else if (form === "add-boat") {
    const h0 = Number(String(f.get("h0")).trim());
    if (!(h0 > 0)) return alert("Base handicap must be a positive number, e.g. 0.950");
    const boat = { id: uid(), name: String(f.get("name")).trim(), sailNo: String(f.get("sailNo")).trim(), h0 };
    await persist(() => store.saveBoat(boat));
    document.querySelector('[data-form="add-boat"] input[name="name"]')?.focus();
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.boatField) {
    const boat = { ...boatById(el.dataset.id) };
    if (el.dataset.boatField === "h0") {
      const v = Number(el.value.trim());
      if (!(v > 0)) return alert("Base handicap must be a positive number.");
      boat.h0 = v;
    } else {
      boat[el.dataset.boatField] = el.value.trim();
    }
    persist(() => store.saveBoat(boat));
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
  const blob = new Blob([JSON.stringify({ app: "nhc", version: 1, ...data }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nhc-results-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importData(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.boats) || !Array.isArray(parsed.races)) throw new Error("not an NHC data file");
  } catch (e) {
    return alert(`Couldn't import that file: ${e.message}`);
  }
  if ((data.boats.length || data.races.length) && !confirm(store.shared ? "Replace ALL shared results with the imported file?" : "Replace the data in this browser with the imported file?")) return;
  view = { tab: "races", raceId: null, draft: null };
  await persist(() => store.replaceAll({ boats: parsed.boats, races: parsed.races }));
}

// ---- start ----

// Open the club with this code. Returns false (with status.clubError set) if it can't.
async function connect(code) {
  status.clubError = null;
  try {
    store = await openClub(code);
  } catch (e) {
    status.clubError = `Couldn't connect to the results database: ${e.message}`;
    return false;
  }
  if (!store) {
    status.clubError = "No club has that code. Check it and try again.";
    return false;
  }
  store.onRemoteChange(() => {
    // Don't yank an in-progress race entry out from under the editor.
    if (!view.draft) reload();
  });
  return true;
}

(async () => {
  render();
  if (!isShared) {
    store = openLocal();
    return reload();
  }
  let saved = null;
  try {
    saved = localStorage.getItem(CLUB_KEY);
  } catch {
    // nothing saved
  }
  if (saved && (await connect(saved))) return reload();
  status.loading = false;
  render();
})();
