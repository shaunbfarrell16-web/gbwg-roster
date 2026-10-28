import { getStore } from "@netlify/blobs";

// The Great British Warcraft Guild – shared roster.
// Each character is one entry in the "gbwg-roster" Netlify Blobs store (same format as before,
// so every existing character carries over). New optional fields: formerNames, renamedAt, history.

// ---------- WoW Forever (Alliance) ----------
const RACE_CLASSES = {
  "Human": ["Hunter", "Mage", "Paladin", "Priest", "Rogue", "Warlock", "Warrior"],
  "Dwarf": ["Hunter", "Paladin", "Priest", "Rogue", "Shaman", "Warrior"],
  "Night Elf": ["Druid", "Hunter", "Priest", "Rogue", "Warrior"],
  "Gnome": ["Mage", "Priest", "Rogue", "Warlock", "Warrior"],
  "High Order Skyborne": ["Druid", "Hunter", "Mage", "Rogue", "Warrior"],
};
const SPECS = {
  Druid: ["Balance", "Feral", "Restoration"],
  Hunter: ["Beast Mastery", "Marksmanship", "Survival"],
  Mage: ["Arcane", "Fire", "Frost"],
  Paladin: ["Holy", "Protection", "Retribution"],
  Priest: ["Discipline", "Holy", "Shadow"],
  Rogue: ["Assassination", "Combat", "Subtlety"],
  Shaman: ["Elemental", "Enhancement", "Restoration"],
  Warlock: ["Affliction", "Demonology", "Destruction"],
  Warrior: ["Arms", "Fury", "Protection"],
};
const RACES = Object.keys(RACE_CLASSES);
const PROFS = ["None", "Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring"];
const SECONDARY = ["Cooking", "First Aid", "Fishing"];
const ROLES = ["Tank", "Healer", "DPS"];
const TRACKED = ["name", "player", "race", "cls", "spec", "role", "prof1", "prof2", "secondary", "level"];
const MAX_HISTORY = 12;
const MAX_FORMER = 6;

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isAdmin = (pin) => {
  const real = process.env.ADMIN_PIN;
  return Boolean(real) && String(pin || "") === real;
};
const roster = () => getStore({ name: "gbwg-roster", consistency: "strong" });
const pub = ({ token, ...c }) => c;

async function listAll(store) {
  const { blobs } = await store.list();
  const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
  return all.filter((c) => c && c.id && c.name);
}

// Read-modify-write one character safely, so two people saving at once can't overwrite each other.
async function updateCharacter(store, id, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata(String(id), { type: "json" });
    if (!cur?.data) fail(404, "Character not found – it may have been removed.");
    const rec = cur.data;
    const result = await fn(rec);
    const res = await store.setJSON(rec.id, rec, cur.etag ? { onlyIfMatch: cur.etag } : {});
    if (res.modified !== false) return result;
    await sleep(40 + Math.random() * 160);
  }
  fail(409, "Someone else is saving this character right now. Please try again.");
}

function fields(body) {
  const c = {
    name: clean(body.name, 24),
    player: clean(body.player, 32),
    cls: clean(body.cls, 20),
    spec: clean(body.spec, 24),
    role: clean(body.role, 10),
    race: clean(body.race, 24),
    prof1: clean(body.prof1, 20) || "None",
    prof2: clean(body.prof2, 20) || "None",
    secondary: SECONDARY.filter((p) => Array.isArray(body.secondary) && body.secondary.includes(p)),
    level: parseInt(body.level, 10) ? Math.max(1, Math.min(90, parseInt(body.level, 10))) : null,
  };
  if (!c.name) fail(400, "Character name is required.");
  if (!RACES.includes(c.race)) fail(400, "Pick an Alliance race.");
  if (!RACE_CLASSES[c.race].includes(c.cls)) fail(400, `${c.race} can't be a ${c.cls} in WoW Forever.`);
  if (!SPECS[c.cls].includes(c.spec)) c.spec = "";
  if (!ROLES.includes(c.role)) fail(400, "Pick a role.");
  if (!PROFS.includes(c.prof1) || !PROFS.includes(c.prof2)) fail(400, "Invalid profession.");
  if (c.prof1 !== "None" && c.prof1 === c.prof2) fail(400, "Pick two different professions.");
  return c;
}

function diff(before, after) {
  const changes = {};
  for (const k of TRACKED) {
    const a = before[k] ?? null, b = after[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = [a, b];
  }
  return changes;
}
const latestUndoable = (rec) => [...(rec.history || [])].reverse().find((h) => !h.undo && !h.undone);

function addFormerName(rec, oldName, newName) {
  const list = (rec.formerNames || []).filter((n) => !same(n, oldName) && !same(n, newName));
  if (oldName && !same(oldName, newName)) list.push(oldName);
  rec.formerNames = list.slice(-MAX_FORMER);
}
function pushHistory(rec, entry) {
  rec.history = [...(rec.history || []), entry].slice(-MAX_HISTORY);
}

// ---------- handler ----------
export default async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "Something went wrong on the server. Please try again." }, 500);
  }
};
export const config = { path: "/api/roster" };

async function handle(req) {
  const store = roster();

  if (req.method === "GET") {
    const all = await listAll(store);
    all.sort((a, b) => a.name.localeCompare(b.name));
    return json(all.map(pub));
  }

  let body;
  try { body = await req.json(); } catch { fail(400, "Bad request"); }

  // Officer PIN check
  if (req.method === "PUT" && body.checkPin) {
    if (!isAdmin(body.pin)) await sleep(500);
    return json({ ok: isAdmin(body.pin) });
  }

  if (req.method === "POST" && body.action === "undo") {
    if (!isAdmin(body.pin)) fail(403, "Only officers can undo changes.");
    const all = await listAll(store);
    const character = await updateCharacter(store, body.id, (rec) => {
      const entry = latestUndoable(rec);
      if (!entry) fail(409, "There's nothing left to undo for this character.");
      if (body.at && entry.at !== body.at) fail(409, "This character has changed since you loaded the page. Refresh and try again.");
      const restore = {};
      for (const [k, [oldVal]] of Object.entries(entry.changes)) restore[k] = oldVal;
      if (restore.name && all.some((c) => c.id !== rec.id && same(c.name, restore.name)))
        fail(409, `Can't undo – someone else is now called ${restore.name}.`);
      const inverse = {};
      for (const [k, [oldVal, newVal]] of Object.entries(entry.changes)) { inverse[k] = [rec[k] ?? null, oldVal]; rec[k] = oldVal; }
      if (entry.changes.name) {
        const [oldName, newName] = entry.changes.name;
        rec.formerNames = (rec.formerNames || []).filter((n) => !same(n, oldName) && !same(n, newName));
        const prevRename = [...(rec.history || [])].reverse().find((h) => h !== entry && !h.undo && !h.undone && h.changes?.name);
        rec.renamedAt = prevRename ? prevRename.at : null;
      }
      entry.undone = true;
      rec.updated = Date.now();
      pushHistory(rec, { at: Date.now(), by: "officer", undo: true, changes: inverse });
      return pub(rec);
    });
    return json({ character });
  }

  if (req.method === "POST") {
    const c = fields(body);
    const all = await listAll(store);

    // Edit an existing character – anyone can, every change is logged and officers can undo it.
    if (body.id) {
      const current = all.find((x) => x.id === body.id);
      if (!current) fail(404, "Character not found – it may have been removed.");
      if (all.some((x) => x.id !== body.id && same(x.name, c.name))) fail(409, `${c.name} is already on the roster.`);
      if (!Object.keys(diff(current, c)).length) return json({ character: pub(current), changed: false });
      let changed = false;
      const character = await updateCharacter(store, body.id, (rec) => {
        const changes = diff(rec, c);
        changed = Object.keys(changes).length > 0;
        if (!changed) return pub(rec);
        const by = body.token && body.token === rec.token ? "owner" : isAdmin(body.pin) ? "officer" : "member";
        if (changes.name) { addFormerName(rec, rec.name, c.name); rec.renamedAt = Date.now(); }
        Object.assign(rec, c, { updated: Date.now() });
        pushHistory(rec, { at: Date.now(), by, changes });
        return pub(rec);
      });
      return json({ character, changed });
    }

    // Add a new character
    if (all.some((x) => same(x.name, c.name))) fail(409, `${c.name} is already on the roster.`);
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const record = { id, token, ...c, joined: Date.now(), updated: Date.now() };
    await store.setJSON(id, record);
    return json({ character: pub(record), token }, 201);
  }

  // Removing stays with the person who added it (same device) or an officer.
  if (req.method === "DELETE") {
    const existing = await store.get(String(body.id || ""), { type: "json" });
    if (!existing) fail(404, "Character not found.");
    if (existing.token !== body.token && !isAdmin(body.pin)) fail(403, "Only officers (or whoever added it, on the same device) can remove a character.");
    await store.delete(existing.id);
    return json({ ok: true });
  }

  fail(405, "Method not allowed");
}
