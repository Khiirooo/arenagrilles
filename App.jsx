import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings, Gavel, Trophy, Check, Plus, Trash2, RotateCcw, Users,
  Monitor, LogOut, Play, ChevronRight, KeyRound, ShieldCheck, Eye, Flag, Bell, Mic, Pencil
} from "lucide-react";
import { store } from "./store";

/* ================================================================== *
 *  Console de compétition GAF / GAM — FfG (v4)
 *  - Deux disciplines : GAF (4 agrès) & GAM (6 agrès)
 *  - Barèmes configurables : D+E ou note unique (/10 /20 /30) + bonus/malus
 *  - Plateaux mixtes : le live bascule GAF <-> GAM (matin/après-midi)
 *  - Juge choisit discipline + agrès ; coach inscrit ses gymnastes
 *  Temps réel simulé (stockage partagé). Prod = Supabase + hébergement.
 * ================================================================== */

const LOGO = "https://raw.githubusercontent.com/Khiirooo/arenagrilles/main/photo/ChatGPT%20Image%208%20sept.%202026,%2023_17_16.png"
  
const DISCIPLINES = {
  GAF: { label: "GAF", apparatus: [
    { id: "saut", label: "Saut" }, { id: "barres", label: "Barres" },
    { id: "poutre", label: "Poutre" }, { id: "sol", label: "Sol" },
  ] },
  GAM: { label: "GAM", apparatus: [
    { id: "gsol", label: "Sol" }, { id: "arcons", label: "Arçons" },
    { id: "anneaux", label: "Anneaux" }, { id: "gsaut", label: "Saut" },
    { id: "paralleles", label: "Barres //" }, { id: "fixe", label: "Fixe" },
  ] },
};
const DISCS = Object.keys(DISCIPLINES);
const apparatusOf = (disc) => DISCIPLINES[disc]?.apparatus || [];
const apparatusForGroup = (gi, rot, disc) => { const a = apparatusOf(disc); return a[(gi + rot) % a.length]; };
const sessionKey = (s) => s.role === "juge" ? `juge:${s.discipline}:${s.apparatus}:${s.judgeType === "js" ? "JS" : s.judge}` : s.role === "coach" ? `coach:${s.club}` : s.role;
const sessionLabel = (s) => {
  if (s.role === "juge") { const ap = apparatusOf(s.discipline).find((a) => a.id === s.apparatus)?.label || s.apparatus; return `${s.discipline} · ${ap} · ${s.judgeType === "js" ? "Juge Sup." : "Juge " + s.judge}`; }
  if (s.role === "coach") return `Coach ${s.club}`;
  return { organisateur: "Organisateur", superviseur: "Superviseur", speaker: "Speaker", public: "Public" }[s.role];
};
const randCode = (p) => (p.slice(0, 4).toUpperCase().replace(/[^A-Z]/g, "") || "CODE") + Math.floor(1000 + Math.random() * 9000);
const abbr = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, "").toUpperCase();
const seedJudgeCodes = () => { const jc = {}; DISCS.forEach((d) => apparatusOf(d).forEach((a) => { jc[`${d}:${a.id}`] = `${abbr(a.label).slice(0, 5)}${d === "GAF" ? "F" : "M"}26`; })); return jc; };
const seedJsCodes = () => { const jc = {}; DISCS.forEach((d) => apparatusOf(d).forEach((a) => { jc[`${d}:${a.id}`] = `${abbr(a.label).slice(0, 4)}${d === "GAF" ? "F" : "M"}JS`; })); return jc; };
const groupComp = (roster, config, letter) => { const set = new Set(); roster.filter((g) => g.group === letter).forEach((g) => { const d = config.divisions.find((x) => x.id === g.division); if (d) set.add(`${d.discipline} ${d.label}·${g.category}`); }); return [...set]; };

const CONFIG_KEY = "ffg10:config";
const ROSTER_KEY = "ffg10:roster";
const SCORES_KEY = "ffg10:scores";
const LIVE_KEY = "ffg10:live";
const INQ_KEY = "ffg10:inquiries";
const LOG_KEY = "ffg10:log";
const CHAT_KEY = "ffg10:chat";
const PRESENCE_KEY = "ffg10:presence";

/* ---------- stockage partagé (window.storage) + repli mémoire ---------- */
// La couche de stockage vient de ./lib/store (Supabase).

/* ================================================================== *
 *  ⬇️⬇️⬇️   PANNEAU DE CONFIGURATION — MODIFIE ICI   ⬇️⬇️⬇️
 *  Tu changes ce que tu veux ci-dessous, PUIS tu augmentes
 *  CONFIG_VERSION de 1 (ex. 1 -> 2). Commit sur GitHub :
 *  le site se met à jour tout seul en ~1 min et recharge cette
 *  config pour tout le monde.
 *  (Astuce : tu peux aussi tout régler dans l'app, onglet Réglages —
 *   mais ces réglages-là sont écrasés si tu augmentes la version.)
 * ================================================================== */
const CONFIG_VERSION = 1; // ⚠️ +1 à CHAQUE modif du bloc CONFIG ci-dessous

const CONFIG = {
  // ---- Codes d'accès par rôle ----
  codes: {
    organisateur: "ORGA2026",
    superviseur:  "SUPER2026",
    speaker:      "SPEAK2026",
    coach:        "COACH2026",
  },
  // Codes juges & Juge Supérieur par agrès (générés auto : ex. SAUTF26 / SAUTFJS)
  judgeCodes: seedJudgeCodes(),
  jsCodes:    seedJsCodes(),

  // ---- DIVISIONS (le "niveau") ----
  // discipline : "GAF" (4 agrès) ou "GAM" (6 agrès)
  // mode       : "DE" (note D + note E)  ou  "single" (note unique)
  // start      : note de départ / max (10, 20 ou 30)
  // combine    : "avg" (moyenne) | "trim" (retire le + haut et le + bas) | "median"
  // judges     : nombre de juges du panel
  // bonus      : true = ajoute un champ bonus/malus (niveaux Promo/Détection)
  divisions: [
    { id: "gaf-D2",    label: "D2",    discipline: "GAF", mode: "DE",     start: 10, combine: "avg", judges: 3, bonus: false },
    { id: "gaf-D3",    label: "D3",    discipline: "GAF", mode: "DE",     start: 10, combine: "avg", judges: 3, bonus: false },
    { id: "gaf-D4",    label: "D4",    discipline: "GAF", mode: "single", start: 10, combine: "avg", judges: 3, bonus: false },
    { id: "gaf-D5",    label: "D5",    discipline: "GAF", mode: "single", start: 10, combine: "avg", judges: 2, bonus: false },
    { id: "gaf-D6",    label: "D6",    discipline: "GAF", mode: "single", start: 10, combine: "avg", judges: 2, bonus: false },
    { id: "gaf-Promo", label: "Promo", discipline: "GAF", mode: "single", start: 20, combine: "avg", judges: 2, bonus: true  },
    { id: "gam-D2",    label: "D2",    discipline: "GAM", mode: "DE",     start: 10, combine: "avg", judges: 3, bonus: false },
    { id: "gam-D4",    label: "D4",    discipline: "GAM", mode: "single", start: 10, combine: "avg", judges: 3, bonus: false },
  ],

  // ---- CATÉGORIES d'âge (ajoute / retire librement) ----
  categories: ["Poussines", "Benjamines", "Minimes", "Cadettes", "Juniores", "Seniores"],

  // ---- GROUPES / plateaux (qui tournent sur les agrès) ----
  groups: ["A", "B", "C", "D"],

  // ---- HORAIRE de base (les heures sont ensuite ajustables dans l'app) ----
  schedule: { startTime: "09:30", durationMin: 45 },

  // ---- Divers ----
  teamBestN: 3,            // équipes : nb de meilleurs scores comptés par agrès
  inquiryWindowSec: 120,   // délai (en secondes) pour poser une réclamation
  announcement: "Bienvenue au championnat — bon concours à toutes et tous !",
  publicUrl: "https://arenagrilles.vercel.app", // adresse encodée dans le QR
  frozen: false,
};
/* ================================================================== *
 *  ⬆️⬆️⬆️   FIN DU PANNEAU DE CONFIGURATION   ⬆️⬆️⬆️
 * ================================================================== */

const seedConfig = () => ({ ...CONFIG, _v: CONFIG_VERSION });
const seedRoster = () => ([
  { id: "g1", name: "Léa Martin", club: "Tempogym", division: "gaf-D4", category: "Benjamines", team: "Tempogym A", group: "A" },
  { id: "g2", name: "Emma Dubois", club: "Tempogym", division: "gaf-D4", category: "Benjamines", team: "Tempogym A", group: "A" },
  { id: "g3", name: "Chloé Renard", club: "Tempogym", division: "gaf-D4", category: "Benjamines", team: "Tempogym A", group: "B" },
  { id: "g5", name: "Zoé Lambert", club: "GC Malmedy", division: "gaf-D4", category: "Benjamines", team: "Malmedy 1", group: "B" },
  { id: "g6", name: "Inès Simon", club: "GC Malmedy", division: "gaf-D4", category: "Benjamines", team: "Malmedy 1", group: "C" },
  { id: "g8", name: "Julia Moreau", club: "Hémérocallis", division: "gaf-D2", category: "Minimes", team: "", group: "D" },
  { id: "g10", name: "Camille Denis", club: "Tempogym", division: "gaf-D6", category: "Poussines", team: "", group: "A" },
  { id: "gm1", name: "Noah Lambin", club: "Tempogym", division: "gam-D4", category: "Benjamines", team: "Tempogym G", group: "A" },
  { id: "gm2", name: "Tom Verhoeven", club: "GC Malmedy", division: "gam-D4", category: "Benjamines", team: "", group: "B" },
  { id: "gm3", name: "Liam Dubois", club: "Tempogym", division: "gam-D2", category: "Minimes", team: "", group: "C" },
]);

/* ------------------------------ helpers ------------------------------ */
const parseNum = (v) => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (n == null ? "—" : round2(n).toFixed(2));
const fmt3 = (n) => (n == null ? "—" : Number(n).toFixed(3));
const parseTime = (t) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + m; };
const toClock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const rotTime = (config, disc, rot) => { const o = config.schedule.times?.[disc]?.[rot]; return (o != null && o !== "") ? parseTime(o) : parseTime(config.schedule.startTime) + rot * config.schedule.durationMin; };
const combine = (values, rule) => {
  const a = values.filter((v) => v != null && !isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  if (rule === "median") { const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  if (rule === "trim" && a.length >= 3) { const t = a.slice(1, -1); return t.reduce((s, v) => s + v, 0) / t.length; }
  return a.reduce((s, v) => s + v, 0) / a.length;
};
const cellTotal = (cell, div) => {
  if (!cell || !div) return null;
  const pen = cell.pen || 0;
  if (div.mode === "DE") {
    const e = combine(Object.values(cell.e || {}), div.combine);
    if (cell.d == null && e == null) return null;
    return round2((cell.d || 0) + (e || 0) - pen);
  }
  const b = combine(Object.values(cell.notes || {}), div.combine);
  if (b == null) return null;
  const bonus = div.bonus ? (cell.bonus || 0) : 0;
  return round2(b + bonus - pen);
};
const validatedTotal = (cell, div) => (cell && cell.status === "validated") ? cellTotal(cell, div) : null;
const gymTotal = (scores, div, g) => apparatusOf(div.discipline).reduce((s, a) => s + (validatedTotal(scores?.[g.id]?.[a.id], div) || 0), 0);
const catsFor = (config, roster, divisionId) => { const s = new Set(roster.filter((g) => g.division === divisionId).map((g) => g.category)); const present = config.categories.filter((c) => s.has(c)); return present.length ? present : config.categories; };
const matchG = (g, q) => { if (!q) return true; const s = q.toLowerCase(); return g.name.toLowerCase().includes(s) || String(g.dossard || "").includes(s); };
const bibSort = (a, b) => { const da = parseInt(a.dossard) || 1e9, db = parseInt(b.dossard) || 1e9; return da - db || a.name.localeCompare(b.name); };
const bestCell = (scores, div, g) => Math.max(-1, ...apparatusOf(div.discipline).map((a) => validatedTotal(scores?.[g.id]?.[a.id], div) ?? -1));
const cgSort = (scores, div) => (a, b) => (b.total - a.total) || (bestCell(scores, div, b.g) - bestCell(scores, div, a.g)) || a.g.name.localeCompare(b.g.name);
const tourFor = (config, disc, groupLetter, apId) => { const gi = config.groups.indexOf(groupLetter); if (gi < 0) return null; const aps = apparatusOf(disc); for (let r = 0; r < aps.length; r++) if (apparatusForGroup(gi, r, disc).id === apId) return r + 1; return null; };

/* ------------------------- feuille de style ------------------------- */
const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@400;500;600;700&family=Saira:wght@400;500;600&display=swap');
:root{--bg:#0a0b0d;--panel:#141619;--panel2:#1b1e23;--line:#2b2f36;--silver:#e9ecf1;--dim:#969ca7;--faint:#5c626c;--gold:#e2ae46;--gold-hi:#f4cf7c;--gold-dim:#6f5a26;--late:#e05a3c;--early:#6aa2cc;--valid:#3fae6a;--draft:#d98a3a;}
.ff{font-family:'Saira',system-ui,sans-serif;color:var(--silver);}
.disp{font-family:'Saira Condensed','Saira',sans-serif;letter-spacing:.01em;}
.num{font-variant-numeric:tabular-nums;font-feature-settings:'tnum';}
.appbg{background:radial-gradient(1200px 600px at 20% -10%,#17303a55,transparent 60%),radial-gradient(900px 500px at 100% 0%,#2a220f66,transparent 55%),var(--bg);}
.grain:after{content:"";position:fixed;inset:0;pointer-events:none;opacity:.05;z-index:60;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;}
.panel2{background:var(--panel2);border:1px solid var(--line);border-radius:10px;}
.btn{font-family:'Saira Condensed',sans-serif;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:.55rem 1rem;border-radius:9px;font-size:.9rem;display:inline-flex;align-items:center;gap:.4rem;cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--silver);transition:.15s;}
.btn:hover{border-color:var(--faint);}
.btn-gold{background:linear-gradient(180deg,var(--gold-hi),var(--gold));color:#241c07;border:none;box-shadow:0 1px 0 #ffffff40 inset,0 6px 16px #e2ae4622;}
.btn-gold:hover{filter:brightness(1.06);}
.btn:disabled{opacity:.3;cursor:default;}
.seg{padding:.4rem .8rem;border-radius:8px;font-size:.85rem;border:1px solid var(--line);background:var(--panel2);color:var(--dim);cursor:pointer;font-family:'Saira Condensed',sans-serif;font-weight:500;letter-spacing:.02em;transition:.15s;}
.seg:hover{color:var(--silver);}
.seg-on{background:var(--silver);color:#0a0b0d;border-color:var(--silver);}
.seg-gold{background:linear-gradient(180deg,var(--gold-hi),var(--gold));color:#241c07;border:none;}
.inp{background:#0e1013;border:1px solid var(--line);border-radius:8px;color:var(--silver);padding:.5rem .6rem;font-family:'Saira',sans-serif;}
.inp:focus{outline:none;border-color:var(--gold);}
.inp.num{font-family:'Saira Condensed',sans-serif;}
.lbl{font-family:'Saira Condensed',sans-serif;text-transform:uppercase;letter-spacing:.08em;font-size:.68rem;color:var(--faint);}
.gold{color:var(--gold);}.dim{color:var(--dim);}.faint{color:var(--faint);}
.livedot{width:9px;height:9px;border-radius:50%;background:var(--gold);animation:pulse 1.8s infinite;}
@keyframes pulse{0%{box-shadow:0 0 0 0 #e2ae4699}70%{box-shadow:0 0 0 8px #e2ae4600}100%{box-shadow:0 0 0 0 #e2ae4600}}
.risein{animation:rise .6s cubic-bezier(.2,.7,.2,1) both;}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.logospin{filter:drop-shadow(0 8px 24px #000a);}
.flash{animation:flash .9s ease;}
@keyframes flash{0%{box-shadow:0 0 0 3px var(--gold),0 0 40px #e2ae4688;}100%{box-shadow:none;}}
@media (prefers-reduced-motion:reduce){.risein,.livedot{animation:none;}}
input[type=time]::-webkit-calendar-picker-indicator{filter:invert(.7);}
`;

/* ============================== APP ============================== */
export default function App() {
  const [config, setConfig] = useState(null);
  const [roster, setRoster] = useState([]);
  const [scores, setScores] = useState({});
  const [live, setLive] = useState({ discipline: "GAF", currentRotation: 0, startedAt: {} });
  const [inquiries, setInquiries] = useState([]);
  const [presence, setPresence] = useState({});
  const [session, setSession] = useState(null);

  useEffect(() => { (async () => {
    let c = await store.get(CONFIG_KEY); if (!c || c._v !== CONFIG_VERSION) { c = seedConfig(); await store.set(CONFIG_KEY, c); }
    let r = await store.get(ROSTER_KEY); if (!r) { r = seedRoster(); await store.set(ROSTER_KEY, r); }
    setConfig(c); setRoster(r);
    setScores((await store.get(SCORES_KEY)) || {});
    setLive((await store.get(LIVE_KEY)) || { discipline: "GAF", currentRotation: 0, startedAt: {} });
    setInquiries((await store.get(INQ_KEY)) || []);
  })(); }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      setScores((await store.get(SCORES_KEY)) || {});
      setLive((await store.get(LIVE_KEY)) || { discipline: "GAF", currentRotation: 0, startedAt: {} });
      setRoster((await store.get(ROSTER_KEY)) || []);
      setInquiries((await store.get(INQ_KEY)) || []);
      setPresence((await store.get(PRESENCE_KEY)) || {});
      const c = await store.get(CONFIG_KEY); if (c) setConfig(c);
    }, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!session || session.role === "public") return;
    const key = sessionKey(session); let on = true;
    const beat = async () => { if (!on) return; const p = (await store.get(PRESENCE_KEY)) || {}; const now = Date.now(); p[key] = { label: sessionLabel(session), role: session.role, ts: now }; Object.keys(p).forEach((k) => { if (now - (p[k]?.ts || 0) > 60000) delete p[k]; }); await store.set(PRESENCE_KEY, p); setPresence(p); };
    beat(); const iv = setInterval(beat, 8000); return () => { on = false; clearInterval(iv); };
  }, [session]);

  const saveConfig = useCallback(async (c) => { setConfig(c); await store.set(CONFIG_KEY, c); }, []);
  const saveLive = useCallback(async (l) => { setLive(l); await store.set(LIVE_KEY, l); }, []);
  const addGymnast = useCallback(async (g) => { const item = { ...g, id: "g" + Date.now() + Math.floor(Math.random() * 1000) }; let n; for (let i = 0; i < 4; i++) { const l = (await store.get(ROSTER_KEY)) || []; n = [...l, item]; await store.set(ROSTER_KEY, n); const chk = (await store.get(ROSTER_KEY)) || []; if (chk.find((x) => x.id === item.id)) { n = chk; break; } } setRoster(n); }, []);
  const removeGymnast = useCallback(async (id) => { let n; for (let i = 0; i < 4; i++) { const l = (await store.get(ROSTER_KEY)) || []; n = l.filter((x) => x.id !== id); await store.set(ROSTER_KEY, n); const chk = (await store.get(ROSTER_KEY)) || []; if (!chk.find((x) => x.id === id)) { n = chk; break; } } setRoster(n); }, []);
  const editGymnast = useCallback(async (id, patch) => { let n; for (let i = 0; i < 4; i++) { const l = (await store.get(ROSTER_KEY)) || []; n = l.map((x) => (x.id === id ? { ...x, ...patch } : x)); await store.set(ROSTER_KEY, n); const chk = (await store.get(ROSTER_KEY)) || []; const it = chk.find((x) => x.id === id); if (it && Object.keys(patch).every((k) => it[k] === patch[k])) { n = chk; break; } } setRoster(n); }, []);
  const writeCell = useCallback(async (gid, aid, patch) => {
    let m;
    for (let attempt = 0; attempt < 4; attempt++) {
      const l = (await store.get(SCORES_KEY)) || {};
      m = { ...l, [gid]: { ...(l[gid] || {}) } };
      const prev = m[gid][aid] || {};
      m[gid][aid] = { ...prev, ...patch, ts: Date.now(), e: { ...(prev.e || {}), ...(patch.e || {}) }, notes: { ...(prev.notes || {}), ...(patch.notes || {}) } };
      await store.set(SCORES_KEY, m);
      const check = (await store.get(SCORES_KEY)) || {}; const c = check[gid]?.[aid] || {};
      const ok = Object.keys(patch).every((k) => (k === "e" || k === "notes") ? Object.keys(patch[k]).every((s) => c[k]?.[s] === patch[k][s]) : c[k] === patch[k]);
      if (ok) { m = check; break; }
    }
    setScores(m);
  }, []);
  const addInquiry = useCallback(async (inq) => { const l = (await store.get(INQ_KEY)) || []; const n = [{ ...inq, id: "i" + Date.now(), filedAt: Date.now(), status: "pending" }, ...l]; setInquiries(n); await store.set(INQ_KEY, n); }, []);
  const updateInquiry = useCallback(async (id, patch) => { const l = (await store.get(INQ_KEY)) || []; const n = l.map((x) => (x.id === id ? { ...x, ...patch } : x)); setInquiries(n); await store.set(INQ_KEY, n); }, []);
  const deleteCell = useCallback(async (gid, aid) => { const l = (await store.get(SCORES_KEY)) || {}; if (l[gid]) { const m = { ...l, [gid]: { ...l[gid] } }; delete m[gid][aid]; setScores(m); await store.set(SCORES_KEY, m); } }, []);
  const resync = useCallback(async () => { setScores((await store.get(SCORES_KEY)) || {}); setRoster((await store.get(ROSTER_KEY)) || []); setLive((await store.get(LIVE_KEY)) || { discipline: "GAF", currentRotation: 0, startedAt: {} }); setInquiries((await store.get(INQ_KEY)) || []); setPresence((await store.get(PRESENCE_KEY)) || {}); const c = await store.get(CONFIG_KEY); if (c) setConfig(c); }, []);

  if (!config) return <div className="ff appbg" style={{ minHeight: "100vh", padding: 32 }}>Chargement…</div>;
  if (!session) return <><style>{STYLE}</style><Gate config={config} onEnter={setSession} presence={presence} /></>;

  const apLbl = apparatusOf(session.discipline).find((a) => a.id === session.apparatus)?.label;
  const roleLabel = { organisateur: "Organisateur", superviseur: "Superviseur", speaker: "Speaker", juge: `${session.discipline} · ${apLbl} · ${session.judgeType === "js" ? "Juge Sup." : "Juge " + session.judge}`, coach: session.club, public: "Écran public" }[session.role];

  return (
    <div className="ff appbg grain" style={{ minHeight: "100vh" }}>
      <style>{STYLE}</style>
      <header style={{ borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 20, backdropFilter: "blur(8px)", background: "#0a0b0dcc" }}>
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={LOGO} alt="Tempogym" style={{ height: 40 }} className="logospin" />
            <div className="leading-none">
              <div className="disp" style={{ fontSize: "1.05rem", fontWeight: 700 }}>COMPÉTITION · GAF / GAM</div>
              <div className="lbl" style={{ marginTop: 3 }}>Fédération francophone de Gymnastique</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="panel2 disp" style={{ padding: ".25rem .7rem", fontSize: ".8rem", letterSpacing: ".04em" }}>{roleLabel}</span>
            <button onClick={() => setSession(null)} className="dim" title="Quitter"><LogOut size={16} /></button>
          </div>
        </div>
      </header>

      {session.role !== "public" && <RotationBanner live={live} config={config} />}

      <main className="max-w-6xl mx-auto p-4">
        {session.role === "organisateur" && <OrganiserApp {...{ config, roster, scores, live, writeCell, saveConfig, saveLive, addGymnast, removeGymnast, presence, deleteCell, resync }} resetScores={async () => { setScores({}); await store.set(SCORES_KEY, {}); }} resetRoster={async () => { setScores({}); setRoster([]); await store.set(SCORES_KEY, {}); await store.set(ROSTER_KEY, []); }} />}
        {session.role === "juge" && session.judgeType === "js" && <AgresControlView config={config} roster={roster} scores={scores} writeCell={writeCell} discipline={session.discipline} apparatus={session.apparatus} inquiries={inquiries} live={live} />}
        {session.role === "juge" && session.judgeType !== "js" && <JudgeView config={config} roster={roster} scores={scores} writeCell={writeCell} judge={session.judge} discipline={session.discipline} apparatus={session.apparatus} live={live} />}
        {session.role === "superviseur" && <SupervisorApp {...{ config, roster, scores, inquiries, updateInquiry, writeCell }} />}
        {session.role === "speaker" && <SpeakerApp {...{ config, roster, scores, live }} />}
        {session.role === "coach" && <CoachApp {...{ config, roster, scores, live, club: session.club, addGymnast, removeGymnast, editGymnast, inquiries, addInquiry }} />}
        {session.role === "public" && <PublicApp {...{ config, roster, scores, live }} />}
      </main>
    </div>
  );
}

/* ------------------------------ Gate ------------------------------ */
function Gate({ config, onEnter, presence }) {
  const [role, setRole] = useState(null);
  const [code, setCode] = useState("");
  const [discipline, setDiscipline] = useState("GAF");
  const [judge, setJudge] = useState(1);
  const [js, setJs] = useState(false);
  const [apparatus, setApparatus] = useState("saut");
  const [club, setClub] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { setApparatus(apparatusOf(discipline)[0].id); }, [discipline]);

  const liveRoles = [
    { id: "juge", label: "Juge", desc: "Noter un agrès en cours", icon: Gavel },
    { id: "speaker", label: "Speaker", desc: "Voir le passage et annoncer les notes", icon: Mic },
    { id: "superviseur", label: "Superviseur", desc: "Traiter les réclamations", icon: Flag },
    { id: "public", label: "Écran / Public", desc: "Suivre le classement en direct", icon: Monitor },
  ];
  const adminRoles = [
    { id: "organisateur", label: "Organisateur", desc: "Tout gérer (paramètres, inscriptions, accès)", icon: ShieldCheck },
    { id: "coach", label: "Coach / Club", desc: "Gérer mes gymnastes et mes équipes", icon: Users },
  ];
  const roleCard = ({ id, label, desc, icon: Icon }) => (
    <button key={id} onClick={() => { setRole(id); setErr(""); }} className="text-left p-3 panel2" style={role === id ? { borderColor: "var(--gold)", boxShadow: "0 0 0 1px var(--gold)" } : {}}>
      <Icon size={18} className="gold" style={{ marginBottom: 6 }} />
      <div className="disp" style={{ fontWeight: 600 }}>{label}</div>
      <div className="faint" style={{ fontSize: ".72rem" }}>{desc}</div>
    </button>
  );
  const submit = () => {
    if (role === "public") return onEnter({ role: "public" });
    if (role === "coach" && !club.trim()) return setErr("Entrez le nom de votre club.");
    const jkey = `${discipline}:${apparatus}`;
    const expected = role === "juge" ? (js ? (config.jsCodes?.[jkey] || config.judgeCodes?.[jkey] || "") : (config.judgeCodes?.[jkey] || "")) : (config.codes[role] || "");
    if (code.trim().toUpperCase() !== expected.toUpperCase()) return setErr("Code incorrect.");
    if (role === "juge") { const pk = `juge:${discipline}:${apparatus}:${js ? "JS" : judge}`; const p = presence?.[pk]; if (p && Date.now() - (p.ts || 0) < 30000) return setErr(js ? "Un Juge Supérieur est déjà connecté sur cet agrès." : `Le poste Juge ${judge} est déjà pris sur cet agrès.`); }
    onEnter({ role, discipline: role === "juge" ? discipline : undefined, judgeType: role === "juge" ? (js ? "js" : "poste") : undefined, judge: role === "juge" ? (js ? "JS" : judge) : undefined, apparatus: role === "juge" ? apparatus : undefined, club: role === "coach" ? club.trim() : undefined });
  };

  return (
    <div className="ff appbg grain" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="w-full max-w-md risein">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={LOGO} alt="Tempogym" className="logospin" style={{ width: 150, marginBottom: 6 }} />
          <h1 className="disp" style={{ fontSize: "1.9rem", fontWeight: 700, lineHeight: 1 }}>CONSOLE DE COMPÉTITION</h1>
          <p className="lbl" style={{ marginTop: 6 }}>Gymnastique Artistique — FfG</p>
        </div>
        <div className="mb-3">
          <div className="lbl mb-1.5" style={{ color: "var(--gold)" }}>● Gestion en direct</div>
          <div className="grid grid-cols-2 gap-2">{liveRoles.map(roleCard)}</div>
        </div>
        <div className="mb-4">
          <div className="lbl mb-1.5">Administration &amp; préparation</div>
          <div className="grid grid-cols-2 gap-2">{adminRoles.map(roleCard)}</div>
        </div>

        {role === "juge" && (
          <div className="space-y-2 mb-2">
            <div className="lbl">Discipline</div>
            <div className="flex gap-1">{DISCS.map((d) => <button key={d} onClick={() => setDiscipline(d)} className={`seg flex-1 ${discipline === d ? "seg-gold" : ""}`}>{d}</button>)}</div>
            <div className="lbl" style={{ marginTop: 6 }}>Votre agrès</div>
            <div className="flex flex-wrap gap-1">{apparatusOf(discipline).map((a) => <button key={a.id} onClick={() => setApparatus(a.id)} className={`seg ${apparatus === a.id ? "seg-gold" : ""}`} style={{ flex: "1 0 30%" }}>{a.label}</button>)}</div>
            <div className="lbl" style={{ marginTop: 6 }}>Votre poste</div>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5, 6].map((j) => <button key={j} onClick={() => { setJudge(j); setJs(false); }} className={`seg ${!js && judge === j ? "seg-gold" : ""}`} style={{ flex: "1 0 12%" }}>{j}</button>)}
              <button onClick={() => setJs(true)} className={`seg ${js ? "seg-gold" : ""}`} style={{ flex: "1 0 20%" }}>JS</button>
            </div>
            {js && <p className="faint" style={{ fontSize: ".7rem" }}>Juge Supérieur — vue globale et validation de l'agrès.</p>}
          </div>
        )}
        {role === "coach" && (
          <div className="mb-2">
            <div className="lbl mb-1">Nom de votre club</div>
            <input value={club} onChange={(e) => { setClub(e.target.value); setErr(""); }} placeholder="ex. Royal Tempogym Jette" className="inp w-full" />
          </div>
        )}
        {role && role !== "public" && (
          <div className="flex items-center gap-2 inp" style={{ padding: "0 .6rem" }}>
            <KeyRound size={16} className="faint" />
            <input value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Code d'accès" style={{ width: "100%", background: "transparent", border: "none", padding: ".6rem 0", color: "var(--silver)", outline: "none" }} />
          </div>
        )}
        {err && <p className="mt-2 text-sm" style={{ color: "var(--late)" }}>{err}</p>}
        {role && <button onClick={submit} className="btn btn-gold w-full mt-4" style={{ justifyContent: "center" }}>{role === "public" ? "Ouvrir l'écran" : "Entrer"}</button>}
        <p className="faint mt-6" style={{ fontSize: ".7rem" }}>By Lucas</p>
      </div>
    </div>
  );
}

/* ------------------------- Rotation banner ------------------------- */
function delayInfo(live, config) {
  const disc = live.discipline || "GAF";
  const r = live.currentRotation || 0;
  const planned = rotTime(config, disc, r);
  const started = live.startedAt?.[r];
  if (!started) return { started: false, planned, text: `prévue à ${toClock(planned)}` };
  const entries = Object.entries(live.startedAt || {}).map(([k, v]) => [Number(k), v]).filter(([, v]) => v).sort((a, b) => a[1] - b[1]);
  const [anchorRot, anchorTs] = entries[0];
  const plannedOffset = planned - rotTime(config, disc, anchorRot);
  const actualOffset = (started - anchorTs) / 60000;
  const delay = actualOffset - plannedOffset;
  return { started: true, planned, delay, text: Math.abs(delay) < 2 ? "à l'heure" : delay > 0 ? `+${Math.round(delay)} min de retard` : `${Math.abs(Math.round(delay))} min d'avance` };
}
const delayColor = (info) => !info.started ? "var(--dim)" : Math.abs(info.delay) < 2 ? "var(--gold)" : info.delay > 0 ? "var(--late)" : "var(--early)";
function RotationBanner({ live, config }) {
  const disc = live.discipline || "GAF"; const r = live.currentRotation || 0; const info = delayInfo(live, config); const aps = apparatusOf(disc);
  return (
    <div style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap text-sm">
        <span className="disp flex items-center gap-2" style={{ fontWeight: 600 }}><span className="livedot" />{disc} · ROTATION {r + 1}/{aps.length}</span>
        <span className="disp" style={{ color: delayColor(info), fontWeight: 600, letterSpacing: ".03em" }}>{info.text}</span>
        <span className="faint" style={{ fontSize: ".78rem" }}>{config.groups.map((g, i) => `${g}→${apparatusForGroup(i, r, disc).label}`).join("   ·   ")}</span>
      </div>
    </div>
  );
}

/* ------------------------- Organiser shell ------------------------- */
function OrganiserApp({ config, roster, scores, live, writeCell, saveConfig, saveLive, addGymnast, removeGymnast, resetScores, resetRoster, presence, deleteCell, resync }) {
  const [tab, setTab] = useState("live");
  const tabs = [
    { id: "live", label: "Live", icon: Play }, { id: "notes", label: "Notes", icon: Gavel },
    { id: "classements", label: "Classements", icon: Trophy }, { id: "roster", label: "Roster", icon: Users },
    { id: "acces", label: "Accès", icon: KeyRound }, { id: "override", label: "Override", icon: ShieldCheck },
    { id: "reglages", label: "Réglages", icon: Settings },
  ];
  return (
    <div>
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`seg flex items-center gap-1.5 ${tab === id ? "seg-on" : ""}`}><Icon size={14} />{label}</button>)}
      </div>
      {tab === "live" && <LiveControl config={config} live={live} saveLive={saveLive} saveConfig={saveConfig} roster={roster} scores={scores} />}
      {tab === "notes" && <JudgeView config={config} roster={roster} scores={scores} writeCell={writeCell} organiser />}
      {tab === "classements" && <RankingsView config={config} roster={roster} scores={scores} />}
      {tab === "roster" && <RosterManager config={config} roster={roster} addGymnast={addGymnast} removeGymnast={removeGymnast} />}
      {tab === "acces" && <AccessView config={config} saveConfig={saveConfig} presence={presence} />}
      {tab === "override" && <OverrideView config={config} roster={roster} scores={scores} writeCell={writeCell} deleteCell={deleteCell} resync={resync} />}
      {tab === "reglages" && <SettingsView config={config} saveConfig={saveConfig} resetScores={resetScores} resetRoster={resetRoster} roster={roster} />}
    </div>
  );
}

/* ------------------------- Live control --------------------------- */
function LiveControl({ config, live, saveLive, saveConfig, roster, scores }) {
  const disc = live.discipline || "GAF"; const aps = apparatusOf(disc); const r = live.currentRotation || 0; const last = aps.length - 1; const info = delayInfo(live, config);
  return (
    <div className="space-y-4 risein">
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="lbl">Plateau en cours</div>
          <div className="flex gap-1">{DISCS.map((d) => <button key={d} onClick={() => saveLive({ discipline: d, currentRotation: 0, startedAt: {} })} className={`seg ${disc === d ? "seg-gold" : ""}`}>{d}</button>)}</div>
        </div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="disp num" style={{ fontSize: "2.6rem", fontWeight: 700, lineHeight: 1 }}>{r + 1}<span className="faint" style={{ fontSize: "1.2rem" }}> / {aps.length}</span></div>
            <div className="disp" style={{ color: delayColor(info), fontWeight: 600, marginTop: 4 }}>{info.text}</div>
          </div>
          <div className="flex flex-col gap-2 items-stretch">
            {!info.started && <button onClick={() => saveLive({ ...live, startedAt: { ...live.startedAt, [r]: Date.now() } })} className="btn btn-gold"><Play size={15} />Démarrer</button>}
            <button onClick={() => r < last && saveLive({ ...live, currentRotation: r + 1 })} disabled={r >= last} className="btn"><ChevronRight size={15} />Rotation suivante</button>
            <div className="flex gap-3 justify-center faint" style={{ fontSize: ".75rem" }}>
              <button onClick={() => r > 0 && saveLive({ ...live, currentRotation: r - 1 })} disabled={r <= 0}>← précédente</button>
              <ConfirmButton onConfirm={() => saveLive({ ...live, currentRotation: 0, startedAt: {} })} className="flex items-center gap-1" confirmLabel="Confirmer ?"><RotateCcw size={11} />reset</ConfirmButton>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {config.groups.map((g, i) => { const comp = groupComp(roster || [], config, g); return (
            <div key={g} className="panel2 p-2">
              <div className="flex items-center justify-between">
                <span className="disp" style={{ fontWeight: 700 }}>Groupe {g}</span>
                <span className="gold disp" style={{ fontWeight: 600, fontSize: ".85rem" }}>{apparatusForGroup(i, r, disc).label}</span>
              </div>
              <TextCommit className="inp" style={{ width: "100%", fontSize: ".72rem", padding: ".25rem .4rem", marginTop: 4 }} placeholder="Nom du groupe (optionnel, ex. Vague 1)" value={config.groupInfo?.[g] || ""} onCommit={(val) => saveConfig({ ...config, groupInfo: { ...(config.groupInfo || {}), [g]: val } })} />
              <div className="faint" style={{ fontSize: ".68rem", marginTop: 4, lineHeight: 1.3 }}>{comp.length ? comp.join(" · ") : "—"}</div>
            </div>
          ); })}
        </div>
      </div>
      <div className="panel p-4">
        <div className="lbl gold mb-1">Annonce speaker (live)</div>
        <TextCommit className="inp w-full" placeholder="Message affiché sur l'écran speaker…" value={config.announcement || ""} onCommit={(val) => saveConfig({ ...config, announcement: val })} />
      </div>
      {(() => {
        let tot = 0, val = 0; (roster || []).forEach((g) => { const d = config.divisions.find((x) => x.id === g.division); if (!d || d.discipline !== disc) return; apparatusOf(d.discipline).forEach((a) => { tot++; if (scores?.[g.id]?.[a.id]?.status === "validated") val++; }); });
        const pct = tot ? Math.round(val / tot * 100) : 0;
        return (
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-2">
              <div><div className="lbl">Avancement · {disc}</div><div className="disp num" style={{ fontSize: "1.4rem", fontWeight: 700 }}>{pct}% <span className="faint" style={{ fontSize: ".9rem", fontWeight: 400 }}>({val}/{tot} notes validées)</span></div></div>
              <label className="lbl flex items-center gap-2" style={{ color: config.frozen ? "var(--gold)" : "var(--dim)" }}><input type="checkbox" checked={!!config.frozen} onChange={(e) => saveConfig({ ...config, frozen: e.target.checked })} />Figer les résultats</label>
            </div>
            <div style={{ height: 8, background: "var(--panel2)", borderRadius: 6, overflow: "hidden" }}><div style={{ width: pct + "%", height: "100%", background: "linear-gradient(90deg,var(--gold),var(--gold-hi))" }} /></div>
            {config.frozen && <p className="faint text-xs mt-2" style={{ color: "var(--gold)" }}>Résultats figés : juges et JS ne peuvent plus modifier. Décochez pour rouvrir.</p>}
          </div>
        );
      })()}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="disp" style={{ fontWeight: 600 }}>PLANNING · {disc}</h3>
          <label className="lbl flex items-center gap-2">Début (auto)<input type="time" value={config.schedule.startTime} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, startTime: e.target.value } })} className="inp" /></label>
        </div>
        <p className="faint text-xs mb-2">Chaque heure ci-dessous est modifiable individuellement ; « Début » ne recalcule que les lignes non modifiées.</p>
        <table className="w-full text-sm">
          <thead><tr className="lbl text-left"><th className="py-1">Heure</th><th>Rot.</th>{config.groups.map((g) => <th key={g}>Gr. {g}</th>)}</tr></thead>
          <tbody>
            {aps.map((_, rot) => (
              <tr key={rot} style={{ borderTop: "1px solid var(--line)", background: rot === r ? "#e2ae4614" : "transparent" }}>
                <td className="py-1.5"><input type="time" value={toClock(rotTime(config, disc, rot))} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, times: { ...(config.schedule.times || {}), [disc]: { ...((config.schedule.times || {})[disc] || {}), [rot]: e.target.value } } } })} className="inp num" style={{ padding: ".2rem .3rem" }} /></td>
                <td className="dim">{rot + 1}</td>
                {config.groups.map((g, i) => <td key={g} className="dim">{apparatusForGroup(i, rot, disc).label}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------ Juge ------------------------------ */
function JudgeView({ config, roster, scores, writeCell, judge, discipline, apparatus, live, organiser }) {
  const locked = !!apparatus;
  const [disc, setDisc] = useState(discipline || "GAF");
  const [ap, setAp] = useState(apparatus || apparatusOf(disc)[0].id);
  const divsOfDisc = config.divisions.filter((d) => d.discipline === disc);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState("");
  const [groupF, setGroupF] = useState("");
  const [q, setQ] = useState("");
  const [jn, setJn] = useState(judge || 1);
  useEffect(() => { const list = config.divisions.filter((d) => d.discipline === disc); if (!list.find((d) => d.id === division)) setDivision(list[0]?.id); if (!locked) setAp(apparatusOf(disc)[0].id); }, [disc]);
  const div = config.divisions.find((d) => d.id === division);
  const maxJudges = div?.judges || 3;
  useEffect(() => { if (jn > maxJudges) setJn(1); }, [maxJudges]);
  const apLabel = apparatusOf(disc).find((a) => a.id === ap)?.label;
  const outOfPanel = !organiser && !!div && jn > div.judges;
  const frozen = !!config.frozen;
  const list = roster.filter((g) => g.division === division && (category === "" || g.category === category) && (groupF === "" || g.group === groupF) && matchG(g, q)).sort(bibSort);
  const seg = (val, set, opts) => <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o.v} onClick={() => set(o.v)} className={`seg ${val === o.v ? "seg-on" : ""}`}>{o.l}</button>)}</div>;

  return (
    <div className="space-y-4 risein">
      {locked && (
        <div className="panel p-4 flex items-center justify-between">
          <div><div className="lbl">Votre poste — {disc}</div><div className="disp gold" style={{ fontSize: "1.8rem", fontWeight: 700, lineHeight: 1 }}>{apLabel}</div></div>
          <div className="text-right"><div className="lbl">Juge</div><div className="disp num" style={{ fontSize: "1.8rem", fontWeight: 700 }}>{jn}</div></div>
        </div>
      )}
      <div className="panel p-4 space-y-3">
        {organiser && <Field label="Discipline">{seg(disc, setDisc, DISCS.map((d) => ({ v: d, l: d })))}</Field>}
        {(organiser || !locked) && <Field label="Agrès">{seg(ap, setAp, apparatusOf(disc).map((a) => ({ v: a.id, l: a.label })))}</Field>}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Division">{seg(division, setDivision, divsOfDisc.map((d) => ({ v: d.id, l: d.label })))}</Field>
          {organiser && <Field label="Juge n°">{seg(jn, setJn, Array.from({ length: maxJudges }, (_, i) => ({ v: i + 1, l: String(i + 1) })))}</Field>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Catégorie">{seg(category, setCategory, [{ v: "", l: "Toutes" }, ...catsFor(config, roster, division).map((c) => ({ v: c, l: c }))])}</Field>
          <Field label="Groupe">
            <div className="flex items-center gap-1 flex-wrap">
              {[{ v: "", l: "Tous" }, ...config.groups.map((x) => ({ v: x, l: x }))].map((o) => <button key={o.v} onClick={() => setGroupF(o.v)} className={`seg ${groupF === o.v ? "seg-on" : ""}`}>{o.l}</button>)}
              {live && (live.discipline === disc) && (() => { let cur = null; config.groups.forEach((gl, i) => { if (apparatusForGroup(i, live.currentRotation || 0, disc).id === ap) cur = gl; }); return cur ? <button onClick={() => setGroupF(cur)} className="seg seg-gold" title="Groupe présent sur votre agrès maintenant">→ en cours ({cur})</button> : null; })()}
            </div>
          </Field>
        </div>
        <Field label="Rechercher (nom ou dossard)"><input className="inp w-full" placeholder="ex. Léa ou 118" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        {frozen && <p style={{ color: "var(--gold)", fontSize: ".78rem", fontWeight: 600 }}>Résultats figés par l'organisateur — saisie fermée.</p>}
        {div && <p className="faint" style={{ fontSize: ".72rem" }}>{div.mode === "DE" ? (jn === 1 ? "Mode D+E — juge 1 : D, votre E, pénalités." : "Mode D+E — votre note E seulement.") : `Mode note unique — note sur ${div.start}${div.bonus ? " + bonus/malus" : ""}.`}</p>}
        {outOfPanel && <p style={{ color: "var(--late)", fontSize: ".78rem", fontWeight: 600 }}>Numéro {jn} hors panel : cette division ne compte que {div.judges} juge(s). Changez de division ou prévenez l'organisateur — la saisie est bloquée.</p>}
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {list.length === 0 && <div className="p-6 text-center faint text-sm">Aucune gymnaste dans ce groupe.</div>}
        {list.map((g) => {
          const cell = scores?.[g.id]?.[ap] || {}; const total = cellTotal(cell, div);
          const locked = cell.status === "submitted" || cell.status === "validated" || outOfPanel || frozen;
          const err = checkCell(cell, div);
          const mine = div && (div.mode === "DE" ? cell.e?.[jn] != null : cell.notes?.[jn] != null);
          return (
            <div key={g.id} className="p-3 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid var(--line)", background: cell.status === "validated" ? "#3fae6a10" : cell.status === "submitted" ? "#6aa2cc14" : "transparent" }}>
              <div className="flex-1 min-w-0"><div className="disp" style={{ fontWeight: 600 }}>{g.dossard ? <span className="gold num" style={{ fontSize: ".8rem", marginRight: 6 }}>#{g.dossard}</span> : null}{g.name} {!mine && !cell.status && <span style={{ color: "var(--draft)", fontSize: ".65rem" }}>● à noter</span>}</div><div className="faint text-xs truncate">{g.club} · {g.category}</div></div>
              <div className="flex items-center gap-2">
                {div && div.mode === "DE" ? (<>
                  {jn === 1 && <NumInput label="D" value={cell.d} onCommit={(v) => writeCell(g.id, ap, { d: v })} w={56} disabled={locked} />}
                  <NumInput label={`E·j${jn}`} value={cell.e?.[jn]} onCommit={(v) => writeCell(g.id, ap, { e: { [jn]: v } })} w={56} disabled={locked} />
                  {jn === 1 && <NumInput label="Pén." value={cell.pen} onCommit={(v) => writeCell(g.id, ap, { pen: v })} w={48} disabled={locked} />}
                </>) : (<>
                  <NumInput label={`Note·j${jn}`} value={cell.notes?.[jn]} onCommit={(v) => writeCell(g.id, ap, { notes: { [jn]: v } })} w={72} disabled={locked} />
                  {jn === 1 && div?.bonus && <NumInput label="Bonus" value={cell.bonus} onCommit={(v) => writeCell(g.id, ap, { bonus: v })} w={52} disabled={locked} />}
                  {jn === 1 && <NumInput label="Pén." value={cell.pen} onCommit={(v) => writeCell(g.id, ap, { pen: v })} w={48} disabled={locked} />}
                </>)}
                <div style={{ width: 62, textAlign: "right" }}><div className="lbl">Total</div><div className="disp num gold" style={{ fontWeight: 700, fontSize: "1.05rem" }}>{fmt(total)}</div></div>
              </div>
              <div className="flex items-center gap-2 justify-end" style={{ flexBasis: "100%" }}>
                {err && jn === 1 && !locked && <span style={{ color: "var(--late)", fontSize: ".72rem" }}>{err}</span>}
                <StatusPill status={cell.status} />
                {jn === 1 && !locked && <button onClick={() => writeCell(g.id, ap, { status: "submitted", submittedAt: Date.now() })} disabled={total == null || !!err} className="btn btn-gold" title={err || ""}><Check size={14} />Soumettre au JS</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function NumInput({ label, value, onCommit, w = 56, disabled }) {
  const [local, setLocal] = useState(value ?? ""); const [saved, setSaved] = useState(false);
  useEffect(() => { setLocal(value ?? ""); }, [value]);
  const commit = () => { if (disabled) return; onCommit(parseNum(local)); setSaved(true); setTimeout(() => setSaved(false), 1200); };
  return (
    <label className="block text-center">
      <span className="lbl flex items-center justify-center gap-0.5">{label}{saved && <Check size={9} className="gold" />}</span>
      <input inputMode="decimal" disabled={disabled} className="inp num text-center" style={{ width: w, padding: ".4rem .3rem", opacity: disabled ? .45 : 1, cursor: disabled ? "not-allowed" : "text" }} value={local} onChange={(e) => setLocal(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} placeholder="—" />
    </label>
  );
}
function TextCommit({ value, onCommit, className = "inp", style = {}, placeholder }) {
  const [v, setV] = useState(value ?? "");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value ?? ""); }, [value]);
  return <input className={className} style={style} placeholder={placeholder} value={v}
    onFocus={() => { focused.current = true; }}
    onChange={(e) => setV(e.target.value)}
    onBlur={() => { focused.current = false; onCommit(v); }}
    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}
function StatusPill({ status }) {
  if (status === "validated") return <span className="disp" style={{ color: "var(--valid)", fontWeight: 600, fontSize: ".8rem" }}>● Validé (live)</span>;
  if (status === "submitted") return <span className="disp" style={{ color: "var(--early)", fontWeight: 600, fontSize: ".8rem" }}>● En attente JS</span>;
  return <span className="disp" style={{ color: "var(--draft)", fontWeight: 600, fontSize: ".8rem" }}>● Brouillon</span>;
}
function checkCell(cell, div) {
  if (!div) return null;
  const max = div.start || 10;
  if (div.mode === "DE") {
    if (cell.d == null) return "Note D manquante";
    if (cell.d < 0) return "D négatif";
    if (Object.values(cell.e || {}).some((v) => v < 0 || v > max)) return `E hors 0–${max}`;
  } else if (Object.values(cell.notes || {}).some((v) => v < 0 || v > max)) return `Note hors 0–${max}`;
  if ((cell.pen || 0) < 0 || (cell.pen || 0) > 5) return "Pénalité suspecte";
  return null;
}

/* -------------------- Juge Supérieur (contrôle agrès) ------------- */
function AgresControlView({ config, roster, scores, writeCell, discipline, apparatus, inquiries, live }) {
  const apLabel = apparatusOf(discipline).find((a) => a.id === apparatus)?.label;
  const divsOfDisc = config.divisions.filter((d) => d.discipline === discipline);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState("");
  const [groupF, setGroupF] = useState("");
  const [q, setQ] = useState("");
  const div = config.divisions.find((d) => d.id === division);
  const list = roster.filter((g) => g.division === division && (category === "" || g.category === category) && (groupF === "" || g.group === groupF) && matchG(g, q));
  const pendingInq = (gid) => (inquiries || []).some((i) => i.status === "pending" && i.gymnastId === gid && i.apparatus === apparatus);
  const seg = (val, set, opts) => <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o.v} onClick={() => set(o.v)} className={`seg ${val === o.v ? "seg-on" : ""}`}>{o.l}</button>)}</div>;
  const rank = { submitted: 0, draft: 1, undefined: 1, validated: 2 };
  const sorted = [...list].sort((a, b) => ((rank[scores?.[a.id]?.[apparatus]?.status] ?? 1) - (rank[scores?.[b.id]?.[apparatus]?.status] ?? 1)) || bibSort(a, b));
  const queueList = list.filter((g) => scores?.[g.id]?.[apparatus]?.status === "submitted");
  const queue = queueList.length;
  const validateAllConform = () => { queueList.forEach((g) => { const c = scores?.[g.id]?.[apparatus] || {}; if (!(div && div.mode === "DE" && c.d == null)) writeCell(g.id, apparatus, { status: "validated", validatedAt: Date.now(), tour: tourFor(config, discipline, g.group, apparatus) }); }); };
  return (
    <div className="space-y-4 risein">
      <div className="panel p-4 flex items-center justify-between flex-wrap gap-2">
        <div><div className="lbl">Juge Supérieur — {discipline}</div><div className="disp gold" style={{ fontSize: "1.8rem", fontWeight: 700, lineHeight: 1 }}>{apLabel}</div></div>
        <div className="flex items-center gap-3">
          <div className="text-right"><div className="lbl">À valider</div><div className="disp num" style={{ fontSize: "1.8rem", fontWeight: 700, color: queue ? "var(--early)" : "var(--dim)" }}>{queue}</div></div>
          {queue > 0 && <button onClick={validateAllConform} className="btn btn-gold"><Check size={14} />Tout valider ({queue})</button>}
        </div>
      </div>
      <div className="panel p-4 grid sm:grid-cols-4 gap-3">
        <Field label="Division">{seg(division, setDivision, divsOfDisc.map((d) => ({ v: d.id, l: d.label })))}</Field>
        <Field label="Catégorie">{seg(category, setCategory, [{ v: "", l: "Toutes" }, ...catsFor(config, roster, division).map((c) => ({ v: c, l: c }))])}</Field>
        <Field label="Groupe">{seg(groupF, setGroupF, [{ v: "", l: "Tous" }, ...config.groups.map((x) => ({ v: x, l: x }))])}</Field>
        <Field label="Rechercher"><input className="inp w-full" placeholder="nom / dossard" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {sorted.length === 0 && <div className="p-6 text-center faint text-sm">Aucune gymnaste.</div>}
        {sorted.map((g) => {
          const cell = scores?.[g.id]?.[apparatus] || {}; const total = cellTotal(cell, div); const st = cell.status;
          const dMissing = div && div.mode === "DE" && cell.d == null;
          return (
            <div key={g.id} className="p-3 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid var(--line)", background: st === "validated" ? "#3fae6a10" : st === "submitted" ? "#6aa2cc14" : "transparent" }}>
              <div className="flex-1 min-w-0">
                <div className="disp" style={{ fontWeight: 600 }}>{g.dossard ? <span className="gold num" style={{ fontSize: ".72rem", marginRight: 5 }}>#{g.dossard}</span> : null}{g.name} {pendingInq(g.id) && <span className="disp" style={{ color: "var(--late)", fontSize: ".72rem" }}>⚑ réclamation</span>}</div>
                <div className="faint text-xs">{g.club} · {g.category}{div && div.mode === "DE" && Object.keys(cell.e || {}).length ? " · E: " + Object.entries(cell.e).map(([j, v]) => `j${j} ${fmt(v)}`).join(" · ") : ""}{div && div.mode === "single" && Object.keys(cell.notes || {}).length ? " · notes: " + Object.entries(cell.notes).map(([j, v]) => `j${j} ${fmt(v)}`).join(" · ") : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                {div && div.mode === "DE"
                  ? <NumInput label="D" value={cell.d} onCommit={(v) => writeCell(g.id, apparatus, { d: v })} w={56} disabled={st === "validated"} />
                  : <NumInput label="Note j1" value={cell.notes?.[1]} onCommit={(v) => writeCell(g.id, apparatus, { notes: { 1: v } })} w={64} disabled={st === "validated"} />}
                <NumInput label="Pén." value={cell.pen} onCommit={(v) => writeCell(g.id, apparatus, { pen: v })} w={48} disabled={st === "validated"} />
                <div style={{ width: 62, textAlign: "right" }}><div className="lbl">Total</div><div className="disp num gold" style={{ fontWeight: 700, fontSize: "1.05rem" }}>{fmt(total)}</div></div>
              </div>
              <div className="flex items-center gap-2 justify-end" style={{ flexBasis: "100%" }}>
                {dMissing && st !== "validated" && <span style={{ color: "var(--late)", fontSize: ".72rem" }}>Note D manquante — saisissez-la avant de valider</span>}
                <StatusPill status={st} />
                {st !== "validated"
                  ? <button onClick={() => writeCell(g.id, apparatus, { status: "validated", validatedAt: Date.now(), tour: tourFor(config, discipline, g.group, apparatus) })} disabled={total == null || dMissing || !!config.frozen} className="btn btn-gold"><Check size={14} />Valider (live)</button>
                  : <button onClick={() => writeCell(g.id, apparatus, { status: "submitted" })} className="btn" style={{ fontSize: ".75rem" }}>Rouvrir</button>}
                {st === "submitted" && <button onClick={() => writeCell(g.id, apparatus, { status: "draft" })} className="btn" style={{ color: "var(--late)", fontSize: ".75rem" }}>Renvoyer au juge</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ Coach ----------------------------- */
function CoachApp({ config, roster, scores, live, club, addGymnast, removeGymnast, editGymnast, inquiries, addInquiry }) {
  const [tab, setTab] = useState("mes");
  const mine = roster.filter((g) => g.club.toLowerCase() === club.toLowerCase());
  const r = live.currentRotation || 0; const liveDisc = live.discipline || "GAF";
  const divOf = (id) => config.divisions.find((d) => d.id === id);
  const rankOf = (g) => { const d = divOf(g.division); if (!d) return null; const t = gymTotal(scores, d, g); if (t <= 0) return null; const peers = roster.filter((x) => x.division === g.division && x.category === g.category).map((x) => ({ g: x, total: gymTotal(scores, d, x) })).filter((x) => x.total > 0).sort(cgSort(scores, d)); const idx = peers.findIndex((x) => x.g.id === g.id); return idx >= 0 ? idx + 1 : null; };
  return (
    <div className="space-y-4 risein">
      <div className="panel p-3 flex items-center justify-between flex-wrap gap-2">
        <div><div className="lbl">Club</div><div className="disp" style={{ fontSize: "1.3rem", fontWeight: 700 }}>{club}</div></div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setTab("mes")} className={`seg ${tab === "mes" ? "seg-on" : ""}`}>Mes gymnastes</button>
          <button onClick={() => setTab("plan")} className={`seg ${tab === "plan" ? "seg-on" : ""}`}>Planning</button>
          <button onClick={() => setTab("res")} className={`seg ${tab === "res" ? "seg-on" : ""}`}>Résultats</button>
          <button onClick={() => setTab("rec")} className={`seg ${tab === "rec" ? "seg-on" : ""}`}>Réclamations</button>
        </div>
      </div>
      {(() => { const soon = mine.filter((g) => { const d = divOf(g.division); const gi = config.groups.indexOf(g.group); return d && d.discipline === liveDisc && gi >= 0 && scores?.[g.id]?.[apparatusForGroup(gi, r, liveDisc).id]?.status !== "validated"; }).map((g) => { const gi = config.groups.indexOf(g.group); return `${g.name} → ${apparatusForGroup(gi, r, liveDisc).label}`; }); return soon.length ? <div className="panel p-3" style={{ borderColor: "var(--gold)", background: "#e2ae4614" }}><span className="lbl gold">Passent maintenant ({liveDisc}, rotation {r + 1})</span><div className="disp" style={{ fontWeight: 600 }}>{soon.slice(0, 6).join("  ·  ")}</div></div> : null; })()}
      {tab === "mes" && <CoachRoster config={config} club={club} mine={mine} addGymnast={addGymnast} removeGymnast={removeGymnast} editGymnast={editGymnast} locked={!!config.rosterLocked} />}
      {tab === "rec" && <ReclamationsSection config={config} scores={scores} mine={mine} club={club} inquiries={inquiries} addInquiry={addInquiry} />}
      {tab === "plan" && <CoachPlanning config={config} mine={mine} />}
      {tab === "res" && (
        <div className="panel" style={{ overflow: "hidden" }}>
          <div className="disp px-4 py-2 flex items-center gap-2" style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)", fontWeight: 600 }}><Eye size={15} className="gold" />Résultats — lecture seule</div>
          <table className="w-full text-sm">
            <thead><tr className="lbl text-left"><th className="px-3 py-2">Gymnaste</th><th>Disc.</th><th>Div/Cat</th><th className="gold">Agrès actuel</th><th className="text-right">Rang</th><th className="text-right px-3">Total</th></tr></thead>
            <tbody>
              {mine.slice().sort(bibSort).map((g) => {
                const div = divOf(g.division); const gi = config.groups.indexOf(g.group);
                const cur = (div?.discipline === liveDisc && gi >= 0) ? apparatusForGroup(gi, r, liveDisc).label : "—";
                const rk = rankOf(g);
                return <tr key={g.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="px-3 py-2 disp" style={{ fontWeight: 600 }}>{g.dossard ? <span className="gold num" style={{ fontSize: ".72rem", marginRight: 5 }}>#{g.dossard}</span> : null}{g.name}</td>
                  <td className="faint text-xs">{div?.discipline}</td>
                  <td className="faint text-xs">{div?.label} · {g.category}</td>
                  <td className="gold text-xs disp">{cur}</td>
                  <td className="text-right num disp" style={{ fontWeight: 700 }}>{rk ? rk + "e" : "—"}</td>
                  <td className="text-right px-3 num disp gold" style={{ fontWeight: 700 }}>{fmt(div ? gymTotal(scores, div, g) : null)}</td>
                </tr>;
              })}
              {mine.length === 0 && <tr><td colSpan={6} className="p-6 text-center faint">Aucune gymnaste inscrite.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function CoachRoster({ config, club, mine, addGymnast, removeGymnast, editGymnast, locked }) {
  const blank = { name: "", division: config.divisions[0].id, category: config.categories[0], team: "", group: config.groups[0], dossard: "" };
  const [g, setG] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [bulk, setBulk] = useState("");
  const divOf = (id) => config.divisions.find((d) => d.id === id);
  const submit = () => { if (!g.name.trim()) return; if (editId) { editGymnast(editId, g); setEditId(null); } else { addGymnast({ ...g, club }); } setG(blank); };
  const startEdit = (x) => { setEditId(x.id); setG({ name: x.name, division: x.division, category: x.category, team: x.team || "", group: x.group, dossard: x.dossard || "" }); };
  const submitBulk = () => { const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean); lines.forEach((line) => { const [name, dossard] = line.split(/[,;\t]/).map((s) => (s || "").trim()); if (name) addGymnast({ name, dossard: dossard || "", division: g.division, category: g.category, team: g.team, group: g.group, club }); }); setBulk(""); };

  if (locked) return (
    <div className="panel p-4">
      <h3 className="disp mb-1" style={{ fontWeight: 600 }}>INSCRIPTIONS VERROUILLÉES</h3>
      <p className="faint text-sm mb-3">L'organisateur a fermé les inscriptions. Contactez-le pour tout ajout, remplacement ou retrait de dernière minute.</p>
      <div>
        {mine.length === 0 && <p className="faint text-sm">Aucune gymnaste.</p>}
        {mine.map((x) => { const d = divOf(x.division); return (
          <div key={x.id} className="flex items-center gap-2 text-sm py-1.5" style={{ borderTop: "1px solid var(--line)" }}>
            {x.dossard && <span className="num gold text-xs" style={{ width: 26 }}>#{x.dossard}</span>}
            <span className="flex-1 disp" style={{ fontWeight: 500 }}>{x.name}</span>
            <span className="faint text-xs">{d?.discipline} {d?.label}</span>
            <span className="dim text-xs">{x.category}</span>
          </div>
        ); })}
      </div>
    </div>
  );

  return (
    <div className="panel p-4">
      <h3 className="disp mb-1" style={{ fontWeight: 600 }}>{editId ? "MODIFIER LA GYMNASTE" : "INSCRIRE UNE GYMNASTE"}</h3>
      <p className="faint text-xs mb-3">Rattachée à <b className="gold">{club}</b>. La discipline suit la division choisie.</p>
      <div className="grid sm:grid-cols-2 gap-2 mb-2">
        <input className="inp" placeholder="Nom" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <input className="inp" placeholder="Équipe (optionnel)" value={g.team} onChange={(e) => setG({ ...g, team: e.target.value })} />
        <Sel value={g.division} onChange={(v) => setG({ ...g, division: v })} opts={config.divisions.map((d) => [d.id, `${d.discipline} · ${d.label}`])} pre="Division" />
        <Sel value={g.category} onChange={(v) => setG({ ...g, category: v })} opts={config.categories.map((c) => [c, c])} pre="Catégorie" />
        <Sel value={g.group} onChange={(v) => setG({ ...g, group: v })} opts={config.groups.map((x) => [x, x])} pre="Groupe" />
        <input className="inp num" placeholder="Dossard" value={g.dossard} onChange={(e) => setG({ ...g, dossard: e.target.value })} />
        <div className="flex gap-2 sm:col-span-2">
          <button onClick={submit} className="btn btn-gold flex-1" style={{ justifyContent: "center" }}><Plus size={15} />{editId ? "Enregistrer" : "Inscrire"}</button>
          {editId && <button onClick={() => { setEditId(null); setG(blank); }} className="btn">Annuler</button>}
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
        <div className="lbl mb-1">Inscription en masse — un par ligne : « Nom, dossard » (dossard optionnel)</div>
        <p className="faint text-xs mb-2">Utilise la division / catégorie / groupe sélectionnés ci-dessus.</p>
        <textarea className="inp w-full" rows={4} placeholder={"Léa Martin, 101\nEmma Dubois, 102\nChloé Renard"} value={bulk} onChange={(e) => setBulk(e.target.value)} style={{ fontFamily: "inherit", resize: "vertical" }} />
        <button onClick={submitBulk} disabled={!bulk.trim()} className="btn btn-gold mt-2" style={{ justifyContent: "center" }}><Plus size={15} />Inscrire la liste</button>
      </div>
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
        {mine.length === 0 && <p className="faint text-sm text-center py-4">Pas encore de gymnaste.</p>}
        {mine.slice().sort(bibSort).map((x) => { const d = divOf(x.division); return (
          <div key={x.id} className="flex items-center gap-2 text-sm py-1.5">
            {x.dossard && <span className="num gold text-xs" style={{ width: 26 }}>#{x.dossard}</span>}
            <span className="flex-1 disp" style={{ fontWeight: 500 }}>{x.name}</span>
            <span className="faint text-xs">{d?.discipline}</span>
            <span className="faint text-xs num">{d?.label}</span>
            <span className="dim text-xs" style={{ width: 84 }}>{x.category}</span>
            <span className="faint text-xs">Gr.{x.group}</span>
            <button onClick={() => startEdit(x)} title="Modifier" style={{ color: "var(--dim)" }}><Pencil size={14} /></button>
            <button onClick={() => removeGymnast(x.id)} style={{ color: "var(--faint)" }}><Trash2 size={15} /></button>
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ------------------------- Planning du club ----------------------- */
function CoachPlanning({ config, mine }) {
  const { startTime, durationMin } = config.schedule;
  return (
    <div className="panel p-4 risein">
      <h3 className="disp mb-1" style={{ fontWeight: 600 }}>PLANNING DU CLUB</h3>
      <p className="faint text-xs mb-3">Heure et agrès de passage par gymnaste, selon son groupe et sa discipline.</p>
      {mine.length === 0 && <p className="faint text-sm text-center py-4">Aucune gymnaste.</p>}
      <div className="space-y-3">
        {mine.map((g) => {
          const d = config.divisions.find((x) => x.id === g.division);
          const gi = config.groups.indexOf(g.group);
          const aps = d ? apparatusOf(d.discipline) : [];
          return (
            <div key={g.id} className="panel2 p-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {g.dossard && <span className="num gold text-xs">#{g.dossard}</span>}
                <span className="disp" style={{ fontWeight: 600 }}>{g.name}</span>
                <span className="faint text-xs">{d?.discipline} {d?.label} · {g.category} · Gr.{g.group}</span>
              </div>
              {(gi < 0 || !d) ? <div className="faint text-xs">Groupe non planifié.</div> : (
                <div className="grid" style={{ gridTemplateColumns: `repeat(${aps.length}, 1fr)`, gap: ".4rem" }}>
                  {aps.map((_, rot) => { const a = apparatusForGroup(gi, rot, d.discipline); const t = toClock(rotTime(config, d.discipline, rot)); return (
                    <div key={rot} className="text-center" style={{ background: "#0e1013", border: "1px solid var(--line)", borderRadius: 8, padding: ".4rem" }}>
                      <div className="num faint" style={{ fontSize: ".7rem" }}>{t}</div>
                      <div className="disp gold" style={{ fontWeight: 600, fontSize: ".85rem" }}>{a.label}</div>
                    </div>
                  ); })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------- Réclamations (coach) ---------------------- */
const MOTIFS = ["Élément non crédité", "Erreur sur note D", "Valeur de départ contestée", "Autre"];
function InquiryFiler({ remaining, onFile }) {
  const [reason, setReason] = useState(MOTIFS[0]);
  return (
    <div className="flex items-center gap-2">
      <select value={reason} onChange={(e) => setReason(e.target.value)} className="inp" style={{ fontSize: ".8rem" }}>{MOTIFS.map((m) => <option key={m} value={m} style={{ background: "#141619" }}>{m}</option>)}</select>
      <button onClick={() => onFile(reason)} className="btn btn-gold"><Flag size={14} />Réclamer · {remaining}s</button>
    </div>
  );
}
function ReclamationsSection({ config, scores, mine, club, inquiries, addInquiry }) {
  const [, setTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(iv); }, []);
  const win = config.inquiryWindowSec ?? 120;
  const divOf = (id) => config.divisions.find((d) => d.id === id);
  const myInq = inquiries.filter((i) => i.club && i.club.toLowerCase() === club.toLowerCase());
  const inqFor = (gid, aid) => myInq.find((i) => i.gymnastId === gid && i.apparatus === aid);
  const rows = [];
  mine.forEach((g) => {
    const div = divOf(g.division);
    if (!div || div.mode !== "DE") return;
    apparatusOf(div.discipline).forEach((a) => {
      const cell = scores?.[g.id]?.[a.id];
      if (!cell || cell.status !== "validated" || cell.d == null) return;
      rows.push({ g, div, a, d: cell.d, tour: cell.tour, remaining: Math.ceil(win - (Date.now() - (cell.validatedAt || cell.ts || 0)) / 1000), inq: inqFor(g.id, a.id) });
    });
  });
  const badge = (s) => s === "accepted" ? { t: "Acceptée", c: "var(--early)" } : s === "rejected" ? { t: "Rejetée", c: "var(--late)" } : { t: "En attente", c: "var(--gold)" };
  return (
    <div className="panel p-4">
      <h3 className="disp mb-1" style={{ fontWeight: 600 }}>RÉCLAMATION SUR NOTE D</h3>
      <p className="faint text-xs mb-3">Uniquement en mode D+E, dans les {win}s suivant l'affichage de la note. La demande alerte aussitôt le superviseur.</p>
      {rows.length === 0 && <p className="faint text-sm text-center py-4">Aucune note D affichée pour vos gymnastes.</p>}
      <div className="space-y-2">
        {rows.map(({ g, div, a, d, tour, remaining, inq }) => (
          <div key={g.id + a.id} className="panel2 p-2 flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="disp" style={{ fontWeight: 600 }}>{g.name}</div>
              <div className="faint text-xs">{div.discipline} · {div.label} · {a.label} — Note D : <span className="gold num">{fmt(d)}</span></div>
            </div>
            {inq ? (
              <span className="disp" style={{ color: badge(inq.status).c, fontWeight: 600 }}>{badge(inq.status).t}{inq.status === "accepted" && inq.newD != null ? ` · D→${fmt(inq.newD)}` : ""}</span>
            ) : remaining > 0 ? (
              <InquiryFiler remaining={remaining} onFile={(reason) => addInquiry({ club, gymnastId: g.id, gymnastName: g.name, apparatus: a.id, apparatusLabel: a.label, divisionId: div.id, divisionLabel: div.label, discipline: div.discipline, dValue: d, tour, reason })} />
            ) : (
              <span className="faint disp">délai dépassé</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------- Superviseur (jury-arbitre) ---------------- */
function SupervisorApp({ config, roster, scores, inquiries, updateInquiry, writeCell }) {
  const [tab, setTab] = useState("rec");
  const [now, setNow] = useState(Date.now());
  const [log, setLog] = useState([]); const [chat, setChat] = useState([]);
  const [incDisc, setIncDisc] = useState("GAF");
  const [msg, setMsg] = useState("");
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv); }, []);
  useEffect(() => { let on = true; const load = async () => { if (!on) return; setLog((await store.get(LOG_KEY)) || []); setChat((await store.get(CHAT_KEY)) || []); }; load(); const iv = setInterval(load, 4000); return () => { on = false; clearInterval(iv); }; }, []);
  const addLog = async (text) => { const l = (await store.get(LOG_KEY)) || []; const n = [{ ts: Date.now(), text }, ...l].slice(0, 100); setLog(n); await store.set(LOG_KEY, n); };
  const addChat = async (text) => { const l = (await store.get(CHAT_KEY)) || []; const n = [...l, { ts: Date.now(), author: "Superviseur", text }].slice(-100); setChat(n); await store.set(CHAT_KEY, n); };

  const pending = inquiries.filter((i) => i.status === "pending");
  const resolved = inquiries.filter((i) => i.status !== "pending");
  const divOf = (id) => config.divisions.find((d) => d.id === id);
  const accept = (inq, newD) => { if (newD != null) writeCell(inq.gymnastId, inq.apparatus, { d: newD }); updateInquiry(inq.id, { status: "accepted", newD: newD ?? null, decidedAt: Date.now() }); addLog(`Réclamation acceptée · ${inq.gymnastName} · ${inq.apparatusLabel}${newD != null ? ` · D→${fmt(newD)}` : ""}`); };
  const reject = (inq) => { updateInquiry(inq.id, { status: "rejected", decidedAt: Date.now() }); addLog(`Réclamation rejetée · ${inq.gymnastName} · ${inq.apparatusLabel}`); };

  const validatedCells = [];
  roster.forEach((g) => { const d = divOf(g.division); if (!d || d.discipline !== incDisc) return; apparatusOf(d.discipline).forEach((a) => { const cell = scores?.[g.id]?.[a.id]; if (cell?.status === "validated") validatedCells.push({ g, d, a, total: cellTotal(cell, d) }); }); });
  const unlock = (g, d, a) => { writeCell(g.id, a.id, { status: "draft" }); addLog(`Déverrouillage · ${g.name} · ${d.discipline} ${d.label} · ${a.label}`); };
  const hhmm = (ts) => new Date(ts).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-4 risein">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab("rec")} className={`seg ${tab === "rec" ? "seg-gold" : ""}`}>Réclamations{pending.length > 0 ? ` (${pending.length})` : ""}</button>
          <button onClick={() => setTab("inc")} className={`seg ${tab === "inc" ? "seg-gold" : ""}`}>Incidents</button>
          <button onClick={() => setTab("comms")} className={`seg ${tab === "comms" ? "seg-gold" : ""}`}>Comms</button>
        </div>
        <div style={{ position: "relative" }}><Bell size={20} className="gold" />{pending.length > 0 && <span className="livedot" style={{ position: "absolute", top: -2, right: -2 }} />}</div>
      </div>

      {tab === "rec" && (
        <div className="space-y-3">
          <div className="panel" style={{ overflow: "hidden" }}>
            <div className="disp px-4 py-2" style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>À TRAITER</div>
            {pending.length === 0 && <p className="faint text-sm text-center py-6">Rien à traiter.</p>}
            {pending.map((i) => <InquiryCard key={i.id} inq={i} div={divOf(i.divisionId)} scores={scores} now={now} onAccept={(d) => accept(i, d)} onReject={() => reject(i)} />)}
          </div>
          {resolved.length > 0 && (
            <div className="panel" style={{ overflow: "hidden" }}>
              <div className="disp px-4 py-2 faint" style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>TRAITÉES</div>
              {resolved.map((i) => (
                <div key={i.id} className="px-4 py-2 flex items-center gap-3 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                  <span className="flex-1 disp">{i.gymnastName} · {i.discipline} {i.divisionLabel} · {i.apparatusLabel}</span>
                  <span className="disp" style={{ color: i.status === "accepted" ? "var(--valid)" : "var(--late)", fontWeight: 600 }}>{i.status === "accepted" ? `Acceptée${i.newD != null ? ` · D→${fmt(i.newD)}` : ""}` : "Rejetée"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "inc" && (
        <div className="space-y-3">
          <div className="panel p-4">
            <div className="lbl mb-2">Déverrouillage d'urgence — notes validées</div>
            <div className="flex gap-1 mb-3">{DISCS.map((d) => <button key={d} onClick={() => setIncDisc(d)} className={`seg ${incDisc === d ? "seg-gold" : ""}`}>{d}</button>)}</div>
            {validatedCells.length === 0 && <p className="faint text-sm text-center py-3">Aucune note validée pour l'instant.</p>}
            {validatedCells.map(({ g, d, a, total }) => (
              <div key={g.id + a.id} className="flex items-center gap-3 py-2 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                <span className="flex-1 disp" style={{ fontWeight: 600 }}>{g.name} <span className="faint" style={{ fontWeight: 400 }}>· {d.discipline} {d.label} · {a.label}</span></span>
                <span className="num gold">{fmt(total)}</span>
                <button onClick={() => unlock(g, d, a)} className="btn" style={{ color: "var(--late)", fontSize: ".75rem" }}>Déverrouiller</button>
              </div>
            ))}
          </div>
          <div className="panel p-4">
            <div className="lbl mb-2">Journal des interventions</div>
            {log.length === 0 && <p className="faint text-sm">Aucune intervention enregistrée.</p>}
            {log.slice(0, 15).map((e, i) => <div key={i} className="text-xs py-1 flex gap-2" style={{ borderTop: i ? "1px solid var(--line)" : "none" }}><span className="faint num">{hhmm(e.ts)}</span><span className="dim">{e.text}</span></div>)}
          </div>
        </div>
      )}

      {tab === "comms" && (
        <div className="panel p-4">
          <div className="lbl mb-2">Fil interne (Superviseur · JS · Orga)</div>
          <div className="space-y-1 mb-3" style={{ maxHeight: 320, overflow: "auto" }}>
            {chat.length === 0 && <p className="faint text-sm text-center py-3">Aucun message.</p>}
            {chat.map((m, i) => <div key={i} className="panel2 p-2 text-sm"><span className="gold disp" style={{ fontWeight: 600 }}>{m.author}</span> <span className="faint num text-xs">{hhmm(m.ts)}</span><div className="dim">{m.text}</div></div>)}
          </div>
          <div className="flex gap-2">
            <input className="inp flex-1" placeholder="Message rapide…" value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && msg.trim()) { addChat(msg.trim()); setMsg(""); } }} />
            <button onClick={() => { if (msg.trim()) { addChat(msg.trim()); setMsg(""); } }} className="btn btn-gold">Envoyer</button>
          </div>
        </div>
      )}
    </div>
  );
}
function InquiryCard({ inq, div, scores, now, onAccept, onReject }) {
  const [newD, setNewD] = useState("");
  const cell = scores?.[inq.gymnastId]?.[inq.apparatus] || {};
  const d = cell.d, e = combine(Object.values(cell.e || {}), div?.combine), pen = cell.pen || 0, total = cellTotal(cell, div);
  const elapsed = Math.max(0, Math.floor((now - (inq.filedAt || now)) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0"), ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="px-4 py-3" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="disp" style={{ fontWeight: 600, fontSize: "1.1rem" }}>{inq.gymnastName} <span className="faint" style={{ fontWeight: 400, fontSize: ".85rem" }}>· {inq.club} · {inq.discipline} {inq.divisionLabel} · {inq.apparatusLabel}{inq.tour ? ` · Tour ${inq.tour}` : ""}</span></div>
          <div className="faint text-xs" style={{ marginTop: 2 }}>Motif : <span className="dim">{inq.reason || "—"}</span></div>
          <div className="flex gap-3 mt-1 num" style={{ fontSize: ".85rem" }}>
            <span className="faint">D <span className="gold">{fmt(d)}</span></span>
            <span className="faint">E <span className="dim">{fmt(e)}</span></span>
            <span className="faint">Pén <span className="dim">{fmt(pen)}</span></span>
            <span className="faint">Total <span className="gold">{fmt(total)}</span></span>
          </div>
        </div>
        <div className="text-right"><div className="lbl">Déposée</div><div className="disp num" style={{ fontWeight: 600 }}>{mm}:{ss}</div></div>
      </div>
      <div className="flex items-center gap-2 mt-3 justify-end flex-wrap">
        <input inputMode="decimal" className="inp num text-center" style={{ width: 84 }} placeholder="Nouv. D" value={newD} onChange={(e2) => setNewD(e2.target.value)} />
        <button onClick={() => onReject()} className="btn" style={{ color: "var(--late)" }}>Rejeter</button>
        <button onClick={() => onAccept(parseNum(newD))} className="btn btn-gold"><Check size={14} />Accepter{newD ? " · corriger D" : ""}</button>
      </div>
    </div>
  );
}

/* ------------------------------ Speaker --------------------------- */
function SpeakerApp({ config, roster, scores, live }) {
  const [discipline, setDiscipline] = useState(live.discipline || "GAF");
  const [apFilter, setApFilter] = useState("");
  const [tab, setTab] = useState("live");
  const [big, setBig] = useState(true);
  const [seen, setSeen] = useState(() => new Set());
  const divsOfDisc = config.divisions.filter((d) => d.discipline === discipline);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState(config.categories[0]);
  useEffect(() => { const list = config.divisions.filter((d) => d.discipline === discipline); if (!list.find((d) => d.id === division)) setDivision(list[0]?.id); setApFilter(""); }, [discipline]);
  useEffect(() => { const cs = catsFor(config, roster, division); if (division && !cs.includes(category)) setCategory(cs[0]); }, [division, roster]);
  const div = config.divisions.find((d) => d.id === division);
  const aps = apparatusOf(discipline);
  const seg = (val, set, opts) => <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o.v} onClick={() => set(o.v)} className={`seg ${val === o.v ? "seg-on" : ""}`}>{o.l}</button>)}</div>;

  const feed = [];
  roster.forEach((g) => {
    const d = config.divisions.find((x) => x.id === g.division);
    if (!d || d.discipline !== discipline) return;
    aps.forEach((a) => {
      if (apFilter && a.id !== apFilter) return;
      const cell = scores?.[g.id]?.[a.id]; const t = validatedTotal(cell, d);
      if (t != null) feed.push({ key: g.id + a.id + (cell.validatedAt || 0), g, d, a, t, tour: cell.tour, ts: cell.validatedAt || cell.ts });
    });
  });
  feed.sort((x, y) => y.ts - x.ts);
  const hero = feed[0]; const rest = feed.slice(1, 12);
  const liveDisc = live.discipline || "GAF"; const rot = live.currentRotation || 0;

  const rows = div ? roster.filter((g) => g.division === division && g.category === category).map((g) => ({ g, total: gymTotal(scores, div, g) })).filter((x) => x.total > 0).sort(cgSort(scores, div)) : [];
  const teams = {}; if (div) roster.filter((g) => g.division === division && g.category === category && g.team).forEach((g) => (teams[g.team] ||= []).push(g));
  const teamRows = div ? Object.entries(teams).map(([team, m2]) => { let total = 0; apparatusOf(div.discipline).forEach((a) => { const vs = m2.map((m) => validatedTotal(scores?.[m.id]?.[a.id], div)).filter((v) => v != null).sort((x, y) => y - x); total += vs.slice(0, config.teamBestN).reduce((s, v) => s + v, 0); }); return { team, total: round2(total) }; }).filter((x) => x.total > 0).sort((a, b) => (b.total - a.total) || a.team.localeCompare(b.team)) : [];
  const medal = (i) => (i === 0 ? "var(--gold)" : i === 1 ? "#c3c9d2" : i === 2 ? "#b3763e" : "var(--dim)");
  const markSeen = (k) => setSeen((s) => new Set(s).add(k));
  const heroSize = big ? "3.2rem" : "2rem"; const noteSize = big ? "2.6rem" : "1.6rem";
  const rowName = big ? "1.5rem" : "1.1rem"; const rowNote = big ? "1.8rem" : "1.3rem";

  return (
    <div className="space-y-4 risein" style={{ margin: "-1rem", padding: "1rem", minHeight: "82vh" }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1">
          <button onClick={() => setTab("live")} className={`seg ${tab === "live" ? "seg-gold" : ""}`}>Live</button>
          <button onClick={() => setTab("podiums")} className={`seg ${tab === "podiums" ? "seg-gold" : ""}`}>Podiums</button>
        </div>
        <div className="flex items-center gap-2">
          {DISCS.map((d) => <button key={d} onClick={() => setDiscipline(d)} className={`seg ${discipline === d ? "seg-on" : ""}`}>{d}</button>)}
          <button onClick={() => setBig((b) => !b)} className={`seg ${big ? "seg-gold" : ""}`}>A+ Gros</button>
        </div>
      </div>

      {config.announcement ? <div className="panel p-3" style={{ borderColor: "var(--gold)", background: "#e2ae4614" }}><span className="lbl gold">Annonce</span><div className="disp" style={{ fontSize: big ? "1.4rem" : "1.05rem", fontWeight: 600 }}>{config.announcement}</div></div> : null}

      {tab === "live" && (<>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setApFilter("")} className={`seg ${apFilter === "" ? "seg-gold" : ""}`}>Tous agrès</button>
          {aps.map((a) => <button key={a.id} onClick={() => setApFilter(a.id)} className={`seg ${apFilter === a.id ? "seg-gold" : ""}`}>{a.label}</button>)}
        </div>

        {hero ? (
          <div className="panel p-4" style={{ borderColor: "var(--gold)" }}>
            <div className="lbl gold flex items-center gap-2"><span className="livedot" />Dernière note validée</div>
            <div className="disp" style={{ fontSize: heroSize, fontWeight: 700, lineHeight: 1.05 }}>{hero.g.name}</div>
            <div className="dim disp" style={{ fontSize: big ? "1.2rem" : ".95rem" }}>{hero.g.club} · {hero.g.category} — {hero.d.discipline} {hero.d.label} · {hero.a.label}{hero.tour ? ` · Tour ${hero.tour}` : ""}</div>
            <div className="disp num gold" style={{ fontSize: noteSize, fontWeight: 700 }}>{fmt3(hero.t)}</div>
          </div>
        ) : <div className="panel p-6 text-center faint disp">En attente d'une note validée…</div>}

        <div className="panel" style={{ overflow: "hidden" }}>
          <div className="disp px-4 py-2" style={{ background: "var(--panel2)", borderBottom: "1px solid var(--line)", fontWeight: 600 }}>Fil des passages</div>
          {rest.length === 0 && <p className="faint text-sm text-center py-5">—</p>}
          {rest.map((x) => {
            const fresh = !seen.has(x.key);
            return (
              <div key={x.key} className="px-4 py-2.5 flex items-center gap-3" style={{ borderTop: "1px solid var(--line)", background: fresh ? "#e2ae461f" : "transparent" }}>
                <div className="flex-1 min-w-0">
                  <div className="disp" style={{ fontWeight: 600, fontSize: rowName }}>{x.g.name} <span className="faint" style={{ fontSize: ".8rem", fontWeight: 400 }}>· {x.g.club} · {x.g.category}</span></div>
                  <div className="faint text-xs">{x.d.discipline} {x.d.label} · {x.a.label}{x.tour ? ` · Tour ${x.tour}` : ""}</div>
                </div>
                <div className="disp num gold" style={{ fontSize: rowNote, fontWeight: 700 }}>{fmt3(x.t)}</div>
                {fresh ? <button onClick={() => markSeen(x.key)} className="btn btn-gold" style={{ fontSize: ".72rem" }}>Annoncé</button> : <span className="faint lbl">lu</span>}
              </div>
            );
          })}
        </div>

        <div className="panel p-4">
          <div className="lbl mb-2">Qui passe maintenant · {liveDisc} (rotation {rot + 1})</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {config.groups.map((g, i) => <div key={g} className="panel2 p-2 text-center"><div className="lbl">Groupe {g}</div><div className="gold disp" style={{ fontWeight: 700, fontSize: "1.1rem" }}>{apparatusForGroup(i, rot, liveDisc).label}</div></div>)}
          </div>
        </div>
      </>)}

      {tab === "podiums" && (
        <div className="space-y-3">
          <div className="panel p-4 grid sm:grid-cols-2 gap-3">
            <Field label="Division">{seg(division, setDivision, divsOfDisc.map((d) => ({ v: d.id, l: d.label })))}</Field>
            <Field label="Catégorie">{seg(category, setCategory, catsFor(config, roster, division).map((c) => ({ v: c, l: c })))}</Field>
          </div>
          <div className="panel p-4">
            <div className="lbl gold mb-2">Podium individuel — {discipline} {div?.label} · {category}</div>
            {rows.slice(0, 3).length === 0 && <p className="faint text-sm">Pas encore de classement.</p>}
            {rows.slice(0, 3).map((x, i) => (
              <div key={x.g.id} className="flex items-center gap-3 py-2" style={{ borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div className="disp num" style={{ width: 36, textAlign: "center", fontWeight: 700, fontSize: "1.6rem", color: medal(i) }}>{i + 1}</div>
                <div className="flex-1 disp" style={{ fontWeight: 600, fontSize: big ? "1.4rem" : "1.1rem" }}>{x.g.name} <span className="faint" style={{ fontSize: ".85rem", fontWeight: 400 }}>· {x.g.club}</span></div>
                <div className="disp num" style={{ fontWeight: 700, fontSize: big ? "1.6rem" : "1.2rem" }}>{fmt3(x.total)}</div>
              </div>
            ))}
          </div>
          {teamRows.length > 0 && (
            <div className="panel p-4">
              <div className="lbl gold mb-2">Podium équipes</div>
              {teamRows.slice(0, 3).map((x, i) => (
                <div key={x.team} className="flex items-center gap-3 py-2" style={{ borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <div className="disp num" style={{ width: 36, textAlign: "center", fontWeight: 700, fontSize: "1.6rem", color: medal(i) }}>{i + 1}</div>
                  <div className="flex-1 disp" style={{ fontWeight: 600, fontSize: big ? "1.4rem" : "1.1rem" }}>{x.team}</div>
                  <div className="disp num" style={{ fontWeight: 700, fontSize: big ? "1.6rem" : "1.2rem" }}>{fmt3(x.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Public screen ------------------------ */
function PublicApp({ config, roster, scores, live }) {
  const [mode, setMode] = useState("arena");
  return (
    <div className="risein" style={{ margin: "-1rem", minHeight: "84vh", padding: "1rem" }}>
      <div className="flex justify-end mb-2">
        <div className="flex gap-1">
          <button onClick={() => setMode("arena")} className={`seg ${mode === "arena" ? "seg-gold" : ""}`}>Arena</button>
          <button onClick={() => setMode("classements")} className={`seg ${mode === "classements" ? "seg-gold" : ""}`}>Classements</button>
        </div>
      </div>
      {mode === "arena" ? <ArenaScreen config={config} roster={roster} scores={scores} live={live} /> : <PublicRankings config={config} roster={roster} scores={scores} live={live} />}
    </div>
  );
}

function ArenaScreen({ config, roster, scores, live }) {
  const disc = live.discipline || "GAF"; const rot = live.currentRotation || 0; const aps = apparatusOf(disc);
  const feed = [];
  roster.forEach((g) => { const d = config.divisions.find((x) => x.id === g.division); if (!d || d.discipline !== disc) return; aps.forEach((a) => { const cell = scores?.[g.id]?.[a.id]; const t = validatedTotal(cell, d); if (t != null) feed.push({ g, d, a, t, tour: cell.tour, ts: cell.validatedAt || cell.ts }); }); });
  feed.sort((x, y) => y.ts - x.ts);
  const hero = feed[0];
  const [flash, setFlash] = useState(false); const prev = useRef(null);
  useEffect(() => { const k = hero ? hero.g.id + hero.a.id + hero.ts : null; if (k && k !== prev.current) { prev.current = k; setFlash(true); const t = setTimeout(() => setFlash(false), 900); return () => clearTimeout(t); } }, [hero]);
  const perAgres = aps.map((a) => {
    let groupLetter = null; config.groups.forEach((gl, i) => { if (apparatusForGroup(i, rot, disc).id === a.id) groupLetter = gl; });
    const last = feed.find((f) => f.a.id === a.id);
    const label = groupLetter ? (config.groupInfo?.[groupLetter] || "") : "";
    const comp = groupLetter ? groupComp(roster, config, groupLetter).filter((c) => c.startsWith(disc)) : [];
    const queue = roster.filter((g) => { const d = config.divisions.find((x) => x.id === g.division); return d && d.discipline === disc && g.group === groupLetter && scores?.[g.id]?.[a.id]?.status !== "validated"; }).slice(0, 3);
    return { a, groupLetter, label, comp, last, queue };
  });
  const publicUrl = config.publicUrl || "https://tempogymjette.be/live";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem" }}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <img src={LOGO} style={{ height: 52 }} className="logospin" alt="" />
          <div className="flex items-center gap-2"><span className="livedot" /><span className="lbl gold">En direct · {disc} · Rotation {rot + 1}/{aps.length}</span></div>
        </div>
        <div className={`panel p-5 ${flash ? "flash" : ""}`} style={{ borderColor: "var(--gold)" }}>
          {hero ? (<>
            <div className="lbl gold">Dernière note validée</div>
            <div className="disp" style={{ fontSize: "3.4rem", fontWeight: 700, lineHeight: 1 }}>{hero.g.name}</div>
            <div className="dim disp" style={{ fontSize: "1.3rem" }}>{hero.g.club} · {hero.g.category} — {hero.a.label}{hero.tour ? ` · Tour ${hero.tour}` : ""}</div>
            <div className="disp num gold" style={{ fontSize: "4rem", fontWeight: 700, lineHeight: 1.1 }}>{fmt3(hero.t)}</div>
          </>) : <div className="faint disp" style={{ fontSize: "1.4rem", padding: "2rem 0", textAlign: "center" }}>En attente d'une note validée…</div>}
        </div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${aps.length}, 1fr)`, gap: ".5rem" }}>
          {perAgres.map(({ a, groupLetter, label, comp, last }) => (
            <div key={a.id} className="panel2 p-2" style={{ overflow: "hidden" }}>
              <div className="disp gold" style={{ fontWeight: 700, fontSize: ".95rem" }}>{a.label}</div>
              <div className="lbl" style={{ marginTop: 1 }}>{groupLetter ? `Groupe ${groupLetter}` : "—"}{label ? ` · ${label}` : ""}</div>
              {comp.length ? <div className="faint" style={{ fontSize: ".6rem", lineHeight: 1.2, marginBottom: 3 }}>{comp.join(" · ")}</div> : null}
              {last ? <><div className="disp" style={{ fontWeight: 600, fontSize: ".88rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{last.g.name}</div><div className="num gold disp" style={{ fontWeight: 700 }}>{fmt3(last.t)}</div></> : <div className="faint text-xs">en attente</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="panel p-3">
          <div className="lbl gold mb-2">Prochains passages</div>
          {perAgres.map(({ a, groupLetter, queue }) => (
            <div key={a.id} style={{ marginBottom: ".6rem" }}>
              <div className="lbl">{a.label}{groupLetter ? ` · Groupe ${groupLetter}` : ""}</div>
              {queue.length ? queue.map((g) => <div key={g.id} className="text-sm disp" style={{ fontWeight: 500 }}>{g.name} <span className="faint" style={{ fontWeight: 400, fontSize: ".78rem" }}>· {g.club}</span></div>) : <div className="faint text-xs">—</div>}
            </div>
          ))}
        </div>
        <QRBox url={publicUrl} />
      </div>
    </div>
  );
}

function QRBox({ url }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="panel p-3 text-center">
      <div className="lbl gold mb-2">Suivez le classement</div>
      <div style={{ background: "#fff", borderRadius: 10, padding: 8, display: "inline-block" }}>
        {ok ? <img alt="QR" width={150} height={150} src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=${encodeURIComponent(url)}`} onError={() => setOk(false)} /> : <div style={{ width: 150, height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: "#111", fontSize: 11, padding: 8, textAlign: "center" }}>QR généré en prod ({url})</div>}
      </div>
      <div className="faint text-xs mt-2">Flashez pour suivre sur votre mobile</div>
    </div>
  );
}

function PublicRankings({ config, roster, scores, live }) {
  const [discipline, setDiscipline] = useState(live.discipline || "GAF");
  const divsOfDisc = config.divisions.filter((d) => d.discipline === discipline);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState(config.categories[0]);
  const [selId, setSelId] = useState(null);
  const [q, setQ] = useState("");
  useEffect(() => { const list = config.divisions.filter((d) => d.discipline === discipline); if (!list.find((d) => d.id === division)) setDivision(list[0]?.id); setSelId(null); }, [discipline]);
  useEffect(() => { const cs = catsFor(config, roster, division); if (division && !cs.includes(category)) setCategory(cs[0]); }, [division, roster]);
  const div = config.divisions.find((d) => d.id === division);
  const rows = div ? roster.filter((g) => g.division === division && g.category === category).map((g) => ({ g, total: gymTotal(scores, div, g) })).sort(cgSort(scores, div)) : [];
  const sel = selId ? roster.find((g) => g.id === selId) : null;
  const medal = (i) => (i === 0 ? "var(--gold)" : i === 1 ? "#c3c9d2" : i === 2 ? "#b3763e" : "var(--faint)");
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <img src={LOGO} style={{ height: 42 }} className="logospin" alt="" />
        <div className="disp" style={{ fontSize: "1.4rem", fontWeight: 700 }}>Live scoring</div>
      </div>
      <div className="flex flex-wrap gap-1">{DISCS.map((d) => <button key={d} onClick={() => setDiscipline(d)} className={`seg ${discipline === d ? "seg-gold" : ""}`}>{d}</button>)}</div>
      <div className="flex flex-wrap gap-1">
        {divsOfDisc.map((d) => <button key={d.id} onClick={() => { setDivision(d.id); setSelId(null); }} className={`seg ${division === d.id ? "seg-on" : ""}`}>{d.label}</button>)}
        <span style={{ width: 1, background: "var(--line)", margin: "0 6px" }} />
        {catsFor(config, roster, division).map((c) => <button key={c} onClick={() => { setCategory(c); setSelId(null); }} className={`seg ${category === c ? "seg-on" : ""}`}>{c}</button>)}
      </div>
      {!sel && <input className="inp w-full" placeholder="Rechercher un nom ou un dossard…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {sel ? (
        <div className="panel p-4">
          <button onClick={() => setSelId(null)} className="btn mb-3" style={{ fontSize: ".75rem" }}>← Retour au classement</button>
          <div className="disp" style={{ fontSize: "1.4rem", fontWeight: 700 }}>{sel.name}</div>
          <div className="faint text-sm mb-3">{sel.club} · {div?.discipline} {div?.label} · {sel.category}</div>
          {apparatusOf(div.discipline).map((a) => { const cell = scores?.[sel.id]?.[a.id]; const t = validatedTotal(cell, div); return (
            <div key={a.id} className="flex items-center justify-between py-2" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="disp">{a.label}</span>
              <span className="num gold disp" style={{ fontWeight: 700 }}>{t != null ? fmt3(t) : (cell?.status ? "en cours" : "—")}</span>
            </div>
          ); })}
          <div className="flex items-center justify-between py-2" style={{ borderTop: "1px solid var(--gold)", marginTop: 4 }}>
            <span className="disp gold" style={{ fontWeight: 700 }}>Concours général</span>
            <span className="num gold disp" style={{ fontWeight: 700, fontSize: "1.3rem" }}>{fmt3(gymTotal(scores, div, sel))}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.filter((x) => x.total > 0).length === 0 && <div className="faint py-10 text-center disp">En attente des premières notes…</div>}
          {rows.filter((x) => x.total > 0).map((x, i) => ({ x, i })).filter(({ x }) => matchG(x.g, q)).map(({ x, i }) => (
            <button key={x.g.id} onClick={() => setSelId(x.g.id)} className="panel2 flex items-center gap-3 w-full text-left" style={{ padding: ".7rem 1rem", borderLeft: `3px solid ${medal(i)}` }}>
              <div className="disp num" style={{ fontSize: "1.5rem", fontWeight: 700, width: 36, textAlign: "center", color: medal(i) }}>{i + 1}</div>
              <div className="flex-1"><div className="disp" style={{ fontWeight: 600 }}>{x.g.dossard ? <span className="gold num" style={{ fontSize: ".7rem", marginRight: 5 }}>#{x.g.dossard}</span> : null}{x.g.name}</div><div className="faint text-xs">{x.g.club}</div></div>
              <div className="disp num" style={{ fontWeight: 700, fontSize: "1.3rem" }}>{fmt3(x.total)}</div>
            </button>
          ))}
        </div>
      )}
      <p className="faint text-center text-xs">Mise à jour automatique · touchez un nom pour le détail.</p>
    </div>
  );
}

/* ---------------------------- Classements ------------------------- */
function RankingsView({ config, roster, scores }) {
  const [view, setView] = useState("agres");
  const [discipline, setDiscipline] = useState("GAF");
  const divsOfDisc = config.divisions.filter((d) => d.discipline === discipline);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState(config.categories[0]);
  const [ap, setAp] = useState(apparatusOf(discipline)[0].id);
  useEffect(() => { const list = config.divisions.filter((d) => d.discipline === discipline); if (!list.find((d) => d.id === division)) setDivision(list[0]?.id); if (!apparatusOf(discipline).find((a) => a.id === ap)) setAp(apparatusOf(discipline)[0].id); }, [discipline]);
  const div = config.divisions.find((d) => d.id === division);
  const aps = apparatusOf(discipline);
  useEffect(() => { const cs = catsFor(config, roster, division); if (division && !cs.includes(category)) setCategory(cs[0]); }, [division, roster]);
  const group = roster.filter((g) => g.division === division && g.category === category);
  const seg = (val, set, opts) => <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o.v} onClick={() => set(o.v)} className={`seg ${val === o.v ? "seg-on" : ""}`}>{o.l}</button>)}</div>;
  const medal = (i) => (i === 0 ? "var(--gold)" : i === 1 ? "#c3c9d2" : i === 2 ? "#b3763e" : "var(--dim)");
  const byAp = div ? group.map((g) => ({ g, s: validatedTotal(scores?.[g.id]?.[ap], div) })).filter((x) => x.s != null).sort((a, b) => (b.s - a.s) || a.g.name.localeCompare(b.g.name)) : [];
  const cg = div ? group.map((g) => ({ g, per: aps.map((a) => validatedTotal(scores?.[g.id]?.[a.id], div)), total: gymTotal(scores, div, g) })).filter((x) => x.per.some((v) => v != null)).sort(cgSort(scores, div)) : [];
  const teams = {}; group.forEach((g) => { if (g.team) (teams[g.team] ||= []).push(g); });
  const teamRows = div ? Object.entries(teams).map(([team, m2]) => { let total = 0; aps.forEach((a) => { const vs = m2.map((m) => validatedTotal(scores?.[m.id]?.[a.id], div)).filter((v) => v != null).sort((x, y) => y - x); total += vs.slice(0, config.teamBestN).reduce((s, v) => s + v, 0); }); return { team, total: round2(total), n: m2.length }; }).sort((a, b) => (b.total - a.total) || a.team.localeCompare(b.team)) : [];
  const [showCsv, setShowCsv] = useState(false);
  const csv = (() => { const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`; let R = []; if (view === "cg") { R.push(["Rang", "Gymnaste", "Club", ...aps.map((a) => a.label), "Total"]); cg.forEach((x, i) => R.push([i + 1, x.g.name, x.g.club, ...x.per.map((p) => fmt(p)), fmt(x.total)])); } else if (view === "agres") { R.push(["Rang", "Gymnaste", "Club", aps.find((a) => a.id === ap)?.label || ""]); byAp.forEach((x, i) => R.push([i + 1, x.g.name, x.g.club, fmt(x.s)])); } else { R.push(["Rang", "Équipe", "Gymnastes", "Total"]); teamRows.forEach((x, i) => R.push([i + 1, x.team, x.n, fmt(x.total)])); } return R.map((r) => r.map(esc).join(",")).join("\n"); })();

  return (
    <div className="space-y-4 risein">
      <div className="panel p-4 space-y-3">
        <Field label="Discipline">{seg(discipline, setDiscipline, DISCS.map((d) => ({ v: d, l: d })))}</Field>
        <Field label="Vue">{seg(view, setView, [{ v: "agres", l: "Par agrès" }, { v: "cg", l: "Concours général" }, { v: "equipes", l: "Équipes" }])}</Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Division">{seg(division, setDivision, divsOfDisc.map((d) => ({ v: d.id, l: d.label })))}</Field>
          <Field label="Catégorie">{seg(category, setCategory, catsFor(config, roster, division).map((c) => ({ v: c, l: c })))}</Field>
        </div>
        {view === "agres" && <Field label="Agrès">{seg(ap, setAp, aps.map((a) => ({ v: a.id, l: a.label })))}</Field>}
        <div className="flex gap-2 pt-1">
          <button onClick={() => setShowCsv((v) => !v)} className="btn" style={{ fontSize: ".78rem" }}>Exporter (CSV)</button>
          <button onClick={() => { try { window.print(); } catch (e) {} }} className="btn" style={{ fontSize: ".78rem" }}>Imprimer</button>
        </div>
        {showCsv && <textarea readOnly className="inp w-full num" rows={6} value={csv} onFocus={(e) => e.target.select()} style={{ fontSize: ".72rem", resize: "vertical" }} />}
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {view === "agres" && <Tbl head={["#", "Gymnaste", "Club", aps.find((a) => a.id === ap)?.label || ""]} empty="Pas encore de note." rows={byAp.map((x, i) => <tr key={x.g.id} style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: medal(i), fontWeight: 700 }} disp num>{i + 1}</Td><Td disp>{x.g.name}</Td><Td className="dim">{x.g.club}</Td><Td right disp num gold bold>{fmt(x.s)}</Td></tr>)} />}
        {view === "cg" && <Tbl head={["#", "Gymnaste", ...aps.map((a) => a.label.slice(0, 3)), "Total"]} empty="Pas encore de résultats." rows={cg.map((x, i) => <tr key={x.g.id} style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: medal(i), fontWeight: 700 }} disp num>{i + 1}</Td><Td disp>{x.g.name}<div className="faint text-xs">{x.g.club}</div></Td>{x.per.map((p, j) => <Td key={j} right num className="dim">{fmt(p)}</Td>)}<Td right disp num gold bold>{fmt(x.total)}</Td></tr>)} />}
        {view === "equipes" && <Tbl head={["#", "Équipe", "Gym.", `Total (${config.teamBestN} meil./agrès)`]} empty="Aucune équipe." rows={teamRows.map((x, i) => <tr key={x.team} style={{ borderTop: "1px solid var(--line)" }}><Td style={{ color: medal(i), fontWeight: 700 }} disp num>{i + 1}</Td><Td disp className="flex items-center gap-2"><Users size={14} className="faint" />{x.team}</Td><Td className="dim">{x.n}</Td><Td right disp num gold bold>{fmt(x.total)}</Td></tr>)} />}
      </div>
      <p className="faint text-center" style={{ fontSize: ".72rem" }}>Mise à jour automatique toutes les 4 s.</p>
    </div>
  );
}
function Tbl({ head, rows, empty }) {
  return <table className="w-full text-sm"><thead><tr className="lbl" style={{ background: "var(--panel2)" }}>{head.map((h, i) => <th key={i} className="px-3 py-2" style={{ textAlign: i > 1 ? "right" : "left" }}>{h}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={head.length} className="px-3 py-8 text-center faint">{empty}</td></tr> : rows}</tbody></table>;
}
const Td = ({ children, right, disp, num, gold, bold, className = "", style = {} }) =>
  <td className={`px-3 py-2.5 ${disp ? "disp" : ""} ${num ? "num" : ""} ${gold ? "gold" : ""} ${className}`} style={{ textAlign: right ? "right" : "left", fontWeight: bold ? 700 : undefined, ...style }}>{children}</td>;

/* ------------------------------ Roster (orga) --------------------- */
function RosterManager({ config, roster, addGymnast, removeGymnast }) {
  const [g, setG] = useState({ name: "", club: "", division: config.divisions[0].id, category: config.categories[0], team: "", group: config.groups[0], dossard: "" });
  const add = () => { if (!g.name.trim()) return; addGymnast(g); setG({ ...g, name: "" }); };
  const divOf = (id) => config.divisions.find((d) => d.id === id);
  const byClub = {}; roster.forEach((x) => (byClub[x.club || "—"] ||= []).push(x));
  return (
    <div className="panel p-4 risein">
      <h2 className="disp mb-3" style={{ fontWeight: 600 }}>ROSTER · {roster.length} gymnastes</h2>
      <div className="grid sm:grid-cols-3 gap-2 mb-3 pb-3" style={{ borderBottom: "1px solid var(--line)" }}>
        <input className="inp" placeholder="Nom" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} />
        <input className="inp" placeholder="Club" value={g.club} onChange={(e) => setG({ ...g, club: e.target.value })} />
        <input className="inp" placeholder="Équipe" value={g.team} onChange={(e) => setG({ ...g, team: e.target.value })} />
        <input className="inp num" placeholder="Dossard" value={g.dossard} onChange={(e) => setG({ ...g, dossard: e.target.value })} />
        <Sel value={g.division} onChange={(v) => setG({ ...g, division: v })} opts={config.divisions.map((d) => [d.id, `${d.discipline} · ${d.label}`])} pre="Division" />
        <Sel value={g.category} onChange={(v) => setG({ ...g, category: v })} opts={config.categories.map((c) => [c, c])} pre="Catégorie" />
        <Sel value={g.group} onChange={(v) => setG({ ...g, group: v })} opts={config.groups.map((x) => [x, x])} pre="Groupe" />
        <button onClick={add} className="btn btn-gold sm:col-span-3" style={{ justifyContent: "center" }}><Plus size={15} />Ajouter</button>
      </div>
      <div className="space-y-3 max-h-96 overflow-auto">
        {Object.entries(byClub).map(([club, arr]) => (
          <div key={club}>
            <div className="lbl gold mb-1">{club} · {arr.length}</div>
            {arr.map((x) => { const d = divOf(x.division); return (
              <div key={x.id} className="flex items-center gap-2 text-sm py-1">
                {x.dossard && <span className="num gold text-xs" style={{ width: 28 }}>#{x.dossard}</span>}
                <span className="flex-1 disp" style={{ fontWeight: 500 }}>{x.name}</span>
                <span className="faint text-xs">{d?.discipline}</span>
                <span className="faint text-xs num">{d?.label}</span>
                <span className="dim text-xs" style={{ width: 84 }}>{x.category}</span>
                <span className="faint text-xs">Gr.{x.group}</span>
                <button onClick={() => removeGymnast(x.id)} style={{ color: "var(--faint)" }}><Trash2 size={15} /></button>
              </div>
            ); })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------- Accès (organisateur) ------------------- */
function AccessView({ config, saveConfig, presence }) {
  const now = Date.now();
  const online = Object.entries(presence || {}).map(([k, v]) => ({ k, ...v })).filter((v) => now - (v.ts || 0) < 30000).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  const roles = ["organisateur", "superviseur", "speaker", "coach"];
  const setJudge = (key, val) => saveConfig({ ...config, judgeCodes: { ...(config.judgeCodes || {}), [key]: val } });
  const setJs = (key, val) => saveConfig({ ...config, jsCodes: { ...(config.jsCodes || {}), [key]: val } });
  return (
    <div className="space-y-4 risein">
      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>CODES JUGES — PAR POSTE</h2>
        <p className="faint text-xs mb-3">Un code « Juges » (pour les juges de poste : ils choisissent leur numéro) et un code « JS » distinct (Juge Supérieur), par agrès et par discipline.</p>
        {DISCS.map((d) => (
          <div key={d} style={{ marginBottom: 10 }}>
            <div className="lbl gold mb-1">{d}</div>
            <div className="space-y-1.5">
              {apparatusOf(d).map((a) => { const key = `${d}:${a.id}`; return (
                <div key={key} className="flex items-center gap-2 flex-wrap">
                  <span className="disp" style={{ width: 90, fontWeight: 500 }}>{a.label}</span>
                  <span className="lbl">Juges</span>
                  <TextCommit className="inp num" style={{ width: 120 }} value={(config.judgeCodes || {})[key] || ""} onCommit={(val) => setJudge(key, val)} />
                  <button onClick={() => setJudge(key, randCode(abbr(a.label) + d))} className="btn" style={{ fontSize: ".7rem" }}><RotateCcw size={11} /></button>
                  <span className="lbl gold">JS</span>
                  <TextCommit className="inp num" style={{ width: 120 }} value={(config.jsCodes || {})[key] || ""} onCommit={(val) => setJs(key, val)} />
                  <button onClick={() => setJs(key, randCode(abbr(a.label) + d + "JS"))} className="btn" style={{ fontSize: ".7rem" }}><RotateCcw size={11} /></button>
                </div>
              ); })}
            </div>
          </div>
        ))}
      </section>
      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>CODES DES AUTRES RÔLES</h2>
        <div className="space-y-2 mt-2">
          {roles.map((role) => (
            <div key={role} className="flex items-center gap-2 flex-wrap">
              <span className="lbl" style={{ width: 110, textTransform: "capitalize" }}>{role}</span>
              <TextCommit className="inp num" style={{ width: 150 }} value={config.codes[role] || ""} onCommit={(val) => saveConfig({ ...config, codes: { ...config.codes, [role]: val } })} />
              <button onClick={() => saveConfig({ ...config, codes: { ...config.codes, [role]: randCode(role) } })} className="btn" style={{ fontSize: ".72rem" }}><RotateCcw size={12} />Régénérer</button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel p-4">
        <h2 className="disp mb-2" style={{ fontWeight: 600 }}>CONNEXIONS EN DIRECT ({online.length})</h2>
        {online.length === 0 && <p className="faint text-sm">Personne connecté (le public n'est pas suivi).</p>}
        {online.map((v) => (
          <div key={v.k} className="flex items-center gap-2 py-1.5 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--valid)" }} />
            <span className="flex-1 disp" style={{ fontWeight: 500 }}>{v.label}</span>
            <span className="faint text-xs">en ligne</span>
          </div>
        ))}
      </section>
    </div>
  );
}

/* ------------------- Override / Super-admin ----------------------- */
function OverrideView({ config, roster, scores, writeCell, deleteCell, resync }) {
  const [discipline, setDiscipline] = useState("GAF");
  const divsOfDisc = config.divisions.filter((d) => d.discipline === discipline);
  const [division, setDivision] = useState(divsOfDisc[0]?.id);
  const [category, setCategory] = useState("");
  const [groupF, setGroupF] = useState("");
  const [q, setQ] = useState("");
  const [undo, setUndo] = useState(null);
  const [ap, setAp] = useState(apparatusOf(discipline)[0].id);
  useEffect(() => { const list = config.divisions.filter((d) => d.discipline === discipline); if (!list.find((d) => d.id === division)) setDivision(list[0]?.id); if (!apparatusOf(discipline).find((a) => a.id === ap)) setAp(apparatusOf(discipline)[0].id); }, [discipline]);
  const div = config.divisions.find((d) => d.id === division);
  const list = roster.filter((g) => g.division === division && (category === "" || g.category === category) && (groupF === "" || g.group === groupF) && matchG(g, q)).sort(bibSort);
  const seg = (val, set, opts) => <div className="flex flex-wrap gap-1">{opts.map((o) => <button key={o.v} onClick={() => set(o.v)} className={`seg ${val === o.v ? "seg-on" : ""}`}>{o.l}</button>)}</div>;
  const stOpts = [["draft", "Brouillon"], ["submitted", "Soumis"], ["validated", "Validé"]];
  const doDelete = (gid, aid) => { const cell = scores?.[gid]?.[aid]; setUndo({ gid, aid, cell }); deleteCell(gid, aid); };
  const doUndo = () => { if (undo?.cell) writeCell(undo.gid, undo.aid, undo.cell); setUndo(null); };
  return (
    <div className="space-y-4 risein">
      <div className="panel p-4 flex items-center justify-between flex-wrap gap-2">
        <div><div className="lbl">Super-admin — override</div><div className="disp" style={{ fontWeight: 700, fontSize: "1.1rem" }}>Modifier / supprimer n'importe quelle note</div></div>
        <div className="flex items-center gap-2">
          {undo && <button onClick={doUndo} className="btn" style={{ color: "var(--gold)" }}><RotateCcw size={13} />Annuler la suppression</button>}
          <button onClick={() => { resync(); }} className="btn"><RotateCcw size={14} />Forcer la resynchro</button>
        </div>
      </div>
      <div className="panel p-4 space-y-3">
        <Field label="Discipline">{seg(discipline, setDiscipline, DISCS.map((d) => ({ v: d, l: d })))}</Field>
        <Field label="Agrès">{seg(ap, setAp, apparatusOf(discipline).map((a) => ({ v: a.id, l: a.label })))}</Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Division">{seg(division, setDivision, divsOfDisc.map((d) => ({ v: d.id, l: d.label })))}</Field>
          <Field label="Catégorie">{seg(category, setCategory, [{ v: "", l: "Toutes" }, ...catsFor(config, roster, division).map((c) => ({ v: c, l: c }))])}</Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Groupe">{seg(groupF, setGroupF, [{ v: "", l: "Tous" }, ...config.groups.map((x) => ({ v: x, l: x }))])}</Field>
          <Field label="Rechercher"><input className="inp w-full" placeholder="nom / dossard" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
      </div>
      <div className="panel" style={{ overflow: "hidden" }}>
        {list.length === 0 && <div className="p-6 text-center faint text-sm">Aucune gymnaste.</div>}
        {list.map((g) => { const cell = scores?.[g.id]?.[ap] || {}; const total = cellTotal(cell, div); return (
          <div key={g.id} className="p-3 flex items-center gap-3 flex-wrap" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="flex-1 min-w-0"><div className="disp" style={{ fontWeight: 600 }}>{g.dossard ? <span className="gold num" style={{ fontSize: ".72rem", marginRight: 5 }}>#{g.dossard}</span> : null}{g.name}</div><div className="faint text-xs">{g.club} · {g.category}</div></div>
            <div className="flex items-center gap-2 flex-wrap">
              {div && div.mode === "DE"
                ? <NumInput label="D" value={cell.d} onCommit={(v) => writeCell(g.id, ap, { d: v })} w={56} />
                : <NumInput label="Note j1" value={cell.notes?.[1]} onCommit={(v) => writeCell(g.id, ap, { notes: { 1: v } })} w={64} />}
              <NumInput label="Pén." value={cell.pen} onCommit={(v) => writeCell(g.id, ap, { pen: v })} w={48} />
              <div style={{ width: 58, textAlign: "right" }}><div className="lbl">Total</div><div className="disp num gold" style={{ fontWeight: 700 }}>{fmt(total)}</div></div>
              <select value={cell.status || "draft"} onChange={(e) => writeCell(g.id, ap, { status: e.target.value, validatedAt: e.target.value === "validated" ? Date.now() : cell.validatedAt })} className="inp" style={{ fontSize: ".8rem" }}>{stOpts.map(([v, l]) => <option key={v} value={v} style={{ background: "#141619" }}>{l}</option>)}</select>
              <ConfirmButton onConfirm={() => doDelete(g.id, ap)} className="btn" style={{ color: "var(--late)", fontSize: ".75rem" }} confirmLabel="Supprimer ?"><Trash2 size={13} /></ConfirmButton>
            </div>
          </div>
        ); })}
      </div>
    </div>
  );
}

/* ------------------------------ Réglages -------------------------- */
function SettingsView({ config, saveConfig, resetScores, resetRoster, roster }) {
  const updateDiv = (id, patch) => saveConfig({ ...config, divisions: config.divisions.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const removeDiv = (id) => saveConfig({ ...config, divisions: config.divisions.filter((d) => d.id !== id) });
  const [nd, setNd] = useState({ discipline: "GAF", label: "", mode: "single", start: 10, combine: "avg", judges: 3, bonus: false });
  const addDiv = () => { if (!nd.label.trim()) return; const id = `${nd.discipline.toLowerCase()}-${(abbr(nd.label) || "d").slice(0, 6)}-${Math.floor(Math.random() * 10000)}`; saveConfig({ ...config, divisions: [...config.divisions, { ...nd, id, start: parseNum(nd.start) ?? 10 }] }); setNd({ ...nd, label: "" }); };
  const [nc, setNc] = useState(""); const [ng, setNg] = useState("");
  const addCat = () => { const v = nc.trim(); if (v && !config.categories.includes(v)) saveConfig({ ...config, categories: [...config.categories, v] }); setNc(""); };
  const rmCat = (c) => saveConfig({ ...config, categories: config.categories.filter((x) => x !== c) });
  const addGrp = () => { const v = ng.trim().toUpperCase(); if (v && !config.groups.includes(v)) saveConfig({ ...config, groups: [...config.groups, v] }); setNg(""); };
  const rmGrp = (g) => saveConfig({ ...config, groups: config.groups.filter((x) => x !== g) });
  const divCount = (id) => (roster || []).filter((x) => x.division === id).length;
  return (
    <div className="space-y-4 risein">
      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>URL PUBLIQUE (QR)</h2>
        <p className="faint text-xs mb-2">Adresse encodée dans le QR de l'écran géant. (L'annonce speaker est dans l'onglet Live ; les codes d'accès dans l'onglet Accès.)</p>
        <TextCommit className="inp w-full num" placeholder="https://..." value={config.publicUrl || ""} onCommit={(val) => saveConfig({ ...config, publicUrl: val })} />
      </section>

      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>DIVISIONS & SCORING</h2>
        <p className="faint text-xs mb-3">Ajoute, retire ou règle chaque division. Départ = 10/20/30. « Bonus » = champ bonus/malus.</p>
        <div className="space-y-2">
          {config.divisions.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 panel2 p-2">
              <span className="disp" style={{ fontWeight: 700, width: 74 }}><span className="gold">{d.discipline}</span> {d.label}</span>
              <Sel value={d.mode} onChange={(v) => updateDiv(d.id, { mode: v })} opts={[["single", "Note unique"], ["DE", "D + E"]]} />
              <label className="lbl flex items-center gap-1">Départ<input className="inp num" style={{ width: 52 }} value={d.start} onChange={(e) => updateDiv(d.id, { start: parseNum(e.target.value) ?? 10 })} /></label>
              <Sel value={d.combine} onChange={(v) => updateDiv(d.id, { combine: v })} opts={[["avg", "Moyenne"], ["trim", "Retirer extrêmes"], ["median", "Médiane"]]} />
              <label className="lbl flex items-center gap-1">Juges<input className="inp num" style={{ width: 44 }} value={d.judges} onChange={(e) => updateDiv(d.id, { judges: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
              <label className="lbl flex items-center gap-1"><input type="checkbox" checked={!!d.bonus} onChange={(e) => updateDiv(d.id, { bonus: e.target.checked })} />Bonus</label>
              <span className="faint text-xs">{divCount(d.id)} gym.</span>
              <ConfirmButton onConfirm={() => removeDiv(d.id)} className="btn" style={{ color: "var(--late)", fontSize: ".72rem" }} confirmLabel="Retirer ?"><Trash2 size={12} /></ConfirmButton>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--line)" }}>
          <Sel value={nd.discipline} onChange={(v) => setNd({ ...nd, discipline: v })} opts={DISCS.map((d) => [d, d])} pre="Discipline" />
          <label className="block"><div className="lbl mb-1">Nom</div><input className="inp" style={{ width: 90 }} placeholder="ex. D7" value={nd.label} onChange={(e) => setNd({ ...nd, label: e.target.value })} /></label>
          <Sel value={nd.mode} onChange={(v) => setNd({ ...nd, mode: v })} opts={[["single", "Note unique"], ["DE", "D + E"]]} pre="Mode" />
          <button onClick={addDiv} className="btn btn-gold"><Plus size={14} />Ajouter division</button>
        </div>
      </section>

      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>CATÉGORIES</h2>
        <div className="flex flex-wrap gap-1 mb-2">
          {config.categories.map((c) => <span key={c} className="panel2" style={{ padding: ".25rem .5rem", borderRadius: 8, fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: 6 }}>{c}<button onClick={() => rmCat(c)} style={{ color: "var(--faint)" }}>✕</button></span>)}
        </div>
        <div className="flex gap-2"><input className="inp" placeholder="Nouvelle catégorie" value={nc} onChange={(e) => setNc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} /><button onClick={addCat} className="btn"><Plus size={14} />Ajouter</button></div>
      </section>

      <section className="panel p-4">
        <h2 className="disp mb-1" style={{ fontWeight: 600 }}>GROUPES (plateaux)</h2>
        <div className="flex flex-wrap gap-1 mb-2">
          {config.groups.map((g) => <span key={g} className="panel2" style={{ padding: ".25rem .5rem", borderRadius: 8, fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: 6 }}>Gr. {g}<button onClick={() => rmGrp(g)} style={{ color: "var(--faint)" }}>✕</button></span>)}
        </div>
        <div className="flex gap-2"><input className="inp" style={{ width: 90 }} placeholder="ex. E" value={ng} onChange={(e) => setNg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGrp()} /><button onClick={addGrp} className="btn"><Plus size={14} />Ajouter</button></div>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap gap-4">
          <label className="lbl flex items-center gap-2">Durée rotation (min)<input className="inp num" style={{ width: 64 }} value={config.schedule.durationMin} onChange={(e) => saveConfig({ ...config, schedule: { ...config.schedule, durationMin: parseInt(e.target.value) || 45 } })} /></label>
          <label className="lbl flex items-center gap-2">Équipes — meilleurs/agrès<input className="inp num" style={{ width: 56 }} value={config.teamBestN} onChange={(e) => saveConfig({ ...config, teamBestN: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
          <label className="lbl flex items-center gap-2">Délai réclamation (s)<input className="inp num" style={{ width: 64 }} value={config.inquiryWindowSec ?? 120} onChange={(e) => saveConfig({ ...config, inquiryWindowSec: Math.max(10, parseInt(e.target.value) || 120) })} /></label>
          <label className="lbl flex items-center gap-2"><input type="checkbox" checked={!!config.rosterLocked} onChange={(e) => saveConfig({ ...config, rosterLocked: e.target.checked })} />Inscriptions verrouillées (coachs)</label>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <ConfirmButton onConfirm={resetScores} className="btn" style={{ color: "var(--late)" }} confirmLabel="Confirmer l'effacement ?"><RotateCcw size={14} />Réinitialiser les notes</ConfirmButton>
        <ConfirmButton onConfirm={resetRoster} className="btn" style={{ color: "var(--late)" }} confirmLabel="Vider roster + notes ?"><RotateCcw size={14} />Nouvelle compétition (vider roster + notes)</ConfirmButton>
      </div>
    </div>
  );
}

/* ------------------------------ atomes ---------------------------- */
function ConfirmButton({ onConfirm, children, className = "btn", style = {}, confirmLabel = "Confirmer ?" }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button className={className} style={{ ...style, ...(armed ? { color: "var(--late)", borderColor: "var(--late)" } : {}) }} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : children}</button>;
}
const Field = ({ label, children }) => <div><div className="lbl mb-1.5">{label}</div>{children}</div>;
const Sel = ({ value, onChange, opts, pre }) => (
  <label className="inline-flex flex-col">
    {pre && <span className="lbl mb-1">{pre}</span>}
    <select value={value} onChange={(e) => onChange(e.target.value)} className="inp" style={{ paddingRight: "1.5rem" }}>
      {opts.map(([v, l]) => <option key={v} value={v} style={{ background: "#141619" }}>{l}</option>)}
    </select>
  </label>
);
