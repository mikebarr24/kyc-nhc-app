// Persistence: Supabase when configured, otherwise this browser's localStorage.
// Both stores expose the same interface so the UI doesn't care which is in use.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const STORAGE_KEY = "nhc-data-v1";

// With Supabase, each club's data is opened with its code (see openClub).
export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function openLocal() {
  return new LocalStore();
}

// Returns the club's store, or null if no club has this code.
export async function openClub(code) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  // The database only shows rows for the club whose code comes in this header.
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-club-code": code.trim().toLowerCase() } },
  });
  const { data, error } = await db.from("clubs").select("id, name").maybeSingle();
  if (error) throw error;
  return data ? new SupabaseStore(db, data) : null;
}

class LocalStore {
  shared = false;
  club = null;
  data = { boats: [], races: [] };

  async load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        this.data = { boats: d.boats || [], races: d.races || [] };
      }
    } catch {
      // keep empty data
    }
    return structuredClone(this.data);
  }

  #persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
  }

  #upsert(list, item) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
  }

  async saveBoat(boat) {
    this.#upsert(this.data.boats, structuredClone(boat));
    this.#persist();
  }

  async deleteBoat(id) {
    this.data.boats = this.data.boats.filter((b) => b.id !== id);
    this.data.races.forEach((r) => delete r.entries?.[id]);
    this.#persist();
  }

  async saveRace(race) {
    this.#upsert(this.data.races, structuredClone(race));
    this.#persist();
  }

  async deleteRace(id) {
    this.data.races = this.data.races.filter((r) => r.id !== id);
    this.#persist();
  }

  async replaceAll(data) {
    this.data = structuredClone(data);
    this.#persist();
  }

  onRemoteChange() {}
  close() {}
}

const boatToRow = (b) => ({ id: b.id, name: b.name, sail_no: b.sailNo || null, h0: b.h0 });
const rowToBoat = (r) => ({ id: r.id, name: r.name, sailNo: r.sail_no || "", h0: Number(r.h0) });
const raceToRow = (r) => ({
  id: r.id,
  date: r.date || null,
  name: r.name || null,
  time_mode: r.timeMode || "elapsed",
  start: r.start || null,
  entries: r.entries || {},
});
const rowToRace = (r) => ({
  id: r.id,
  date: r.date || "",
  name: r.name || "",
  timeMode: r.time_mode,
  start: r.start || "",
  entries: r.entries || {},
});

class SupabaseStore {
  shared = true;

  constructor(client, club) {
    this.db = client;
    this.club = club;
    // Tells other open copies of this club's page that something changed.
    this.channel = client.channel(`club:${club.id}`);
  }

  async load() {
    const [boats, races] = await Promise.all([
      this.db.from("boats").select("*").order("created_at"),
      this.db.from("races").select("*").order("created_at"),
    ]);
    for (const res of [boats, races]) if (res.error) throw res.error;
    return { boats: boats.data.map(rowToBoat), races: races.data.map(rowToRace) };
  }

  async #check(promise) {
    const { error } = await promise;
    if (error) throw error;
    this.channel.send({ type: "broadcast", event: "changed", payload: {} });
  }

  #row(row) {
    return { ...row, club_id: this.club.id };
  }

  saveBoat(boat) {
    return this.#check(this.db.from("boats").upsert(this.#row(boatToRow(boat)), { onConflict: "club_id,id" }));
  }

  async deleteBoat(id) {
    const { data, error } = await this.db.from("races").select("*").not(`entries->${id}`, "is", null);
    if (error) throw error;
    for (const row of data) {
      const { [id]: _removed, ...entries } = row.entries;
      await this.#check(this.db.from("races").update({ entries }).eq("id", row.id));
    }
    await this.#check(this.db.from("boats").delete().eq("id", id));
  }

  saveRace(race) {
    return this.#check(this.db.from("races").upsert(this.#row(raceToRow(race)), { onConflict: "club_id,id" }));
  }

  deleteRace(id) {
    return this.#check(this.db.from("races").delete().eq("id", id));
  }

  async replaceAll(data) {
    await this.#check(this.db.from("races").delete().neq("id", ""));
    await this.#check(this.db.from("boats").delete().neq("id", ""));
    // Stagger created_at so the original order is kept.
    const t0 = Date.now();
    const stamp = (row, i) => ({ ...this.#row(row), created_at: new Date(t0 + i).toISOString() });
    if (data.boats.length) await this.#check(this.db.from("boats").insert(data.boats.map(boatToRow).map(stamp)));
    if (data.races.length) await this.#check(this.db.from("races").insert(data.races.map(raceToRow).map(stamp)));
  }

  onRemoteChange(callback) {
    let timer;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(callback, 300);
    };
    this.channel.on("broadcast", { event: "changed" }, debounced).subscribe();
  }

  close() {
    this.db.removeAllChannels();
  }
}
