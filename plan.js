// =========================================================
// Plan vu de dessus (étape 2). Unités : centimètres.
// Un plan par lieu : { pieces, portes, meubles }, rangé dans l'élément « lieu ».
//   piece  = { id, pts: [x1, y1, x2, y2, …], nom, lien, groupe }   (Firestore refuse les tableaux de tableaux)
//            groupe : pièces collées (elles bougent ensemble, un mur commun bouge pour les deux)
//   porte  = { id, type: porte | fenetre, x, y, rot, larg, fx, fy, piece, seg, o }
//            piece / seg / o : mur où elle est posée (n° du mur, distance depuis son début) -> elle suit le mur
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
    pieces: tab(p.pieces).map(x => ({ id: String(x.id || nid()), pts: (Array.isArray(x.pts) ? x.pts : []).map(v => num(v)),
      nom: String(x.nom || ""), lien: String(x.lien || ""), groupe: String(x.groupe || "") }))
      .filter(x => x.pts.length >= 6 && x.pts.length % 2 === 0),
    portes: tab(p.portes).map(x => ({ id: String(x.id || nid()), type: x.type === "fenetre" ? "fenetre" : "porte",
      x: num(x.x), y: num(x.y), rot: num(x.rot), larg: Math.max(20, num(x.larg, 80) || 80), fx: x.fx < 0 ? -1 : 1, fy: x.fy < 0 ? -1 : 1,
      piece: String(x.piece || ""), seg: Math.max(0, Math.round(num(x.seg))), o: num(x.o) })),
    meubles: tab(p.meubles).map(x => ({ id: String(x.id || nid()), mod: MODELES[x.mod] ? x.mod : "libre", x: num(x.x), y: num(x.y),
      w: Math.max(5, num(x.w, 60)), h: Math.max(5, num(x.h, 60)), rot: num(x.rot), nom: String(x.nom || ""), lien: String(x.lien || "") }))
  };
}
export const planVide = p => !p || (!p.pieces.length && !p.portes.length && !p.meubles.length);
const nouveauPlan = () => ({ pieces: [], portes: [], meubles: [] });
const copie = o => JSON.parse(JSON.stringify(o));

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
function aire(f) {   // en cm²
  let a = 0;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) a += f[j] * f[i + 1] - f[i] * f[j + 1];
  return Math.abs(a) / 2;
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
// Murs d'une pièce : [début, fin] ; info = longueur, direction (ux, uy), normale (nx, ny)
const murs = p => { const q = paires(p.pts); return q.map((a, i) => [a, q[(i + 1) % q.length]]); };
function info([a, b]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
  return { a, b, len, ux: dx / len, uy: dy / len, nx: -dy / len, ny: dx / len };
}
const paralleles = (A, B) => Math.abs(A.ux * B.uy - A.uy * B.ux) < 0.035;
// Longueur commune de deux murs alignés (0 = ils ne se touchent pas)
function contact(s1, s2, tol = 1.5) {
  const A = info(s1), B = info(s2);
  if (!paralleles(A, B)) return 0;
  if (Math.abs((B.a[0] - A.a[0]) * A.nx + (B.a[1] - A.a[1]) * A.ny) > tol) return 0;
  const p = q => (q[0] - A.a[0]) * A.ux + (q[1] - A.a[1]) * A.uy;
  const ov = Math.min(A.len, Math.max(p(B.a), p(B.b))) - Math.max(0, Math.min(p(B.a), p(B.b)));
  return ov > 5 ? ov : 0;
}
const touche = (p, q) => murs(p).some(s => murs(q).some(t => contact(s, t)));
const groupe = p => p.groupe || p.id;
const membres = (plan, p) => plan.pieces.filter(q => groupe(q) === groupe(p));
function estRectangle(p) {
  if (p.pts.length !== 8) return false;
  return murs(p).every(([a, b]) => Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5);
}

// Portes / fenêtres : se posent sur le mur le plus proche et retiennent lequel (pour le suivre)
function poserOuverture(plan, d, x, y, seule = null) {
  let mieux = null;
  for (const p of plan.pieces) {
    if (seule && p.id !== seule) continue;
    murs(p).forEach((s, i) => {
      const A = info(s);
      const t = Math.max(0, Math.min(A.len, (x - A.a[0]) * A.ux + (y - A.a[1]) * A.uy));
      const dist = Math.hypot(x - (A.a[0] + t * A.ux), y - (A.a[1] + t * A.uy));
      if (!mieux || dist < mieux.dist) mieux = { dist, p, i, t };
    });
  }
  if (mieux && (seule || mieux.dist < 40)) {
    Object.assign(d, { piece: mieux.p.id, seg: mieux.i, o: Math.round(mieux.t) });
    recalerUne(plan, d);
  } else Object.assign(d, { x: aimant(x, PAS_MEUBLE), y: aimant(y, PAS_MEUBLE), piece: "", seg: 0, o: 0 });
}
function recalerUne(plan, d) {
  const p = plan.pieces.find(x => x.id === d.piece);
  if (!p || d.seg >= p.pts.length / 2) return;
  const A = info(murs(p)[d.seg]);
  const o = A.len < d.larg ? A.len / 2 : Math.max(d.larg / 2, Math.min(A.len - d.larg / 2, d.o));
  d.x = Math.round((A.a[0] + o * A.ux) * 10) / 10; d.y = Math.round((A.a[1] + o * A.uy) * 10) / 10;
  d.rot = Math.round(Math.atan2(A.uy, A.ux) * 1800 / Math.PI) / 10;
}
const recaler = plan => plan.portes.forEach(d => recalerUne(plan, d));
// Après un changement de coins : chaque ouverture se repose sur le mur le plus proche de sa pièce
function rattacher(plan, pid) { plan.portes.filter(d => d.piece === pid).forEach(d => poserOuverture(plan, d, d.x, d.y, pid)); }

// Déplace le mur i de la pièce p de d cm (perpendiculairement). Les murs collés dessus suivent.
function deplacerMur(plan, p, i, d) {
  const s = murs(p)[i], A = info(s), bouges = new Set();
  const bouger = (q, j) => {
    const n = q.pts.length / 2;
    for (const k of [j, (j + 1) % n]) {
      const cle = q.id + ":" + k;
      if (bouges.has(cle)) continue;
      bouges.add(cle);
      q.pts[2 * k] = Math.round((q.pts[2 * k] + A.nx * d) * 10) / 10;
      q.pts[2 * k + 1] = Math.round((q.pts[2 * k + 1] + A.ny * d) * 10) / 10;
    }
  };
  const autres = [];
  membres(plan, p).filter(q => q !== p).forEach(q => murs(q).forEach((t, j) => { if (contact(s, t)) autres.push([q, j]); }));
  bouger(p, i);
  autres.forEach(([q, j]) => bouger(q, j));
}
// Aimant entre pièces : correction (dx, dy) pour qu'un mur du groupe se pose sur un mur voisin (< 20 cm)
function aimantPieces(plan, ids, dx, dy) {
  const nous = plan.pieces.filter(p => ids.has(p.id)), eux = plan.pieces.filter(p => !ids.has(p.id));
  const corr = [];
  for (let passe = 0; passe < 2; passe++) {
    let mieux = null;
    for (const p of nous) for (const s0 of murs(p)) {
      const s = s0.map(([x, y]) => [x + dx, y + dy]), A = info(s);
      if (corr.some(c => Math.abs(c.nx * A.ny - c.ny * A.nx) < 0.035)) continue;   // direction déjà corrigée
      for (const q of eux) for (const t of murs(q)) {
        const B = info(t);
        if (!paralleles(A, B)) continue;
        const ecart = (B.a[0] - A.a[0]) * A.nx + (B.a[1] - A.a[1]) * A.ny;
        if (Math.abs(ecart) > 20) continue;
        const pr = v => (v[0] - A.a[0]) * A.ux + (v[1] - A.a[1]) * A.uy;
        if (Math.min(A.len, Math.max(pr(B.a), pr(B.b))) - Math.max(0, Math.min(pr(B.a), pr(B.b))) <= 0) continue;
        if (!mieux || Math.abs(ecart) < Math.abs(mieux.ecart)) mieux = { ecart, nx: A.nx, ny: A.ny };
      }
    }
    if (!mieux) break;
    corr.push(mieux);
    dx += mieux.nx * mieux.ecart; dy += mieux.ny * mieux.ecart;
  }
  return [Math.round(dx * 10) / 10, Math.round(dy * 10) / 10];
}
// Colle au groupe de p toutes les pièces qui le touchent (sauf celles déjà collées avant : « avant »)
function collerTouchantes(plan, p, avant = new Set()) {
  const g = groupe(p), nous = membres(plan, p);
  nous.forEach(q => { q.groupe = g; });
  for (const q of plan.pieces) {
    if (groupe(q) === g || avant.has(q.id) || !nous.some(m => touche(m, q))) continue;
    const ancien = groupe(q);
    plan.pieces.forEach(r => { if (groupe(r) === ancien) r.groupe = g; });
  }
}
const touchantes = (plan, p) => new Set(plan.pieces.filter(q => groupe(q) !== groupe(p) && membres(plan, p).some(m => touche(m, q))).map(q => q.id));

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
    const L2 = d.larg / 2, cls = d.type === "fenetre" ? "pl-porte pl-fenetre" : "pl-porte";
    // pl-zone : surface invisible qui rend la porte facile à attraper au doigt
    s += `<g class="${cls}${sel && sel.id === d.id ? " sel" : ""}" transform="translate(${d.x} ${d.y}) rotate(${d.rot}) scale(${d.fx} ${d.fy})" data-k="porte" data-id="${d.id}">`
      + (d.type === "fenetre"
        ? `<rect class="pl-zone" x="${-L2}" y="-20" width="${d.larg}" height="40"/><rect class="pl-trou" x="${-L2}" y="-7" width="${d.larg}" height="14"/>
           <rect class="pl-vitre" x="${-L2}" y="-6" width="${d.larg}" height="12"/><line class="pl-vitre" x1="${-L2}" y1="0" x2="${L2}" y2="0"/>`
        : `<rect class="pl-zone" x="${-L2}" y="${-d.larg}" width="${d.larg}" height="${d.larg + 12}"/><rect class="pl-trou" x="${-L2}" y="-8" width="${d.larg}" height="16"/>
           <line class="pl-battant" x1="${-L2}" y1="0" x2="${-L2}" y2="${-d.larg}"/>`)   // battant en un seul trait (plus discret qu'un arc)
      + `</g>`;
  }
  for (const m of plan.meubles) {
    const cls = (o.focus && m.lien === o.focus ? " actif" : "") + (sel && sel.id === m.id ? " sel" : "");
    s += `<g class="pl-meuble${cls}" transform="translate(${m.x} ${m.y}) rotate(${m.rot})" data-k="meuble" data-id="${m.id}"${lien(m)}>${dessin(m.mod, m.w, m.h)}</g>`;
  }
  // Noms (toujours à l'horizontale) ; pas sur le plan de l'accueil ni dans « Voir l'endroit »
  const fs = 11 * k;
  if (!o.sansNoms) {
    for (const p of plan.pieces) {
      const t = nom(p.lien) || p.nom;
      if (t) { const [x, y] = centre(p.pts); s += `<text class="pl-nom" x="${x}" y="${y}" font-size="${fs * 1.1}">${esc(t)}</text>`; }
    }
    for (const m of plan.meubles) {
      const t = nom(m.lien) || m.nom;
      if (t) s += `<text class="pl-nom petit" x="${m.x}" y="${m.y}" font-size="${fs * .85}">${esc(t)}</text>`;
    }
  }
  // Poignées (mode Modifier)
  if (sel) {
    const r = 9 * k;
    if (sel.k === "piece") {
      const p = plan.pieces.find(x => x.id === sel.id);
      if (p) {
        // Murs : bande invisible pour les attraper + petite barre au milieu
        murs(p).forEach(([a, b], i) => {
          s += `<line class="pe-bord${sel.mur === i ? " choisi" : ""}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke-width="${22 * k}" data-k="bord" data-i="${i}"/>`;
          if (!o.angle) {
            const A = info([a, b]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, l = Math.min(14 * k, A.len / 3);
            s += `<line class="pe-barre" x1="${mx - A.ux * l}" y1="${my - A.uy * l}" x2="${mx + A.ux * l}" y2="${my + A.uy * l}" stroke-width="${6 * k}"/>`;
          }
        });
        if (o.angle) {
          const pts = paires(p.pts);
          pts.forEach(([x, y], i) => {
            const [x2, y2] = pts[(i + 1) % pts.length];
            s += `<circle class="pe-plus" cx="${(x + x2) / 2}" cy="${(y + y2) / 2}" r="${r * .6}" data-k="milieu" data-i="${i}"/>`;
          });
          pts.forEach(([x, y], i) => { s += `<circle class="pe-poignee${sel.coin === i ? " choisi" : ""}" cx="${x}" cy="${y}" r="${r}" data-k="coin" data-i="${i}"/>`; });
        }
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

// Plan en lecture seule (écran d'accueil, « Voir l'endroit »), tourné de rot degrés autour du
// centre du plan (comme une carte). Le cadre affiché = la boîte englobante du cadre tourné.
export function centrePlan(plan) { const b = boite(plan); return [b.x + b.w / 2, b.y + b.h / 2]; }
export function boiteTournee(b, rot, [cx, cy]) {
  const r = rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return bbox([[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]
    .map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]));
}
export function svgVue(plan, o, box, focus) {
  const c = centrePlan(plan), rot = o.rot || 0, k = Math.max(box.w / (o.W || 340), box.h / (o.H || 200));
  return `<svg class="plan-vue" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" preserveAspectRatio="xMidYMid meet" data-cx="${c[0]}" data-cy="${c[1]}" data-rot="${rot}">
    <g class="pl-rot" transform="rotate(${rot} ${c[0]} ${c[1]})">${contenuSVG(plan, { focus, k, nom: o.nom, sansNoms: true })}</g></svg>`;
}
export function vueHTML(plan, o) {
  const { focus, box } = cadrage(plan, o.chaine || []);
  return svgVue(plan, o, boiteTournee(box, o.rot || 0, centrePlan(plan)), focus);
}
export function apercuModele(mod) {
  const { w, h } = MODELES[mod];
  const b = marge({ x: -w / 2, y: -h / 2, w, h }, 6);
  return `<svg viewBox="${b.x} ${b.y} ${b.w} ${b.h}"><g class="pl-meuble">${dessin(mod, w, h)}</g></svg>`;
}

// ---------- Éditeur (mode « Modifier le plan ») ----------
// Un doigt sur le vide ou sur une pièce non choisie = déplacer la vue ; deux doigts = zoom.
// Pièce choisie : la tirer (avec ses pièces collées), tirer un mur pour l'agrandir.
// Bouton « Libre » : tirer les coins (aimantés, sans grille), « + » au milieu d'un mur pour ajouter un coin.
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
  const plan = normaliserPlan(planDepart) || nouveauPlan();
  plan.portes.forEach(d => { if (!d.piece) poserOuverture(plan, d, d.x, d.y); });   // portes d'avant la v0.4 : rattachées à leur mur
  recaler(plan);
  ed = { o, racine, svg: racine.querySelector(".pe-svg"), bas: racine.querySelector(".pe-bas"),
    plan, sel: null, angle: false, histo: [], vb: null, ptrs: new Map(), op: null, minuteur: null };
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
    + contenuSVG(ed.plan, { k, sel: ed.sel, nom: ed.o.nom, angle: ed.angle });
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
  ed.o.enregistrer(copie(ed.plan));
}

// Petite vibration quand quelque chose s'aimante (une fois par nouvel aimant)
function tic(op, cle) {
  if (cle && cle !== op.aimante) ed.o.vibrer?.("tic");
  op.aimante = cle;
}

// Coin en mode Libre : position libre, sauf si proche (12 px) d'un aimant, du plus fort au plus faible :
// un autre coin ; un coin exact formé par deux guides (angle droit / 45° depuis chaque voisin) ;
// un seul guide ; l'alignement horizontal / vertical avec un autre coin.
function aimanterCoin(plan, p, i, P, k) {
  const tol = 12 * k, pts = paires(p.pts), n = pts.length;
  const autres = [];
  plan.pieces.forEach(q => paires(q.pts).forEach((c, j) => { if (!(q.id === p.id && j === i)) autres.push(c); }));
  let mieux = null;
  for (const c of autres) { const d = Math.hypot(c[0] - P.x, c[1] - P.y); if (d < tol && (!mieux || d < mieux.d)) mieux = { d, x: c[0], y: c[1] }; }
  if (mieux) return { x: mieux.x, y: mieux.y, type: "coin" };
  // Guides : droites partant des deux coins voisins, à 0 / 45 / 90 / 135°, et à angle droit (ou dans le prolongement) du mur d'avant
  const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n], avantA = pts[(i - 2 + n) % n], apresB = pts[(i + 2) % n];
  const guides = [];
  for (const [O, Pr] of [[A, avantA], [B, apresB]]) {
    const angles = [0, 45, 90, 135].map(a => a * Math.PI / 180);
    if (n > 3) { const a0 = Math.atan2(O[1] - Pr[1], O[0] - Pr[0]); angles.push(a0, a0 + Math.PI / 2); }
    angles.forEach(a => guides.push({ O, ux: Math.cos(a), uy: Math.sin(a) }));
  }
  const proches = guides.map(g => {
    const t = (P.x - g.O[0]) * g.ux + (P.y - g.O[1]) * g.uy, x = g.O[0] + t * g.ux, y = g.O[1] + t * g.uy;
    return { g, x, y, d: Math.hypot(P.x - x, P.y - y) };
  }).filter(c => c.d < tol).sort((a, b) => a.d - b.d);
  for (const a of proches) for (const b of proches) {
    if (a.g.O === b.g.O) continue;
    const det = a.g.ux * b.g.uy - a.g.uy * b.g.ux;
    if (Math.abs(det) < 0.1) continue;
    const t = ((b.g.O[0] - a.g.O[0]) * b.g.uy - (b.g.O[1] - a.g.O[1]) * b.g.ux) / det;
    const x = a.g.O[0] + t * a.g.ux, y = a.g.O[1] + t * a.g.uy;
    if (Math.hypot(x - P.x, y - P.y) < tol * 1.5) return { x, y, type: "angles" };
  }
  if (proches.length) return { x: proches[0].x, y: proches[0].y, type: "angle" };
  let ax = null, ay = null;
  for (const [x, y] of autres) {
    if (Math.abs(x - P.x) < tol && (ax == null || Math.abs(x - P.x) < Math.abs(ax - P.x))) ax = x;
    if (Math.abs(y - P.y) < tol && (ay == null || Math.abs(y - P.y) < Math.abs(ay - P.y))) ay = y;
  }
  if (ax != null || ay != null) return { x: ax ?? P.x, y: ay ?? P.y, type: "aligne" };
  return { x: P.x, y: P.y, type: "" };
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
      if (ed.op?.avant) ed.plan = copie(ed.op.avant);   // 2e doigt : on annule le geste commencé
      ed.op = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, vb0: { ...ed.vb }, P0: versPlan(mx, my), memo: ed.op?.memo };
      return;
    }
    if (ed.ptrs.size > 2) return;
    const cible = e.target.closest("[data-k]");
    const P = versPlan(e.clientX, e.clientY);
    const op = { x0: e.clientX, y0: e.clientY, cible, P0: P, memo: JSON.stringify(ed.plan), bouge: false, avant: copie(ed.plan) };
    const k = cible?.dataset.k, id = cible?.dataset.id;
    if (k === "coin" || k === "milieu" || k === "bord") Object.assign(op, { type: k, i: +cible.dataset.i });
    else if (k === "taille" || k === "rot") op.type = k;
    else if (k === "meuble" || k === "porte") Object.assign(op, { type: "objet", k, id });
    else if (k === "piece" && ed.sel?.id === id) {
      // Pièce choisie : elle part avec ses pièces collées, les meubles posés dedans et leurs portes
      const p = objet({ k, id }), groupe = membres(ed.plan, p);
      const ids = new Set(groupe.map(q => q.id));
      Object.assign(op, { type: "objet", k, id, ids, touchaient: touchantes(ed.plan, p),
        meubles: new Set(ed.plan.meubles.filter(m => groupe.some(q => dansPoly(m.x, m.y, q.pts))).map(m => m.id)) });
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
      dessiner(); return;
    }
    const plan = ed.plan = copie(op.avant);   // chaque mouvement repart de l'état d'avant le geste
    if (op.type === "objet") {
      ed.sel = { ...(ed.sel?.id === op.id ? ed.sel : {}), k: op.k, id: op.id };
      const obj = objet(op);
      if (op.k === "meuble") { obj.x = aimant(obj.x + dx, PAS_MEUBLE); obj.y = aimant(obj.y + dy, PAS_MEUBLE); }
      else if (op.k === "porte") poserOuverture(plan, obj, obj.x + dx, obj.y + dy);
      else {
        const [mx, my] = aimantPieces(plan, op.ids, aimant(dx), aimant(dy));
        tic(op, mx !== aimant(dx) || my !== aimant(dy) ? `p${mx},${my}` : "");
        plan.pieces.forEach(q => { if (op.ids.has(q.id)) q.pts = q.pts.map((v, i) => Math.round((v + (i % 2 ? my : mx)) * 10) / 10); });
        plan.meubles.forEach(m => { if (op.meubles.has(m.id)) { m.x += mx; m.y += my; } });
        recaler(plan);
      }
    } else if (op.type === "bord") {
      const p = objet(), A = info(murs(p)[op.i]);
      let d = aimant(dx * A.nx + dy * A.ny, PAS_MEUBLE);
      // Aimant : le mur se pose sur un mur voisin parallèle (< 15 cm)
      const autres = plan.pieces.filter(q => groupe(q) !== groupe(p));
      let mieux = null;
      for (const q of autres) for (const t of murs(q)) {
        const B = info(t);
        if (!paralleles(A, B)) continue;
        const ecart = (B.a[0] - A.a[0]) * A.nx + (B.a[1] - A.a[1]) * A.ny;
        if (Math.abs(ecart - d) < 15 && (!mieux || Math.abs(ecart - d) < Math.abs(mieux - d))) mieux = ecart;
      }
      if (mieux != null) d = Math.round(mieux * 10) / 10;
      tic(op, mieux != null ? "b" + mieux : "");
      deplacerMur(plan, p, op.i, d);
      recaler(plan);
    } else if (op.type === "coin") {
      // Mode Libre : pas de grille, mais le coin s'aimante (coin voisin, angle droit, 45°, alignement)
      const p = objet(), a = aimanterCoin(plan, p, op.i, P, kEd());
      p.pts[2 * op.i] = Math.round(a.x * 10) / 10; p.pts[2 * op.i + 1] = Math.round(a.y * 10) / 10;
      ed.sel.coin = op.i;
      rattacher(plan, p.id);
      tic(op, a.type && a.type + a.x.toFixed(0) + a.y.toFixed(0));
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
        ed.sel.coin = i + 1; ed.sel.mur = null;
        rattacher(ed.plan, p.id);
      } else if (k === "coin") { ed.sel.coin = op.i; ed.sel.mur = null; }
      else if (k === "bord") { if (ed.angle) { ed.sel.mur = op.i; ed.sel.coin = null; } }
      else if (k === "meuble" || k === "porte" || k === "piece") ed.sel = { k, id: op.cible.dataset.id };
      else if (k !== "taille" && k !== "rot") ed.sel = null;
    } else if (op.bouge && (op.type === "objet" && op.k === "piece" || op.type === "bord")) {
      // Une pièce amenée contre une autre s'y colle
      const p = objet();
      if (p) collerTouchantes(ed.plan, p, op.type === "bord" ? touchantes(op.avant, op.avant.pieces.find(q => q.id === p.id)) : op.touchaient);
    }
    if (JSON.stringify(ed.plan) !== op.memo) { ed.histo.push(op.memo); changement(); }
    dessiner();
    if (!ed.racine.contains(document.activeElement) || document.activeElement === document.body || !op.bouge) panneau();
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
    if (e.target.id === "pe-cherche") { listeLiens(e.target.value); return; }
    if (!e.target.classList.contains("pe-nom")) return;
    const obj = objet();
    if (!obj) return;
    if (!ed.nomMemo) { memoriser(); ed.nomMemo = true; }
    obj.nom = e.target.value; dessiner(); changement();
  });
  // Dimensions tapées (validées par Entrée ou en quittant la case)
  ed.racine.addEventListener("change", e => {
    const champ = e.target.dataset.dim;
    if (!champ) return;
    const v = Math.round(parseFloat(String(e.target.value).replace(",", ".")));
    if (!(v >= 10 && v <= 10000)) { panneau(); return; }
    changerDimension(champ, v);
  });
}

function changerDimension(champ, v) {
  const obj = objet();
  if (!obj) return;
  memoriser();
  if (ed.sel.k === "meuble") { if (champ === "w") obj.w = v; else obj.h = v; }
  else if (ed.sel.k === "porte") { obj.larg = v; recalerUne(ed.plan, obj); }
  else if (champ === "mur") {
    // Longueur d'un mur (mode Libre) : on allonge depuis son début, la fin bouge
    const i = ed.sel.mur, n = obj.pts.length / 2, A = info(murs(obj)[i]), j = (i + 1) % n;
    obj.pts[2 * j] = Math.round((A.a[0] + A.ux * v) * 10) / 10; obj.pts[2 * j + 1] = Math.round((A.a[1] + A.uy * v) * 10) / 10;
    rattacher(ed.plan, obj.id);
  } else {
    // Rectangle : on déplace le mur de droite (largeur) ou du bas (longueur)
    const b = bbox(paires(obj.pts)), cote = champ === "w" ? 0 : 1, actuel = champ === "w" ? b.w : b.h;
    const i = murs(obj).findIndex(([a, c]) => cote === 0 ? Math.abs(a[0] - c[0]) < .5 && Math.abs(a[0] - (b.x + b.w)) < .5 : Math.abs(a[1] - c[1]) < .5 && Math.abs(a[1] - (b.y + b.h)) < .5);
    if (i >= 0) {
      const A = info(murs(obj)[i]), sens = cote === 0 ? Math.sign(A.nx) : Math.sign(A.ny);
      deplacerMur(ed.plan, obj, i, (v - actuel) * sens);
      recaler(ed.plan);
    }
  }
  changement(); dessiner(); panneau();
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
    const p = { id: nid(), pts: [c.x - d, c.y - d, c.x + d, c.y - d, c.x + d, c.y + d, c.x - d, c.y + d], nom: "", lien: "", groupe: "" };
    ed.plan.pieces.push(p); ed.sel = { k: "piece", id: p.id };
  } else if (a === "porte" || a === "fenetre") {
    memoriser();
    const c = centreVue(), d = { id: nid(), type: a, x: c.x, y: c.y, rot: 0, larg: a === "fenetre" ? 100 : 80, fx: 1, fy: 1, piece: "", seg: 0, o: 0 };
    poserOuverture(ed.plan, d, c.x, c.y, null);
    if (!d.piece && ed.plan.pieces.length) poserOuverture(ed.plan, d, c.x, c.y, ed.plan.pieces.reduce((m, p) => {   // sinon : sur la pièce la plus proche du centre
      const [x, y] = centre(p.pts), dist = Math.hypot(x - c.x, y - c.y);
      return !m || dist < m.dist ? { dist, id: p.id } : m;
    }, null).id);
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
    if (ed.sel.k === "piece") ed.plan.portes = ed.plan.portes.filter(d => d.piece !== obj.id);
    ed.sel = null;
  } else if (a === "dupliquer" && obj) {
    memoriser();
    const c = copie(obj); c.id = nid(); c.lien = "";
    if (ed.sel.k === "piece") { c.pts = c.pts.map(v => v + 30); c.groupe = ""; ed.plan.pieces.push(c); }
    else if (ed.sel.k === "porte") { ed.plan.portes.push(c); c.o += c.larg + 20; recalerUne(ed.plan, c); }
    else { c.x += 30; c.y += 30; ed.plan.meubles.push(c); }
    ed.sel = { k: ed.sel.k, id: c.id };
  } else if (a === "tourner" && obj) { memoriser(); obj.rot = (obj.rot + 90) % 360; }
  else if (a === "retourner" && obj) {
    memoriser();
    const etats = [[1, 1], [-1, 1], [-1, -1], [1, -1]], i = etats.findIndex(([x, y]) => x === obj.fx && y === obj.fy);
    [obj.fx, obj.fy] = etats[(i + 1) % 4];
  } else if (a === "angles") { ed.angle = !ed.angle; if (ed.sel) { ed.sel.coin = null; ed.sel.mur = null; } }
  else if (a === "retirer-coin" && obj && ed.sel.coin != null && obj.pts.length > 6) {
    memoriser(); obj.pts.splice(2 * ed.sel.coin, 2); ed.sel.coin = null; rattacher(ed.plan, obj.id);
  } else if (a === "coller" && obj) { memoriser(); collerTouchantes(ed.plan, obj); }
  else if (a === "dissocier" && obj) { memoriser(); obj.groupe = nid(); }
  else if (a === "relier") { listeLiens(""); return; }
  else if (a === "lien" && obj) { memoriser(); obj.lien = b.dataset.id; }
  else return;
  changement(); dessiner(); panneau();
}

// Barre du bas : outils d'ajout, ou réglages de ce qui est choisi
const m2 = cm2 => (cm2 / 10000).toFixed(1).replace(".", ",") + " m²";
const champDim = (cle, v) => `<input class="pe-dim" type="number" inputmode="numeric" min="10" max="10000" data-dim="${cle}" value="${Math.round(v)}">`;
function panneau() {
  ed.nomMemo = false;
  const obj = objet(), s = ed.sel;
  if (!obj) {
    ed.sel = null;
    ed.bas.innerHTML = `<div class="pe-ligne">
      <button class="btn" data-pe="piece">${ic("polygon")}Pièce</button>
      <button class="btn" data-pe="porte">${ic("door")}Porte</button>
      <button class="btn" data-pe="fenetre">${ic("fenetre")}Fenêtre</button>
      <button class="btn" data-pe="meuble">${ic("meuble")}Meuble</button></div>`;
    return;
  }
  const nomLien = obj.lien ? ed.o.nom(obj.lien) : "";
  const haut = s.k === "porte" ? "" : `<div class="pe-ligne">
      <input class="pe-nom" placeholder="${s.k === "piece" ? "Nom de la pièce" : esc(MODELES[obj.mod].nom)}" value="${esc(obj.nom)}" maxlength="40">
      <button class="btn pe-relier" data-pe="relier">${ic("link")}<span>${nomLien ? esc(nomLien) : "Relier"}</span></button></div>`;
  let dims = "";
  if (s.k === "meuble") dims = `<div class="pe-dims">${champDim("w", obj.w)}<span>×</span>${champDim("h", obj.h)}<span>cm</span></div>`;
  else if (s.k === "piece") {
    const surface = `<span class="pe-m2">${m2(aire(obj.pts))}</span>`;
    if (ed.angle && s.mur != null && s.mur < obj.pts.length / 2) dims = `<div class="pe-dims"><span>Mur</span>${champDim("mur", info(murs(obj)[s.mur]).len)}<span>cm</span>${surface}</div>`;
    else if (estRectangle(obj)) { const b = bbox(paires(obj.pts)); dims = `<div class="pe-dims">${champDim("w", b.w)}<span>×</span>${champDim("h", b.h)}<span>cm</span>${surface}</div>`; }
    else dims = `<div class="pe-dims"><span>${ed.angle ? "Touche un mur pour sa longueur" : "Forme libre"}</span>${surface}</div>`;
  }
  const outils = [];
  if (s.k === "piece") {
    const colle = membres(ed.plan, obj).length > 1;
    outils.push(`<button class="btn" data-pe="angles" aria-pressed="${ed.angle}">${ic("polygon")}Libre</button>`);
    if (ed.angle && s.coin != null && obj.pts.length > 6) outils.push(`<button class="btn" data-pe="retirer-coin">${ic("x")}Coin</button>`);
    else outils.push(colle ? `<button class="btn" data-pe="dissocier">${ic("unlink")}Dissocier</button>`
      : `<button class="btn" data-pe="coller"${touchantes(ed.plan, obj).size ? "" : " disabled"}>${ic("link")}Coller</button>`);
  }
  if (s.k === "meuble") outils.push(`<button class="btn" data-pe="tourner">${ic("rotate")}90°</button>`);
  if (s.k === "porte") {
    outils.push(`<div class="pe-dims">${champDim("larg", obj.larg)}<span>cm</span></div>`);
    if (obj.type === "porte") outils.push(`<button class="btn" data-pe="retourner">${ic("rotate")}Sens</button>`);
  }
  outils.push(`<button class="btn" data-pe="dupliquer" aria-label="Dupliquer">${ic("copy")}</button>`, `<button class="btn danger" data-pe="supprimer" aria-label="Supprimer">${ic("trash")}</button>`);
  ed.bas.innerHTML = haut + dims + `<div class="pe-ligne">${outils.join("")}</div>`;
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
