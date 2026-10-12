import { getStore } from "@netlify/blobs";

// Shared guild roster, stored in Netlify Blobs (one entry per character).
// WoW Forever – Alliance races and the classes each can play
const RACE_CLASSES = {
  "Human": ["Hunter","Mage","Paladin","Priest","Rogue","Warlock","Warrior"],
  "Dwarf": ["Hunter","Paladin","Priest","Rogue","Shaman","Warrior"],
  "Night Elf": ["Druid","Hunter","Priest","Rogue","Warrior"],
  "Gnome": ["Mage","Priest","Rogue","Warlock","Warrior"],
  "High Order Skyborne": ["Druid","Hunter","Mage","Rogue","Warrior"],
};
const CLASSES = ["Druid","Hunter","Mage","Paladin","Priest","Rogue","Shaman","Warlock","Warrior"];
const RACES = Object.keys(RACE_CLASSES);
const PROFS = ["None","Alchemy","Blacksmithing","Enchanting","Engineering","Herbalism","Leatherworking","Mining","Skinning","Tailoring"];
const SECONDARY = ["Cooking","First Aid","Fishing"];
const ROLES = ["Tank","Healer","DPS"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const clean = (v, max) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, max);
const isAdmin = (pin) => {
  const real = process.env.ADMIN_PIN;
  return Boolean(real) && String(pin || "") === real;
};

export default async (req) => {
  const store = getStore({ name: "gbwg-roster", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    const roster = all.filter(Boolean).map(({ token, ...c }) => c);
    roster.sort((a, b) => a.name.localeCompare(b.name));
    return json(roster);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (req.method === "POST") {
    const c = {
      name: clean(body.name, 24),
      player: clean(body.player, 32),
      cls: clean(body.cls, 20),
      spec: clean(body.spec, 24),
      role: clean(body.role, 10),
      race: clean(body.race, 24),
      prof1: clean(body.prof1, 20) || "None",
      prof2: clean(body.prof2, 20) || "None",
      secondary: (Array.isArray(body.secondary) ? body.secondary : []).filter((p) => SECONDARY.includes(p)),
      level: parseInt(body.level, 10) ? Math.max(1, Math.min(90, parseInt(body.level, 10))) : null,
    };
    if (!c.name) return json({ error: "Character name is required." }, 400);
    if (!CLASSES.includes(c.cls)) return json({ error: "Pick a class." }, 400);
    if (!RACES.includes(c.race)) return json({ error: "Pick an Alliance race." }, 400);
    if (!RACE_CLASSES[c.race].includes(c.cls)) return json({ error: `${c.race}s can't be ${c.cls}s in WoW Forever.` }, 400);
    if (!ROLES.includes(c.role)) return json({ error: "Pick a role." }, 400);
    if (!PROFS.includes(c.prof1) || !PROFS.includes(c.prof2)) return json({ error: "Invalid profession." }, 400);
    if (c.prof1 !== "None" && c.prof1 === c.prof2) return json({ error: "Pick two different professions." }, 400);

    if (body.id) {
      const existing = await store.get(String(body.id), { type: "json" });
      if (!existing) return json({ error: "Character not found." }, 404);
      if (existing.token !== body.token && !isAdmin(body.pin)) return json({ error: "You can only edit your own characters." }, 403);
      const updated = { ...existing, ...c, updated: Date.now() };
      await store.setJSON(existing.id, updated);
      const { token, ...pub } = updated;
      return json({ character: pub });
    }

    const { blobs } = await store.list();
    const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    if (all.some((x) => x && x.name.toLowerCase() === c.name.toLowerCase()))
      return json({ error: `${c.name} is already on the roster.` }, 409);

    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    const record = { id, token, ...c, joined: Date.now(), updated: Date.now() };
    await store.setJSON(id, record);
    const { token: _t, ...pub } = record;
    return json({ character: pub, token }, 201);
  }

  if (req.method === "DELETE") {
    const existing = await store.get(String(body.id || ""), { type: "json" });
    if (!existing) return json({ error: "Character not found." }, 404);
    if (existing.token !== body.token && !isAdmin(body.pin)) return json({ error: "You can only remove your own characters." }, 403);
    await store.delete(existing.id);
    return json({ ok: true });
  }

  if (req.method === "PUT" && body.checkPin) {
    return json({ ok: isAdmin(body.pin) });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = { path: "/api/roster" };
