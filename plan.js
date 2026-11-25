// =========================================================
// Plan vu de dessus (étape 2). Unités : centimètres.
// Un plan par lieu : { pieces, portes, meubles }, rangé dans l'élément « lieu ».
//   piece  = { id, pts: [x1, y1, x2, y2, …], nom, lien }   (Firestore refuse les tableaux de tableaux)
//   porte  = { id, x, y, rot, larg, fx, fy }                 (fx / fy = sens d'ouverture)
//   meuble = { id, mod, x, y, w, h, rot, nom, lien }
// lien = id d'un élément de la liste (facultatif) : toucher le dessin l'ouvre.
// =========================================================

const GRILLE = 10;      // aimant des pièces (cm)
const PAS_MEUBLE = 5;
const nid = () => Math.random().toString(36).slice(2, 9);
const aimant = (v, pas = GRILLE) => Math.round(v / pas) * pas;
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONES = "icones/icones.svg#";
const ic = n => `<svg class="ic"><use href="${ICONES}${n}"></use></svg>`;

// ---------- Catalogue ----------
export const CATALOGUE = [
  { cat: "Chambre", items: [["lit1", "Lit simple", 90, 190], ["lit2", "Lit double", 160, 200], ["chevet", "Table de nuit", 45, 40], ["armoire", "Armoire", 120, 60], ["commode", "Commode", 100, 50]] },
  { cat: "Salon / bureau", items: [["canape", "Canapé", 200, 90], ["fauteuil", "Fauteuil", 80, 80], ["table", "Table", 160, 90], ["chaise", "Chaise", 45, 45], ["bureau", "Bureau", 120, 60], ["etagere", "Étagère", 80, 30], ["tv", "Meuble TV", 150, 40]] },
  { cat: "Cuisine / salle de bain", items: [["plan", "Plan de travail", 180, 60], ["evier", "Évier", 80, 60], ["plaques", "Plaques", 60, 60], ["frigo", "Frigo", 60, 65], ["lavelinge", "Lave-linge", 60, 60], ["wc", "WC", 40, 65], ["lavabo", "Lavabo", 60, 45], ["douche", "Douche", 90, 90], ["baignoire", "Baignoire", 170, 75]] },
  { cat: "Rangement", items: [["placard", "Placard", 120, 60], ["carton", "Carton", 50, 40], ["coffre", "Coffre", 90, 50], ["murale", "Étagère murale", 100, 25], ["libre", "Forme libre", 100, 60]] }
];
const MODELES = {};
CATALOGUE.forEach(c => c.items.forEach(([k, nom, w, h]) => { MODELES[k] = { nom, w, h }; }));

// Dessins au trait, centrés sur (0, 0), étirés à w × h. Proportions fixes pour les petits détails (oreillers…).
const R = (x, y, w, h, r = 0) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" rx="${r}"/>`;
const L = (...p) => `<polyline points="${p.map(q => q.join(",")).join(" ")}"/>`;
const C = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${Math.max(0, r)}"/>`;
const E = (x, y, rx, ry) => `<ellipse cx="${x}" cy="${y}" rx="${Math.max(0, rx)}" ry="${Math.max(0, ry)}"/>`;
function dessin(mod, w, h) {
  const a = -w / 2, b = -h / 2, cadre = R(a, b, w, h, 2), m = Math.min(w, h);
  switch (mod) {
    case "lit1": case "lit2": {
      const nb = mod === "lit2" ? 2 : 1, ph = Math.min(26, h * .15), pw = (w - 16 - (nb - 1) * 6) / nb, yc = b + ph + 18;
      let s = cadre;
      for (let i = 0; i < nb; i++) s += R(a + 8 + i * (pw + 6), b + 7, pw, ph, 6);
      return s + L([a, yc], [-a, yc]) + L([-a - w * .35, yc], [-a, Math.min(-b, yc + w * .3)]);
    }
    case "chevet": return cadre + C(0, 0, m * .25);
    case "armoire": return cadre + L([a, -b - 7], [-a, -b - 7]) + L([0, b], [0, -b - 7]);
    case "commode": return cadre + R(a + 5, b + 5, w - 10, h - 14, 1);
    case "canape": case "fauteuil": {
      const d = Math.min(20, h * .25), bras = Math.min(18, w * .2);
      let s = R(a, b, w, h, 6) + R(a, b, w, d, 4) + R(a, b + d, bras, h - d, 4) + R(-a - bras, b + d, bras, h - d, 4);
      if (mod === "canape") { const n = Math.max(2, Math.round((w - 2 * bras) / 70)); for (let i = 1; i < n; i++) { const x = a + bras + i * (w - 2 * bras) / n; s += L([x, b + d], [x, -b]); } }
      return s;
    }
    case "table": return R(a, b, w, h, 4);
    case "chaise": return R(a, b + h * .15, w, h * .85, 4) + R(a + 2, b, w - 4, h * .14, 2);
    case "bureau": return cadre + R(-w * .2, b + 4, w * .4, 5, 1);
    case "etagere": case "murale": { let s = cadre; const n = Math.max(1, Math.round(w / 40)); for (let i = 1; i < n; i++) s += L([a + i * w / n, b], [a + i * w / n, -b]); return s; }
    case "tv": return cadre + R(-w * .35, b + 3, w * .7, 4, 1);
    case "plan": return cadre + L([a, -b - 5], [-a, -b - 5]);
    case "evier": return cadre + R(a + 6, b + 6, w - 12, h - 12, 6) + C(0, 0, 3);
    case "plaques": { const r = m * .16; return cadre + C(-w / 4, -h / 4, r) + C(w / 4, -h / 4, r * .8) + C(-w / 4, h / 4, r * .8) + C(w / 4, h / 4, r); }
    case "frigo": return cadre + R(a + 4, b + 4, w - 8, h - 14, 2) + L([a, -b - 6], [-a, -b - 6]);
    case "lavelinge": return cadre + C(0, 3, m * .32);
    case "wc": return R(a, b, w, Math.min(18, h * .3), 3) + E(0, b + Math.min(18, h * .3) + (h - Math.min(18, h * .3)) / 2, w * .42, (h - Math.min(18, h * .3)) / 2);
    case "lavabo": return cadre + E(0, 2, w * .32, h * .3) + C(0, b + 5, 2);
    case "douche": return cadre + L([a, b], [-a, -b]) + L([-a, b], [a, -b]) + C(0, 0, 4);
    case "baignoire": return R(a, b, w, h, 8) + R(a + 7, b + 7, w - 14, h - 14, Math.min(25, h * .35)) + C(a + 18, 0, 3);
    case "placard": {
      const n = Math.max(2, Math.round(w / 25)); const pts = [];
      for (let i = 0; i <= n; i++) pts.push([a + i * w / n, i % 2 ? -b - 4 : b + 4]);
      return cadre + L([a, 0], [-a, 0]) + L(...pts);
    }
    case "carton": return cadre + L([a, b], [-a, -b]) + L([-a, b], [a, -b]);
    case "coffre": return cadre + L([a, b + 8], [-a, b + 8]) + R(-5, -b - 7, 10, 5, 1);
    default: return cadre;
  }
}

// ---------- Données ----------
const num = (v, d = 0) => Number.isFinite(+v) ? Math.round(+v * 10) / 10 : d;
export function normaliserPlan(p) {
  if (!p || typeof p !== "object") return null;
  const tab = v => Array.isArray(v) ? v.filter(x => x && typeof x === "object") : [];
  return {
    pieces: tab(p.pieces).map(x => ({ id: String(x.id || nid()), pts: (Array.isArray(x.pts) ? x.pts : []).map(v => num(v)), nom: String(x.nom || ""), lien: String(x.lien || "") }))
      .filter(x => x.pts.length >= 6 && x.pts.length % 2 === 0),
    portes: tab(p.portes).map(x => ({ id: String(x.id || nid()), x: num(x.x), y: num(x.y), rot: num(x.rot), larg: num(x.larg, 80) || 80, fx: x.fx < 0 ? -1 : 1, fy: x.fy < 0 ? -1 : 1 })),
    meubles: tab(p.meubles).map(x => ({ id: String(x.id || nid()), mod: MODELES[x.mod] ? x.mod : "libre", x: num(x.x), y: num(x.y),
      w: Math.max(5, num(x.w, 60)), h: Math.max(5, num(x.h, 60)), rot: num(x.rot), nom: String(x.nom || ""), lien: String(x.lien || "") }))
  };
}
export const planVide = p => !p || (!p.pieces.length && !p.portes.length && !p.meubles.length);
const nouveauPlan = () => ({ pieces: [], portes: [], meubles: [] });

// ---------- Géométrie ----------
const paires = f => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; };
function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  points.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const marge = (b, m) => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
function coinsMeuble(m) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => tourner(m, sx * m.w / 2, sy * m.h / 2));
}
function tourner(o, lx, ly) {
  const r = o.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [o.x + lx * c - ly * s, o.y + lx * s + ly * c];
}
function boite(plan) {
  const pts = [];
  plan.pieces.forEach(p => pts.push(...paires(p.pts)));
  plan.portes.forEach(d => pts.push([d.x - d.larg, d.y - d.larg], [d.x + d.larg, d.y + d.larg]));
  plan.meubles.forEach(m => pts.push(...coinsMeuble(m)));
  return pts.length ? marge(bbox(pts), 40) : { x: -100, y: -100, w: 600, h: 500 };
}
function dansPoly(x, y, f) {
  let dedans = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}
function centre(f) {   // centre de gravité (le nom de la pièce se pose là)
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const k = f[j] * f[i + 1] - f[i] * f[j + 1];
    A += k; cx += (f[j] + f[i]) * k; cy += (f[j + 1] + f[i + 1]) * k;
  }
  if (Math.abs(A) < 1) { const b = bbox(paires(f)); return [b.x + b.w / 2, b.y + b.h / 2]; }
  return [cx / (3 * A), cy / (3 * A)];
}

// Cadre à montrer : la pièce (ou le meuble) reliée à l'élément ouvert, sinon tout le plan
export function cadrage(plan, chaine) {
  for (const id of chaine) {
    const p = plan.pieces.find(x => x.lien === id);
    if (p) return { focus: id, box: marge(bbox(paires(p.pts)), 30) };
    const m = plan.meubles.find(x => x.lien === id);
    if (m) {
      const piece = plan.pieces.find(x => dansPoly(m.x, m.y, x.pts));
      return { focus: id, box: piece ? marge(bbox(paires(piece.pts)), 30) : marge(bbox(coinsMeuble(m)), 100) };
    }
  }
  return { focus: "", box: boite(plan) };
}

// ---------- Dessin SVG ----------
// k = centimètres par pixel à l'écran : textes et poignées gardent la même taille quel que soit le zoom.
export function contenuSVG(plan, o = {}) {
  const k = o.k || 1, sel = o.sel || null, nom = o.nom || (() => "");
  const lien = x => x.lien ? ` data-lien="${esc(x.lien)}"` : "";
  let s = "";
  for (const p of plan.pieces) {
    const cls = (o.focus && p.lien === o.focus ? " actif" : "") + (sel && sel.id === p.id ? " sel" : "");
    s += `<polygon class="pl-piece${cls}" points="${paires(p.pts).map(q => q.join(",")).join(" ")}" data-k="piece" data-id="${p.id}"${lien(p)}/>`;
  }
  for (const d of plan.portes) {
    const L2 = d.larg / 2;
    s += `<g class="pl-porte${sel && sel.id === d.id ? " sel" : ""}" transform="translate(${d.x} ${d.y}) rotate(${d.rot}) scale(${d.fx} ${d.fy})" data-k="porte" data-id="${d.id}">
      <rect class="pl-trou" x="${-L2}" y="-8" width="${d.larg}" height="16"/><path class="pl-battant" d="M${-L2} 0V${-d.larg}A${d.larg} ${d.larg} 0 0 1 ${L2} 0"/></g>`;
  }
  for (const m of plan.meubles) {
    const cls = (o.focus && m.lien === o.focus ? " actif" : "");
    s += `<g class="pl-meuble${cls}" transform="translate(${m.x} ${m.y}) rotate(${m.rot})" data-k="meuble" data-id="${m.id}"${lien(m)}>${dessin(m.mod, m.w, m.h)}</g>`;
  }
  // Noms (toujours à l'horizontale)
  const fs = 11 * k;
  for (const p of plan.pieces) {
    const t = nom(p.lien) || p.nom;
    if (t) { const [x, y] = centre(p.pts); s += `<text class="pl-nom" x="${x}" y="${y}" font-size="${fs * 1.1}">${esc(t)}</text>`; }
  }
  for (const m of plan.meubles) {
    const t = nom(m.lien) || m.nom;
    if (t) s += `<text class="pl-nom petit" x="${m.x}" y="${m.y}" font-size="${fs * .85}">${esc(t)}</text>`;
  }
  // Poignées (mode Modifier)
  if (sel) {
    const r = 9 * k;
    if (sel.k === "piece") {
      const p = plan.pieces.find(x => x.id === sel.id);
      if (p) {
        const pts = paires(p.pts);
        pts.forEach(([x, y], i) => {
          const [x2, y2] = pts[(i + 1) % pts.length];
          s += `<circle class="pe-plus" cx="${(x + x2) / 2}" cy="${(y + y2) / 2}" r="${r * .6}" data-k="milieu" data-i="${i}"/>`;
        });
        pts.forEach(([x, y], i) => { s += `<circle class="pe-poignee${sel.coin === i ? " choisi" : ""}" cx="${x}" cy="${y}" r="${r}" data-k="coin" data-i="${i}"/>`; });
      }
    } else if (sel.k === "meuble") {
      const m = plan.meubles.find(x => x.id === sel.id);
      if (m) {
        s += `<polygon class="pe-cadre" points="${coinsMeuble(m).map(q => q.join(",")).join(" ")}"/>`;
        const [tx, ty] = tourner(m, m.w / 2, m.h / 2), [rx, ry] = tourner(m, 0, -m.h / 2 - 26 * k), [hx, hy] = tourner(m, 0, -m.h / 2);
        s += `<line class="pe-cadre" x1="${hx}" y1="${hy}" x2="${rx}" y2="${ry}"/>`;
        s += `<circle class="pe-poignee" cx="${tx}" cy="${ty}" r="${r}" data-k="taille"/><circle class="pe-poignee rot" cx="${rx}" cy="${ry}" r="${r}" data-k="rot"/>`;
      }
    } else if (sel.k === "porte") {
      const d = plan.portes.find(x => x.id === sel.id);
      if (d) s += `<circle class="pe-cadre" cx="${d.x}" cy="${d.y}" r="${d.larg * .75}"/>`;
    }
  }
  return s;
}

// Plan en lecture seule (écran d'accueil). W × H = taille de la zone en pixels.
export function vueHTML(plan, o) {
  const { focus, box } = cadrage(plan, o.chaine || []);
  const k = Math.max(box.w / o.W, box.h / o.H);
  return `<svg class="plan-vue" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet">${contenuSVG(plan, { focus, k, nom: o.nom })}</svg>`;
}
export function apercuModele(mod) {
  const { w, h } = MODELES[mod];
  const b = marge({ x: -w / 2, y: -h / 2, w, h }, 6);
  return `<svg viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><g class="pl-meuble">${dessin(mod, w, h)}</g></svg>`;
}

// ---------- Éditeur (mode « Modifier le plan ») ----------
// Un doigt sur le vide ou sur une pièce non choisie = déplacer la vue ; deux doigts = zoom.
// Un doigt sur un meuble / une porte = le déplacer. Pièce choisie : la tirer, tirer ses coins,
// toucher un « + » au milieu d'un mur pour ajouter un coin.
let ed = null;
export const editeurOuvert = () => !!ed;

export function ouvrirEditeur(planDepart, o) {
  fermerEditeur();
  const racine = document.createElement("div");
  racine.className = "pe";
  racine.innerHTML = `<div class="pe-tete">
      <button class="btn-icone" data-pe="fini" aria-label="Terminé">${ic("arrow-left")}</button>
      <h2>${esc(o.titre)}</h2>
      <button class="btn-icone" data-pe="annuler" aria-label="Annuler">${ic("undo")}</button>
      <button class="btn-icone" data-pe="ajuster" aria-label="Tout voir">${ic("maximize")}</button>
    </div>
    <svg class="pe-svg" preserveAspectRatio="none"></svg>
    <div class="pe-bas"></div>`;
  document.body.appendChild(racine);
  ed = { o, racine, svg: racine.querySelector(".pe-svg"), bas: racine.querySelector(".pe-bas"),
    plan: normaliserPlan(planDepart) || nouveauPlan(), sel: null, histo: [], vb: null, ptrs: new Map(), op: null, minuteur: null };
  ajuster();
  brancher();
  dessiner(); panneau();
}
export function fermerEditeur() {
  if (!ed) return;
  sauverMaintenant();
  ed.obs.disconnect();
  ed.racine.remove();
  ed = null;
}

function ajuster() {
  const b = boite(ed.plan), W = ed.svg.clientWidth || 360, H = ed.svg.clientHeight || 500;
  const k = Math.max(b.w / W, b.h / H);
  ed.vb = { x: b.x + b.w / 2 - W * k / 2, y: b.y + b.h / 2 - H * k / 2, w: W * k, h: H * k };
}
const kEd = () => ed.vb.w / (ed.svg.clientWidth || 360);
function versPlan(cx, cy) {
  const r = ed.svg.getBoundingClientRect();
  return { x: ed.vb.x + (cx - r.left) * ed.vb.w / r.width, y: ed.vb.y + (cy - r.top) * ed.vb.h / r.height };
}

function dessiner() {
  const { vb } = ed, W = ed.svg.clientWidth, H = ed.svg.clientHeight;
  if (W && H) { const h = vb.w * H / W; vb.y += (vb.h - h) / 2; vb.h = h; }
  const k = kEd();
  ed.svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const g = 50;
  ed.svg.innerHTML = `<defs><pattern id="pe-grille" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><circle class="pe-point" cx="0" cy="0" r="${1.3 * k}"/></pattern></defs>
    <rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="url(#pe-grille)"/>`
    + contenuSVG(ed.plan, { k, sel: ed.sel, nom: ed.o.nom });
}

function objet(sel = ed.sel) {
  if (!sel) return null;
  const l = sel.k === "piece" ? ed.plan.pieces : sel.k === "porte" ? ed.plan.portes : ed.plan.meubles;
  return l.find(x => x.id === sel.id) || null;
}
function memoriser() { ed.histo.push(JSON.stringify(ed.plan)); if (ed.histo.length > 40) ed.histo.shift(); }
function changement() { clearTimeout(ed.minuteur); ed.minuteur = setTimeout(sauverMaintenant, 700); }
function sauverMaintenant() {
  if (!ed || !ed.minuteur) return;
  clearTimeout(ed.minuteur); ed.minuteur = null;
  ed.o.enregistrer(JSON.parse(JSON.stringify(ed.plan)));
}

// Porte : se colle sur le mur le plus proche (et prend son angle)
function aimanterPorte(d, x, y) {
  let mieux = null;
  for (const p of ed.plan.pieces) {
    const pts = paires(p.pts);
    pts.forEach(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      if (!l2) return;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const px = ax + t * dx, py = ay + t * dy, dist = Math.hypot(x - px, y - py);
      if (!mieux || dist < mieux.dist) mieux = { dist, px, py, rot: Math.atan2(dy, dx) * 180 / Math.PI };
    });
  }
  if (mieux && mieux.dist < 40) { d.x = Math.round(mieux.px); d.y = Math.round(mieux.py); d.rot = Math.round(mieux.rot * 10) / 10; }
  else { d.x = aimant(x, PAS_MEUBLE); d.y = aimant(y, PAS_MEUBLE); }
}

function brancher() {
  const { svg } = ed;
  // La zone change de taille (panneau du bas, clavier, rotation) : on garde l'échelle, sans écraser le plan
  ed.obs = new ResizeObserver(() => { if (ed) dessiner(); });
  ed.obs.observe(svg);

  svg.addEventListener("pointerdown", e => {
    svg.setPointerCapture(e.pointerId);
    ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ed.ptrs.size === 2) {
      const [a, b] = [...ed.ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      ed.op = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, vb0: { ...ed.vb }, P0: versPlan(mx, my), memo: ed.op?.memo };
      return;
    }
    if (ed.ptrs.size > 2) return;
    const cible = e.target.closest("[data-k]");
    const P = versPlan(e.clientX, e.clientY);
    const op = { x0: e.clientX, y0: e.clientY, cible, P0: P, memo: JSON.stringify(ed.plan), bouge: false };
    const k = cible?.dataset.k, id = cible?.dataset.id;
    if (k === "coin" || k === "milieu") Object.assign(op, { type: k, i: +cible.dataset.i });
    else if (k === "taille" || k === "rot") op.type = k;
    else if (k === "meuble" || k === "porte" || (k === "piece" && ed.sel?.id === id)) {
      const obj = objet({ k, id });
      Object.assign(op, { type: "objet", k, id, avant: JSON.parse(JSON.stringify(obj)) });
    } else Object.assign(op, { type: "vue", vb0: { ...ed.vb } });
    ed.op = op;
  });

  svg.addEventListener("pointermove", e => {
    if (!ed.ptrs.has(e.pointerId)) return;
    ed.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const op = ed.op;
    if (!op) return;
    if (op.type === "pinch") {
      if (ed.ptrs.size < 2) return;
      const [a, b] = [...ed.ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomer(op.vb0.w * op.d0 / (Math.hypot(a.x - b.x, a.y - b.y) || 1), op.P0, mx, my);
      dessiner(); return;
    }
    if (!op.bouge && Math.hypot(e.clientX - op.x0, e.clientY - op.y0) < 5) return;
    op.bouge = true;
    const P = versPlan(e.clientX, e.clientY), dx = P.x - op.P0.x, dy = P.y - op.P0.y;
    if (op.type === "vue") {
      const r = svg.getBoundingClientRect();
      ed.vb.x = op.vb0.x - (e.clientX - op.x0) * ed.vb.w / r.width;
      ed.vb.y = op.vb0.y - (e.clientY - op.y0) * ed.vb.h / r.height;
    } else if (op.type === "objet") {
      const obj = objet(op), av = op.avant;
      ed.sel = { k: op.k, id: op.id };
      if (op.k === "meuble") { obj.x = aimant(av.x + dx, PAS_MEUBLE); obj.y = aimant(av.y + dy, PAS_MEUBLE); }
      else if (op.k === "porte") aimanterPorte(obj, av.x + dx, av.y + dy);
      else { const ddx = aimant(dx), ddy = aimant(dy); obj.pts = av.pts.map((v, i) => v + (i % 2 ? ddy : ddx)); }
    } else if (op.type === "coin") {
      const p = objet();
      p.pts[2 * op.i] = aimant(P.x); p.pts[2 * op.i + 1] = aimant(P.y);
      ed.sel.coin = op.i;
    } else if (op.type === "taille") {
      const m = objet(), r = -m.rot * Math.PI / 180, lx = (P.x - m.x) * Math.cos(r) - (P.y - m.y) * Math.sin(r), ly = (P.x - m.x) * Math.sin(r) + (P.y - m.y) * Math.cos(r);
      m.w = Math.max(10, aimant(2 * Math.abs(lx), PAS_MEUBLE)); m.h = Math.max(10, aimant(2 * Math.abs(ly), PAS_MEUBLE));
    } else if (op.type === "rot") {
      const m = objet();
      m.rot = (aimant(Math.atan2(P.y - m.y, P.x - m.x) * 180 / Math.PI + 90, 15) + 360) % 360;
    }
    dessiner();
  });

  const fin = e => {
    if (!ed.ptrs.has(e.pointerId)) return;
    ed.ptrs.delete(e.pointerId);
    const op = ed.op;
    if (!op) return;
    if (op.type === "pinch") { if (!ed.ptrs.size) ed.op = null; return; }   // attendre que tous les doigts soient levés
    ed.op = null;
    if (!op.bouge && e.type === "pointerup") {   // simple toucher
      const k = op.cible?.dataset.k;
      if (k === "milieu") {
        const p = objet(), n = p.pts.length / 2, i = op.i, j = (i + 1) % n;
        p.pts.splice(2 * (i + 1), 0, aimant((p.pts[2 * i] + p.pts[2 * j]) / 2), aimant((p.pts[2 * i + 1] + p.pts[2 * j + 1]) / 2));
        ed.sel.coin = i + 1;
      } else if (k === "coin") ed.sel.coin = op.i;
      else if (k === "meuble" || k === "porte" || k === "piece") ed.sel = { k, id: op.cible.dataset.id };
      else if (k !== "taille" && k !== "rot") ed.sel = null;
      panneau();
    }
    if (JSON.stringify(ed.plan) !== op.memo) { ed.histo.push(op.memo); changement(); }
    dessiner();
  };
  svg.addEventListener("pointerup", fin);
  svg.addEventListener("pointercancel", fin);
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    zoomer(ed.vb.w * (e.deltaY > 0 ? 1.15 : 1 / 1.15), versPlan(e.clientX, e.clientY), e.clientX, e.clientY);
    dessiner();
  }, { passive: false });

  ed.racine.addEventListener("click", e => {
    const b = e.target.closest("[data-pe]");
    if (b) action(b.dataset.pe, b);
  });
  ed.racine.addEventListener("input", e => {
    if (!e.target.classList.contains("pe-nom")) return;
    const obj = objet();
    if (!obj) return;
    if (!ed.nomMemo) { memoriser(); ed.nomMemo = true; }
    obj.nom = e.target.value; dessiner(); changement();
  });
  ed.racine.addEventListener("input", e => {
    if (e.target.id === "pe-cherche") listeLiens(e.target.value);
  });
}

// Zoom en gardant le point P (plan) sous (cx, cy) (écran)
function zoomer(w, P, cx, cy) {
  const r = ed.svg.getBoundingClientRect();
  w = Math.max(80, Math.min(6000, w));
  const h = w * r.height / r.width;
  ed.vb = { x: P.x - (cx - r.left) / r.width * w, y: P.y - (cy - r.top) / r.height * h, w, h };
}

function centreVue() { return { x: aimant(ed.vb.x + ed.vb.w / 2), y: aimant(ed.vb.y + ed.vb.h / 2) }; }

function action(a, b) {
  const obj = objet();
  if (a === "fini") { ed.o.fermer(); return; }
  if (a === "ajuster") { ajuster(); dessiner(); return; }
  if (a === "annuler") {
    if (!ed.histo.length) return;
    ed.plan = JSON.parse(ed.histo.pop()); ed.sel = null;
    changement(); dessiner(); panneau(); return;
  }
  if (a === "fermer-feuille") { panneau(); return; }
  if (a === "piece") {
    memoriser();
    const c = centreVue(), d = 150;
    const p = { id: nid(), pts: [c.x - d, c.y - d, c.x + d, c.y - d, c.x + d, c.y + d, c.x - d, c.y + d], nom: "", lien: "" };
    ed.plan.pieces.push(p); ed.sel = { k: "piece", id: p.id };
  } else if (a === "porte") {
    memoriser();
    const c = centreVue(), d = { id: nid(), x: c.x, y: c.y, rot: 0, larg: 80, fx: 1, fy: 1 };
    aimanterPorte(d, c.x, c.y);
    ed.plan.portes.push(d); ed.sel = { k: "porte", id: d.id };
  } else if (a === "meuble") { catalogue(); return; }
  else if (a === "modele") {
    memoriser();
    const c = centreVue(), md = MODELES[b.dataset.mod];
    const m = { id: nid(), mod: b.dataset.mod, x: c.x, y: c.y, w: md.w, h: md.h, rot: 0, nom: "", lien: "" };
    ed.plan.meubles.push(m); ed.sel = { k: "meuble", id: m.id };
  } else if (a === "supprimer" && obj) {
    memoriser();
    for (const l of [ed.plan.pieces, ed.plan.portes, ed.plan.meubles]) { const i = l.indexOf(obj); if (i >= 0) l.splice(i, 1); }
    ed.sel = null;
  } else if (a === "dupliquer" && obj) {
    memoriser();
    const c = JSON.parse(JSON.stringify(obj)); c.id = nid(); c.lien = "";
    if (ed.sel.k === "piece") { c.pts = c.pts.map(v => v + 30); ed.plan.pieces.push(c); }
    else { c.x += 30; c.y += 30; (ed.sel.k === "porte" ? ed.plan.portes : ed.plan.meubles).push(c); }
    ed.sel = { k: ed.sel.k, id: c.id };
  } else if (a === "tourner" && obj) { memoriser(); obj.rot = (obj.rot + 90) % 360; }
  else if (a === "retourner" && obj) {
    memoriser();
    const etats = [[1, 1], [-1, 1], [-1, -1], [1, -1]], i = etats.findIndex(([x, y]) => x === obj.fx && y === obj.fy);
    [obj.fx, obj.fy] = etats[(i + 1) % 4];
  } else if (a === "largeur" && obj) {
    memoriser();
    const l = [70, 80, 90, 120, 160]; obj.larg = l[(l.indexOf(obj.larg) + 1) % l.length];
  } else if (a === "retirer-coin" && obj && ed.sel.coin != null && obj.pts.length > 6) {
    memoriser(); obj.pts.splice(2 * ed.sel.coin, 2); ed.sel.coin = null;
  } else if (a === "relier") { listeLiens(""); return; }
  else if (a === "lien" && obj) { memoriser(); obj.lien = b.dataset.id; }
  else return;
  changement(); dessiner(); panneau();
}

// Barre du bas : outils d'ajout, ou réglages de ce qui est choisi
function panneau() {
  ed.nomMemo = false;
  const obj = objet(), s = ed.sel;
  if (!obj) {
    ed.sel = null;
    ed.bas.innerHTML = `<div class="pe-ligne">
      <button class="btn" data-pe="piece">${ic("polygon")}Pièce</button>
      <button class="btn" data-pe="porte">${ic("door")}Porte</button>
      <button class="btn" data-pe="meuble">${ic("meuble")}Meuble</button></div>`;
    return;
  }
  const nomLien = obj.lien ? ed.o.nom(obj.lien) : "";
  const haut = s.k === "porte" ? "" : `<div class="pe-ligne">
      <input class="pe-nom" placeholder="${s.k === "piece" ? "Nom de la pièce" : esc(MODELES[obj.mod].nom)}" value="${esc(obj.nom)}" maxlength="40">
      <button class="btn pe-relier" data-pe="relier">${ic("link")}<span>${nomLien ? esc(nomLien) : "Relier"}</span></button></div>`;
  const outils = [];
  if (s.k === "piece" && s.coin != null && obj.pts.length > 6) outils.push(`<button class="btn" data-pe="retirer-coin">${ic("x")}Coin</button>`);
  if (s.k === "meuble") outils.push(`<button class="btn" data-pe="tourner">${ic("rotate")}90°</button>`);
  if (s.k === "porte") outils.push(`<button class="btn" data-pe="retourner">${ic("rotate")}Sens</button>`, `<button class="btn" data-pe="largeur">${obj.larg} cm</button>`);
  outils.push(`<button class="btn" data-pe="dupliquer" aria-label="Dupliquer">${ic("copy")}</button>`, `<button class="btn danger" data-pe="supprimer" aria-label="Supprimer">${ic("trash")}</button>`);
  ed.bas.innerHTML = haut + `<div class="pe-ligne">${outils.join("")}</div>`;
}

function feuille(titre, html) {
  ed.bas.innerHTML = `<div class="pe-feuille-tete"><span class="h4">${esc(titre)}</span>
    <button class="btn-icone petit" data-pe="fermer-feuille" aria-label="Fermer">${ic("x")}</button></div><div class="pe-feuille">${html}</div>`;
}
function catalogue() {
  feuille("Meubles", CATALOGUE.map(c => `<div class="h4 pe-cat-titre">${esc(c.cat)}</div><div class="pe-cat">${c.items.map(([k, nom]) =>
    `<button data-pe="modele" data-mod="${k}">${apercuModele(k)}<span>${esc(nom)}</span></button>`).join("")}</div>`).join(""));
}
function listeLiens(q) {
  const obj = objet();
  const mots = String(q).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
  const l = ed.o.candidats().filter(c => mots.every(m => c.texte.includes(m)));
  const lignes = `<button class="d-ligne" data-pe="lien" data-id="">${ic("x")}<span class="d-txt"><span class="d-nom">Ne pas relier</span></span></button>`
    + l.slice(0, 150).map(c => `<button class="d-ligne${obj && c.id === obj.lien ? " ici" : ""}" data-pe="lien" data-id="${c.id}">${ic(c.ic)}<span class="d-txt"><span class="d-nom">${esc(c.nom)}</span><span class="d-ch">${esc(c.chemin)}</span></span></button>`).join("");
  if (document.getElementById("pe-cherche")) { ed.bas.querySelector(".pe-liens").innerHTML = lignes; return; }
  feuille("Relier à…", `<div class="recherche">${ic("search")}<input id="pe-cherche" type="search" placeholder="Chercher"></div><div class="pe-liens">${lignes}</div>`);
}
