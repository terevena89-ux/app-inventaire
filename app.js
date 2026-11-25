// =========================================================
// Inventaire — où sont rangés mes objets.
//   1. Base et données   2. Stockage   3. Arbre (qui est dans quoi)
//   4. Navigation        5. Affichage  6. Actions   7. Glisser
//   8. Excel             9. Démarrage
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, setDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { ajouterFeuille, telechargerClasseur, lireClasseur, chargerExcelJS } from "./excel-style.js";
import { normaliserPlan, planVide, vueHTML, ouvrirEditeur, fermerEditeur, editeurOuvert } from "./plan.js";

// ---------- 1. Base et données ----------

const VERSION = "v0.4.0";
const NOM_APPLI = "app-inventaire";

// Tout est un « élément » (lieu, pièce, meuble, boîte, objet) rangé dans un autre (parent).
// Le type ne sert qu'à l'icône et au type proposé à l'ajout : n'importe quoi peut contenir n'importe quoi.
// Élément = { id, nom, type, parent, note, tags[], photo, historique[{ de, le }], cree }
//   historique : anciens emplacements (chemin en texte, car l'ancien contenant a pu être supprimé)
const TYPES = {
  lieu:   { nom: "Lieu",   ic: "home" },
  piece:  { nom: "Pièce",  ic: "door" },
  meuble: { nom: "Meuble", ic: "meuble" },
  case:   { nom: "Case",   ic: "case" },    // compartiment d'un meuble (étagère, tiroir…) : vue de face
  boite:  { nom: "Boîte",  ic: "box" },
  objet:  { nom: "Objet",  ic: "objet" }
};
const ORDRE_TYPES = Object.keys(TYPES);
const TYPE_PROPOSE = { "": "lieu", lieu: "piece", piece: "meuble", meuble: "boite", case: "objet", boite: "objet", objet: "objet" };
const MAX_HISTO = 20;

let elements = new Map();     // id -> élément
let donnees = { idees: "" };  // document général (Réglages › Notes)

const CLE_REGLAGES = "inv-reglages";
let reglages = { theme: "auto", animations: "completes" };
try { Object.assign(reglages, JSON.parse(localStorage.getItem(CLE_REGLAGES)) || {}); } catch (e) { /* défauts */ }
function changerReglage(nom, valeur) {
  reglages[nom] = valeur;
  try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(reglages)); } catch (e) { /* stockage bloqué */ }
}

const $ = id => document.getElementById(id);
const PLANCHE = "icones/icones.svg#";
const icone = nom => `<svg class="ic"><use href="${PLANCHE}${nom}"></use></svg>`;
const nouvelId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const simplifier = t => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const echapper = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dateCourte = ms => ms ? new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
const triNom = (a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true, sensitivity: "base" });

function normaliser(id, d) {
  return {
    id,
    nom: String(d.nom || "").trim() || "Sans nom",
    type: TYPES[d.type] ? d.type : "objet",
    parent: String(d.parent || ""),
    note: String(d.note || ""),
    tags: Array.isArray(d.tags) ? [...new Set(d.tags.map(t => String(t).trim()).filter(Boolean))] : [],
    photo: typeof d.photo === "string" && d.photo.startsWith("data:image/") ? d.photo : "",
    historique: Array.isArray(d.historique)
      ? d.historique.filter(h => h && typeof h.de === "string").map(h => ({ de: h.de, le: Number(h.le) || 0 })).slice(-MAX_HISTO) : [],
    cree: Number(d.cree) || 0,
    plan: normaliserPlan(d.plan),        // seulement pour un lieu (plan.js)
    facade: normaliserFacade(d.facade)   // seulement pour un meuble (vue de face)
  };
}
// Façade = colonnes de cases empilées : { cols: [{ w, cases: [{ id, h, genre }] }] }
// id = l'élément « Case » (enfant du meuble) ; w / h = largeur / hauteur relatives (1 à 3).
const GENRES = { etagere: "Étagère", tiroir: "Tiroir", penderie: "Penderie", porte: "Porte", dessus: "Dessus", dessous: "Dessous" };
function normaliserFacade(f) {
  if (!f || !Array.isArray(f.cols)) return null;
  const t = v => Math.min(3, Math.max(1, Math.round(Number(v) || 1)));
  const cols = f.cols.filter(c => c && Array.isArray(c.cases)).map(c => ({
    w: t(c.w), cases: c.cases.filter(k => k && k.id).map(k => ({ id: String(k.id), h: t(k.h), genre: GENRES[k.genre] ? k.genre : "etagere" }))
  })).filter(c => c.cases.length);
  return cols.length ? { cols } : null;
}

// ---------- 2. Stockage ----------
//   users/{uid}/app-inventaire/donnees                 -> { idees }
//   users/{uid}/app-inventaire/donnees/elements/{id}   -> un élément (une photo pèse jusqu'à ~60 Ko)
// Hors ligne : Firestore garde les écritures et les envoie au retour du réseau. Conflit : la dernière gagne.
// Mode démo (adresse …?demo) : tout dans ce navigateur, sans compte (pour tester).
const MODE_DEMO = new URLSearchParams(location.search).has("demo");

let db = null, auth = null, uid = null;
const refDonnees = () => doc(db, "users", uid, NOM_APPLI, "donnees");
const refElement = id => doc(db, "users", uid, NOM_APPLI, "donnees", "elements", id);

function erreurEcriture(err) { console.error(err); afficherToast("Échec de l'enregistrement", null); }
const pourEnvoi = e => { const { id, ...reste } = e; return { ...reste, maj: serverTimestamp() }; };

function ecrire(liste) {
  liste.forEach(e => elements.set(e.id, e));
  rafraichir();
  if (MODE_DEMO) { sauverDemo(); return; }
  for (let i = 0; i < liste.length; i += 400) {   // un paquet Firestore = 500 opérations max
    const lot = writeBatch(db);
    liste.slice(i, i + 400).forEach(e => lot.set(refElement(e.id), pourEnvoi(e)));
    lot.commit().catch(erreurEcriture);
  }
}
function effacer(ids) {
  ids.forEach(id => elements.delete(id));
  rafraichir();
  if (MODE_DEMO) { sauverDemo(); return; }
  for (let i = 0; i < ids.length; i += 400) {
    const lot = writeBatch(db);
    ids.slice(i, i + 400).forEach(id => lot.delete(refElement(id)));
    lot.commit().catch(erreurEcriture);
  }
}
function sauverDonnees() {
  if (MODE_DEMO) { sauverDemo(); return; }
  setDoc(refDonnees(), { ...donnees, maj: serverTimestamp() }).catch(erreurEcriture);
}
function sauverDemo() {
  try { localStorage.setItem("inv-demo", JSON.stringify({ donnees, elements: [...elements.values()] })); }
  catch (e) { afficherToast("Mémoire du navigateur pleine", null); }
}
function demarrerDemo() {
  try {
    const d = JSON.parse(localStorage.getItem("inv-demo")) || {};
    donnees = { idees: String(d.donnees?.idees || "") };
    elements = new Map((d.elements || []).map(e => [e.id, normaliser(e.id, e)]));
  } catch (e) { /* on part de zéro */ }
  $("compte-info").textContent = "Mode démo : données sur cet appareil seulement.";
  majSynchro();
  indexer();
  router();
}

let metaDonnees = null, metaElements = null;
function demarrerFirebase() {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  onAuthStateChanged(auth, user => {
    if (!user) { montrer("connexion"); return; }
    uid = user.uid;
    $("compte-info").textContent = `Connecté : ${user.displayName || user.email}`;
    onSnapshot(refDonnees(), { includeMetadataChanges: true }, snap => {
      metaDonnees = snap.metadata; majSynchro();
      if (snap.exists()) {
        donnees = { idees: String(snap.data().idees || "") };
        NotesIdees.maj(donnees.idees);
      }
    });
    let charge = false;
    onSnapshot(collection(db, "users", uid, NOM_APPLI, "donnees", "elements"), { includeMetadataChanges: true }, snap => {
      metaElements = snap.metadata; majSynchro();
      // Copie locale vide au tout premier lancement ≠ « rien du tout » : on attend le serveur
      if (snap.empty && snap.metadata.fromCache && !charge) return;
      elements = new Map(snap.docs.map(d => [d.id, normaliser(d.id, d.data())]));
      if (!charge) { charge = true; indexer(); router(); } else rafraichir();
    });
  });
}

async function seConnecter() {
  const fournisseur = new GoogleAuthProvider();
  $("connexion-erreur").hidden = true;
  try { await signInWithPopup(auth, fournisseur); }
  catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") signInWithRedirect(auth, fournisseur);
    else if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      $("connexion-erreur").textContent = "Connexion impossible : " + err.message;
      $("connexion-erreur").hidden = false;
    }
  }
}

function majSynchro() {
  let classe = "ok", ic = "cloud-check", texte = "Synchronisé";
  if (MODE_DEMO) { classe = "off"; ic = "cloud-off"; texte = "Mode démo"; }
  else if (!navigator.onLine) { classe = "off"; ic = "cloud-off"; texte = "Hors ligne"; }
  else if (metaDonnees?.hasPendingWrites || metaElements?.hasPendingWrites) { classe = "attente"; ic = "cloud-up"; texte = "En attente d'envoi"; }
  document.querySelectorAll(".synchro").forEach(el => {
    el.className = "synchro " + classe;
    el.querySelector("use").setAttribute("href", PLANCHE + ic);
    el.querySelector(".synchro-texte").textContent = texte;
  });
}
window.addEventListener("online", majSynchro);
window.addEventListener("offline", majSynchro);

// ---------- 3. Arbre ----------
// Index « parent -> enfants », refait à chaque changement. Un élément dont le parent
// n'existe plus (supprimé sur l'autre appareil) remonte tout en haut au lieu de disparaître.
let parParent = new Map();
function indexer() {
  parParent = new Map();
  for (const e of elements.values()) {
    const p = elements.has(e.parent) && e.parent !== e.id ? e.parent : "";
    if (!parParent.has(p)) parParent.set(p, []);
    parParent.get(p).push(e);
  }
  // Contenants d'abord (par type), puis objets ; alphabétique dans chaque groupe
  for (const [pid, l] of parParent) {
    l.sort((a, b) => (estContenant(b) - estContenant(a)) || (ORDRE_TYPES.indexOf(a.type) - ORDRE_TYPES.indexOf(b.type)) || triNom(a, b));
    // Cases d'un meuble : dans l'ordre de la façade (colonne par colonne, de haut en bas)
    const f = elements.get(pid)?.facade;
    if (f) {
      const rang = new Map(f.cols.flatMap(c => c.cases.map(k => k.id)).map((id, i) => [id, i]));
      l.sort((a, b) => (rang.get(a.id) ?? 1e9) - (rang.get(b.id) ?? 1e9));
    }
  }
}
const enfants = id => parParent.get(id) || [];
const estContenant = e => e.type !== "objet" || enfants(e.id).length > 0;
function ancetres(e) {   // du plus haut au parent direct ; garde-fou contre une boucle
  const l = [], vus = new Set([e.id]);
  let p = elements.get(e.parent);
  while (p && !vus.has(p.id)) { vus.add(p.id); l.unshift(p); p = elements.get(p.parent); }
  return l;
}
const cheminTexte = e => ancetres(e).map(a => a.nom).join(" › ");
const cheminComplet = e => [...ancetres(e), e].map(a => a.nom).join(" › ");
function descendants(id) {
  const out = [], pile = [id], vus = new Set([id]);
  while (pile.length) for (const k of enfants(pile.pop())) if (!vus.has(k.id)) { vus.add(k.id); out.push(k.id); pile.push(k.id); }
  return out;
}

// ---------- 4. Navigation ----------
// Chaque écran a son adresse (#dans=ID, #fiche=ID, #reglages…) : le bouton retour du
// téléphone remonte d'un cran ou ferme la fenêtre ouverte.
let dansId = "";
let aNavigue = false;
function aller(adresse) { aNavigue = true; location.hash = adresse; }
function remplacer(adresse) { location.replace("#" + adresse); }
function retour() { if (aNavigue) history.back(); else remplacer(""); }

const MODALES = ["reglages", "theme"];
function montrer(nom) {
  document.querySelectorAll(".ecran").forEach(e => {
    const n = e.id.slice(6);
    e.hidden = !(n === nom || (n === "accueil" && MODALES.includes(nom)));
  });
}

let voileType = "", voileId = "";
function ouvrirVoile(html, type, id = "") {
  $("voile").innerHTML = `<div class="feuille">${html}</div>`;
  $("voile").hidden = false;
  voileType = type; voileId = id;
}
function fermerVoile() { $("voile").hidden = true; $("voile").innerHTML = ""; voileType = voileId = ""; form = null; }

function router() {
  if (!MODE_DEMO && !uid) return;
  const h = decodeURIComponent(location.hash.slice(1));
  const [cle, val = ""] = h.split("=");
  if (MODALES.includes(cle)) {
    fermerVoile(); montrer(cle);
    if (cle === "reglages") afficherReglages(); else afficherTheme();
    return;
  }
  montrer("accueil");
  if (cle === "dans") dansId = elements.has(val) ? val : "";
  else if (!cle) dansId = "";
  if (cle === "plan") { fermerVoile(); ouvrirPlan(val); }
  else fermerEditeur();
  afficherAccueil();
  if (cle === "fiche") { if (voileType !== "fiche" || voileId !== val) ouvrirFiche(val); }
  else if (cle === "modifier") { if (voileType !== "form") ouvrirFormulaire(elements.get(val), null); }
  else if (cle === "ajouter") { if (voileType !== "form") ouvrirFormulaire(null, elements.has(val) ? val : ""); }
  else if (cle === "deplacer") { if (voileType !== "deplacer") ouvrirDeplacer(val); }
  else if (cle === "modeles") { if (voileType !== "modeles") ouvrirModeles(); }
  else if (cle === "case") { const [ci, ki] = val.split("-").map(Number); if (voileType !== "case") ouvrirCase(ci, ki); }
  else if (cle !== "plan") fermerVoile();
}

// Mode « Modifier le plan » (plein écran, plan.js). Chaque changement est enregistré dans le lieu.
function ouvrirPlan(id) {
  const lieu = elements.get(id);
  if (!lieu) { remplacer(""); return; }
  if (editeurOuvert()) return;
  ouvrirEditeur(lieu.plan, {
    titre: lieu.nom,
    nom: i => elements.get(i)?.nom || "",
    candidats: () => descendants(id).map(i => elements.get(i)).filter(estContenant).map(e => ({
      id: e.id, nom: e.nom, ic: TYPES[e.type].ic, chemin: cheminTexte(e),
      texte: simplifier(e.nom + " " + cheminTexte(e))
    })).sort((a, b) => a.chemin.localeCompare(b.chemin, "fr") || a.nom.localeCompare(b.nom, "fr")),
    enregistrer: plan => { const l = elements.get(id); if (l) ecrire([{ ...l, plan }]); },
    fermer: () => retour()
  });
}

// ---------- Vue de face d'un meuble ----------
// Modèles : colonnes [largeur, [genre, hauteur], …]. Les noms sont numérotés par genre.
const MODELES_FACADE = {
  etageres: { nom: "Étagères", cols: [[1, ["etagere", 1], ["etagere", 1], ["etagere", 1], ["etagere", 1]]] },
  tiroirs:  { nom: "Tiroirs", cols: [[1, ["tiroir", 1], ["tiroir", 1], ["tiroir", 1]]] },
  commode:  { nom: "Commode 2 colonnes", cols: [[1, ["tiroir", 1], ["tiroir", 1], ["tiroir", 1]], [1, ["tiroir", 1], ["tiroir", 1], ["tiroir", 1]]] },
  penderie: { nom: "Penderie + étagères", cols: [[2, ["penderie", 3]], [1, ["etagere", 1], ["etagere", 1], ["etagere", 1]]] },
  placard:  { nom: "Placard 2 portes", cols: [[1, ["etagere", 1], ["etagere", 1], ["etagere", 1]], [1, ["etagere", 1], ["etagere", 1], ["etagere", 1]]] },
  lit:      { nom: "Lit", cols: [[1, ["dessus", 2], ["dessous", 1]]] },
  bureau:   { nom: "Bureau", cols: [[2, ["dessus", 1], ["dessous", 2]], [1, ["tiroir", 1], ["tiroir", 1], ["tiroir", 1]]] }
};
const UNIQUES = ["penderie", "dessus", "dessous"];   // pas de numéro pour la 1re
function nomCase(genre, deja) {
  const n = deja.filter(g => g === genre).length + 1;
  return UNIQUES.includes(genre) && n === 1 ? GENRES[genre] : `${GENRES[genre]} ${n}`;
}

let facadeEdition = "";   // id du meuble dont on modifie la façade (rien = consultation)
function trouverFacade(cur) {
  if (!cur) return null;
  const chaine = [cur, ...ancetres(cur).reverse()];
  const i = chaine.findIndex(x => x.facade || (x === cur && x.type === "meuble"));
  if (i < 0) return null;
  return { meuble: chaine[i], focus: i > 0 ? chaine[i - 1].id : "" };
}
// Cases encore valables (élément existant et toujours rangé dans ce meuble)
function colonnesValides(m) {
  return (m.facade?.cols || []).map(c => ({ ...c, cases: c.cases.filter(k => elements.get(k.id)?.parent === m.id) })).filter(c => c.cases.length);
}
function facadeHTML(cols, o = {}) {
  const lignes = Math.max(...cols.map(c => c.cases.reduce((s, k) => s + k.h, 0)));
  const H = o.mini ? 64 : Math.min(300, Math.max(130, lignes * 44));
  return `<div class="fa-cadre${o.edition ? " edition" : ""}${o.mini ? " mini" : ""}" style="height:${H}px">` + cols.map((c, ci) => `<div class="fa-col" style="flex:${c.w}">`
    + c.cases.map((k, ki) => {
      const e = elements.get(k.id), kids = o.mini ? [] : enfants(k.id);
      return `<div class="fa-case g-${k.genre}${k.id && k.id === o.focus ? " actif" : ""}" style="flex:${k.h}"${o.mini ? "" : ` data-case="${k.id}" data-ci="${ci}" data-ki="${ki}"`}>
        <span class="fa-nom">${echapper(o.mini ? "" : e?.nom)}</span>
        ${kids.length ? `<div class="fa-contenu">${kids.map(x => `<span class="fa-boite${estContenant(x) ? " contenant" : ""}" data-ouvre="${x.id}">${x.photo ? `<img src="${x.photo}" alt="">` : ""}${echapper(x.nom)}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("")
    + (o.edition ? `<button class="fa-plus" data-fa="ajout-case" data-ci="${ci}" aria-label="Ajouter une case">${icone("plus")}</button>` : "")
    + `</div>`).join("") + `</div>`;
}
function afficherFacade({ meuble, focus }) {
  const zone = $("facade"), cols = colonnesValides(meuble);
  if (!cols.length) {
    zone.innerHTML = `<button class="plan-nouveau" data-fa="modele">${icone("case")}Vue de face</button>`;
    return;
  }
  if (reglages.planReplie && facadeEdition !== meuble.id) {
    zone.innerHTML = `<button class="plan-replie" data-action="plan-replier"><span class="h4">Vue de face</span>${icone("chevron-down")}</button>`;
    return;
  }
  const edition = facadeEdition === meuble.id;
  zone.innerHTML = facadeHTML(cols, { focus, edition })
    + (edition
      ? `<div class="fa-barre"><button class="btn" data-fa="colonne">${icone("plus")}Colonne</button><button class="btn" data-fa="modele">Modèle</button><button class="btn plein" data-fa="fini">${icone("check")}OK</button></div>`
      : `<div class="plan-outils"><button class="btn-icone petit" data-fa="modifier" aria-label="Modifier la façade">${icone("pencil")}</button>
         <button class="btn-icone petit" data-action="plan-replier" aria-label="Replier">${icone("chevron-up")}</button></div>`);
}
const meubleFacade = () => trouverFacade(elements.get(dansId))?.meuble;

// Nouvelle case (élément « Case » rangé dans le meuble)
function nouvelleCase(m, genre, deja) {
  return { id: nouvelId(), nom: nomCase(genre, deja), type: "case", parent: m.id, note: "", tags: [], photo: "", historique: [], cree: Date.now(), plan: null, facade: null };
}
const genresDe = cols => cols.flatMap(c => c.cases.map(k => k.genre));

function appliquerModele(cle) {
  const m = meubleFacade();
  if (!m) return;
  const anciennes = colonnesValides(m).flatMap(c => c.cases.map(k => k.id));
  if (anciennes.length && !confirm("Remplacer la façade ? Le contenu des cases actuelles reviendra dans le meuble.")) return;
  // Les anciennes cases disparaissent ; leur contenu revient dans le meuble
  const sortis = anciennes.flatMap(id => enfants(id)).map(x => ({ ...x, parent: m.id }));
  const genres = [], nouvelles = [];
  const cols = MODELES_FACADE[cle].cols.map(([w, ...cases]) => ({
    w, cases: cases.map(([genre, h]) => { const c = nouvelleCase(m, genre, genres); genres.push(genre); nouvelles.push(c); return { id: c.id, h, genre }; })
  }));
  if (anciennes.length) effacer(anciennes);
  ecrire([{ ...m, facade: { cols } }, ...nouvelles, ...sortis]);
  facadeEdition = m.id;
  retour();
}
function ouvrirModeles() {
  ouvrirVoile(`<div class="f-tete"><h2>Vue de face</h2><button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="fa-modeles">${Object.entries(MODELES_FACADE).map(([k, md]) => `<button data-modele="${k}">
      ${facadeHTML(md.cols.map(([w, ...cs]) => ({ w, cases: cs.map(([genre, h]) => ({ id: "", h, genre })) })), { mini: true })}<span>${md.nom}</span></button>`).join("")}</div>`, "modeles");
}

// Réglages d'une case (mode modifier) : nom, genre, hauteur, largeur de sa colonne
function ouvrirCase(ci, ki) {
  const m = meubleFacade(), cols = colonnesValides(m), k = cols[ci]?.cases[ki];
  if (!k) return;
  const e = elements.get(k.id);
  const seg = (nom, val) => [1, 2, 3].map(v => `<button data-${nom}="${v}" aria-pressed="${v === val}">${["Petite", "Moyenne", "Grande"][v - 1]}</button>`).join("");
  ouvrirVoile(`<div class="f-tete"><h2>Case</h2><button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <input id="c-nom" class="champ" value="${echapper(e.nom)}" maxlength="40" placeholder="Nom">
    <div class="c-genres">${Object.entries(GENRES).map(([g, n]) => `<button data-genre="${g}" aria-pressed="${g === k.genre}">${n}</button>`).join("")}</div>
    <div class="reg-mini"><span>Hauteur</span><div class="seg">${seg("haut", k.h)}</div></div>
    <div class="reg-mini"><span>Largeur</span><div class="seg">${seg("larg", cols[ci].w)}</div></div>
    <div class="f-actions"><button class="btn" data-action="case-dessous">${icone("plus")}Case dessous</button>
      <button class="btn danger" data-action="case-suppr">${icone("trash")}Supprimer</button></div>`, "case", k.id);
  form = { ci, ki };
}
// Modifie la façade du meuble ouvert (cols = copie valide) puis enregistre
function majFacade(change, extra = []) {
  const m = meubleFacade();
  if (!m) return;
  const cols = JSON.parse(JSON.stringify(colonnesValides(m)));
  change(cols, m);
  ecrire([{ ...m, facade: normaliserFacade({ cols }) }, ...extra]);
}
function supprimerCase(id) {
  const m = meubleFacade(), e = elements.get(id);
  if (!m || !e) return;
  const copies = [elements.get(m.id), e, ...enfants(id)];
  const sortis = enfants(id).map(x => ({ ...x, parent: m.id }));
  majFacade(cols => cols.forEach(c => { c.cases = c.cases.filter(k => k.id !== id); }), sortis);
  effacer([id]);
  retour();
  afficherToast(`${e.nom} supprimée`, () => ecrire(copies));
}

// Plan au-dessus de la liste : celui du lieu (élément tout en haut), recentré sur la pièce reliée
function afficherPlan(cur) {
  const zone = $("plan");
  const lieu = cur ? (ancetres(cur)[0] || cur) : null;
  if (!lieu || (planVide(lieu.plan) && cur.id !== lieu.id)) { zone.hidden = true; return; }
  zone.hidden = false;
  if (planVide(lieu.plan)) {
    zone.className = "plan-zone vide";
    zone.innerHTML = `<button class="plan-nouveau" data-plan-edit="${lieu.id}">${icone("pencil")}Dessiner le plan</button>`;
    return;
  }
  zone.className = "plan-zone";
  if (reglages.planReplie) {
    zone.innerHTML = `<button class="plan-replie" data-action="plan-replier"><span class="h4">Plan</span>${icone("chevron-down")}</button>`;
    return;
  }
  const chaine = [cur, ...ancetres(cur).reverse()].map(x => x.id);
  zone.innerHTML = vueHTML(lieu.plan, { chaine, nom: i => elements.get(i)?.nom || "", W: zone.clientWidth || 360, H: 230 })
    + `<div class="plan-outils"><button class="btn-icone petit" data-plan-edit="${lieu.id}" aria-label="Modifier le plan">${icone("pencil")}</button>
       <button class="btn-icone petit" data-action="plan-replier" aria-label="Replier">${icone("chevron-up")}</button></div>`;
}
window.addEventListener("hashchange", router);

// Données changées (ici ou sur l'autre appareil) : on redessine sans fermer ce qui est ouvert
function rafraichir() {
  indexer();
  if ($("ecran-accueil").hidden) return;
  afficherAccueil();
  if (voileType === "fiche") { if (elements.has(voileId)) ouvrirFiche(voileId); else retour(); }
}

// ---------- 5. Affichage ----------

const vignette = e => e.photo
  ? `<img class="vign" src="${e.photo}" alt="">`
  : `<span class="vign t-${e.type}">${icone(TYPES[e.type].ic)}</span>`;

function ligneHTML(e, avecChemin) {
  const kids = enfants(e.id), cont = estContenant(e);
  const sous = avecChemin ? (cheminTexte(e) || "Tout en haut") : kids.map(k => k.nom).join(", ");
  return `<div class="ligne${cont ? " contenant" : ""}" data-id="${e.id}">${vignette(e)}
    <div class="l-txt"><span class="l-nom">${echapper(e.nom)}</span>${sous ? `<span class="l-sous">${echapper(sous)}</span>` : ""}</div>
    ${cont && !avecChemin ? icone("chevron-right") : ""}</div>`;
}

let aSurligner = "";
function afficherAccueil() {
  const q = $("recherche").value.trim();
  $("effacer-recherche").hidden = !q;
  if (q) { $("plan").hidden = $("facade").hidden = true; afficherResultats(q); return; }
  const cur = elements.get(dansId);
  // Dans un meuble (ou une de ses cases) : sa façade à la place du plan
  const fac = trouverFacade(cur);
  $("facade").hidden = !fac;
  if (fac) { $("plan").hidden = true; afficherFacade(fac); } else afficherPlan(cur);
  const fil = cur ? [...ancetres(cur), cur] : [];
  $("fil").hidden = false;
  $("fil").innerHTML = `<button class="fil-bout" data-dans="">${icone("home")}Tout</button>`
    + fil.map(a => `<span class="sep">›</span><button class="fil-bout" data-dans="${a.id}">${echapper(a.nom)}</button>`).join("");
  $("fil").scrollLeft = $("fil").scrollWidth;
  $("courant").hidden = !cur;
  if (cur) {
    const infos = [TYPES[cur.type].nom, ...cur.tags].join(" · ");
    $("courant").innerHTML = `${vignette(cur)}<div class="c-txt"><b>${echapper(cur.nom)}</b><span>${echapper(infos)}${cur.note ? " · " + echapper(cur.note) : ""}</span></div>
      <button class="btn-icone" data-fiche="${cur.id}" aria-label="Fiche">${icone("dots")}</button>`;
  }
  const liste = enfants(dansId);
  $("liste").innerHTML = liste.length ? liste.map(e => ligneHTML(e, false)).join("")
    : `<div class="vide">${cur ? "Vide" : ""}<br><button class="btn" data-action="ajouter-ici">${icone("plus")}${cur ? "Ajouter" : "Ajouter un lieu"}</button></div>`;
  if (aSurligner) {
    const l = $("liste").querySelector(`[data-id="${aSurligner}"]`);
    if (l) { l.classList.add("eclair"); l.scrollIntoView({ block: "center" }); }
    aSurligner = "";
  }
}

// Recherche : chaque mot doit se trouver dans le nom, les tags, la note ou l'emplacement.
// « #tag » = seulement ce tag.
function afficherResultats(q) {
  $("fil").hidden = true; $("courant").hidden = true;
  const tag = q.startsWith("#") ? simplifier(q.slice(1)) : "";
  const mots = simplifier(q).split(/\s+/).filter(Boolean);
  const res = [...elements.values()].filter(e => {
    if (tag) return e.tags.some(t => simplifier(t) === tag);
    const texte = simplifier([e.nom, ...e.tags, e.note, cheminTexte(e)].join(" "));
    return mots.every(m => texte.includes(m));
  });
  const debut = e => simplifier(e.nom).startsWith(mots[0] || "") ? 0 : 1;
  res.sort((a, b) => debut(a) - debut(b) || triNom(a, b));
  $("liste").innerHTML = res.length ? res.slice(0, 300).map(e => ligneHTML(e, true)).join("") : `<p class="vide">Rien trouvé</p>`;
}

function ouvrirFiche(id) {
  const e = elements.get(id);
  if (!e) { fermerVoile(); return; }
  const kids = enfants(id), anc = ancetres(e), cont = estContenant(e);
  ouvrirVoile(`
    ${e.photo ? `<img class="f-photo" src="${e.photo}" alt="">` : ""}
    <div class="f-tete">${e.photo ? "" : vignette(e)}
      <div class="f-titre"><h2>${echapper(e.nom)}</h2><span class="f-type">${TYPES[e.type].nom}</span></div>
      <div class="menu-wrap"><button class="btn-icone" data-action="menu" aria-label="Plus">${icone("dots")}</button>
        <div class="menu" hidden>
          <button data-action="modifier">${icone("pencil")}Modifier</button>
          <button data-action="supprimer" class="danger">${icone("trash")}Supprimer</button>
        </div></div>
      <button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button>
    </div>
    <div class="f-chemin">${icone("map-pin")}${anc.length
      ? anc.map(a => `<button data-vers="${a.id}">${echapper(a.nom)}</button>`).join(`<span class="sep">›</span>`)
      : `<span>Tout en haut</span>`}</div>
    ${e.note ? `<p class="f-note">${echapper(e.note)}</p>` : ""}
    ${e.tags.length ? `<div class="f-tags">${e.tags.map(t => `<button class="puce" data-tag="${echapper(t)}">${echapper(t)}</button>`).join("")}</div>` : ""}
    ${kids.length ? `<div class="f-contenu"><span class="h4">Contient</span> ${echapper(kids.map(k => k.nom).join(", "))}</div>` : ""}
    <div class="f-actions">
      <button class="btn plein" data-action="deplacer">${icone("transfer")}Déplacer</button>
      <button class="btn" data-action="ouvrir">${icone(cont ? "chevron-right" : "map-pin")}${cont ? "Ouvrir" : "Voir l'endroit"}</button>
    </div>
    ${e.historique.length ? `<details class="f-histo"><summary>${icone("history")}Anciens endroits</summary>
      ${[...e.historique].reverse().map(h => `<div class="h-ligne"><span>${echapper(h.de || "Tout en haut")}</span><span class="date">${dateCourte(h.le)}</span></div>`).join("")}
    </details>` : ""}`, "fiche", id);
}

// --- Formulaire (ajouter / modifier) ---
let form = null;   // { id?, parent, type, photo }
function tousLesTags() {
  const n = new Map();
  for (const e of elements.values()) for (const t of e.tags) n.set(t, (n.get(t) || 0) + 1);
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a));
}
function ouvrirFormulaire(e, parent, typeImpose) {
  if (e === undefined) { fermerVoile(); return; }   // #modifier= d'un élément disparu
  const neuf = !e;
  const parentEl = elements.get(neuf ? parent : e.parent);
  form = { id: e?.id, parent: neuf ? (parentEl ? parentEl.id : "") : e.parent,
    type: neuf ? (typeImpose || TYPE_PROPOSE[parentEl ? parentEl.type : ""]) : e.type, photo: e?.photo || "" };
  ouvrirVoile(`<form id="form" autocomplete="off">
    <div class="f-tete"><h2>${neuf ? "Ajouter" : "Modifier"}</h2>
      <button type="button" class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="f-ou">${icone("map-pin")}<span>${parentEl ? echapper(cheminComplet(parentEl)) : "Tout en haut"}</span></div>
    <input id="f-nom" class="champ" placeholder="Nom" maxlength="80" value="${echapper(e?.nom || "")}" enterkeyhint="done">
    <div class="types">${ORDRE_TYPES.map(t => `<button type="button" data-type="${t}" aria-pressed="${t === form.type}">${icone(TYPES[t].ic)}${TYPES[t].nom}</button>`).join("")}</div>
    <div class="photo-zone" id="f-photo"></div>
    <textarea id="f-note" class="champ" rows="2" placeholder="Note">${echapper(e?.note || "")}</textarea>
    <input id="f-tags" class="champ" placeholder="Tags, séparés par des virgules" value="${echapper((e?.tags || []).join(", "))}">
    <div class="suggestions" id="f-sugg"></div>
    <div class="f-actions">
      ${neuf ? `<button type="button" class="btn" data-action="enreg-autre">${icone("plus")}Autre</button>` : ""}
      <button type="submit" class="btn plein">${icone("check")}Enregistrer</button>
    </div>
    <input type="file" id="f-fichier" accept="image/*" hidden>
  </form>`, "form");
  majPhotoForm(); majSuggestions();
  if (neuf) $("f-nom").focus();
}
function majPhotoForm() {
  $("f-photo").innerHTML = form.photo
    ? `<img src="${form.photo}" alt=""><button type="button" class="btn" data-action="photo">${icone("camera")}Changer</button><button type="button" class="btn danger" data-action="retirer-photo">${icone("trash")}</button>`
    : `<button type="button" class="btn" data-action="photo">${icone("camera")}Photo</button>`;
}
function majSuggestions() {
  const deja = new Set($("f-tags").value.split(",").map(t => simplifier(t)).filter(Boolean));
  $("f-sugg").innerHTML = tousLesTags().filter(t => !deja.has(simplifier(t))).slice(0, 12)
    .map(t => `<button type="button" class="puce" data-sugg="${echapper(t)}">${echapper(t)}</button>`).join("");
}
function enregistrerFormulaire(autre) {
  const nom = $("f-nom").value.trim();
  if (!nom) { $("f-nom").focus(); return; }
  const tags = [...new Set($("f-tags").value.split(",").map(t => t.trim()).filter(Boolean))];
  const base = form.id ? elements.get(form.id) : { id: nouvelId(), parent: form.parent, historique: [], cree: Date.now() };
  if (!base) { retour(); return; }
  ecrire([{ ...base, nom, type: form.type, note: $("f-note").value.trim(), tags, photo: form.photo }]);
  if (autre) {   // saisie à la chaîne : même endroit, même type
    afficherToast(`Ajouté : ${nom}`, null);
    ouvrirFormulaire(null, form.parent, form.type);
  } else retour();
}

// Photo réduite (≈ 480 px, < 60 Ko) : juste pour reconnaître l'objet, et léger à synchroniser
async function reduirePhoto(fichier) {
  const bmp = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  let taille = 480, qualite = 0.7, resultat = "";
  for (let essai = 0; essai < 6; essai++) {
    const r = Math.min(1, taille / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    resultat = c.toDataURL("image/jpeg", qualite);
    if (resultat.length < 80000) break;
    taille *= 0.8; qualite = Math.max(0.5, qualite - 0.06);
  }
  bmp.close?.();
  return resultat;
}

// --- Déplacer : choisir la destination ---
const CLE_RECENTS = "inv-recents";
const lireRecents = () => { try { return JSON.parse(localStorage.getItem(CLE_RECENTS)) || []; } catch (e) { return []; } };
function noterRecent(id) {
  try { localStorage.setItem(CLE_RECENTS, JSON.stringify([id, ...lireRecents().filter(x => x !== id)].slice(0, 6))); } catch (e) { /* rien */ }
}
function ouvrirDeplacer(id) {
  const e = elements.get(id);
  if (!e) { fermerVoile(); return; }
  ouvrirVoile(`<div class="f-tete"><h2>Déplacer « ${echapper(e.nom)} »</h2>
      <button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="recherche">${icone("search")}<input id="d-cherche" type="search" placeholder="Chercher un endroit"></div>
    <div id="d-liste" class="d-liste"></div>`, "deplacer", id);
  $("d-cherche").addEventListener("input", () => remplirDeplacer(e));
  remplirDeplacer(e);
}
function remplirDeplacer(e) {
  const interdits = new Set([e.id, ...descendants(e.id)]);
  const q = simplifier($("d-cherche").value);
  const ligne = (x, prof) => `<button class="d-ligne${x && x.id === e.parent || !x && !e.parent ? " ici" : ""}" data-dest="${x ? x.id : ""}" style="padding-left:${6 + prof * 14}px">
      ${icone(x ? TYPES[x.type].ic : "home")}<span class="d-txt"><span class="d-nom">${x ? echapper(x.nom) : "Tout en haut"}</span>
      ${prof < 0 && x ? `<span class="d-ch">${echapper(cheminTexte(x) || "Tout en haut")}</span>` : ""}</span>
      ${x && x.id === e.parent || !x && !e.parent ? `<span class="ici-txt">ici</span>` : ""}</button>`;
  let html = "";
  if (q) {
    const mots = q.split(/\s+/);
    const res = [...elements.values()].filter(x => !interdits.has(x.id) && mots.every(m => simplifier(x.nom + " " + cheminTexte(x)).includes(m))).sort(triNom);
    html = res.slice(0, 200).map(x => ligne(x, -1)).join("") || `<p class="vide">Rien trouvé</p>`;
  } else {
    const rec = lireRecents().map(i => elements.get(i)).filter(x => x && !interdits.has(x.id) && x.id !== e.parent);
    if (rec.length) html += `<div class="d-sect h4">Récents</div>` + rec.map(x => ligne(x, -1)).join("") + `<div class="d-sect h4">Tout</div>`;
    // Arbre des contenants (les objets ne s'y montrent pas, sinon la liste serait trop longue : la recherche les trouve)
    html += ligne(null, 0);
    const parcourir = (pid, prof) => enfants(pid).forEach(x => {
      if (interdits.has(x.id) || !estContenant(x)) return;
      html += ligne(x, prof); parcourir(x.id, prof + 1);
    });
    parcourir("", 1);
  }
  $("d-liste").innerHTML = html;
}

// --- Réglages ---
const NOMS_THEME = { auto: "Auto", clair: "Clair", sombre: "Sombre" };
function afficherReglages() {
  $("version").textContent = VERSION;
  $("theme-actuel").textContent = NOMS_THEME[reglages.theme] || "Auto";
  document.querySelectorAll("[data-anim-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.animChoix === reglages.animations));
  $("btn-deconnexion").hidden = MODE_DEMO;
  majSynchro();
}
function afficherTheme() {
  document.querySelectorAll("[data-theme-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeChoix === reglages.theme));
}

// ---------- 6. Actions ----------

let minuteurToast = null, actionAnnuler = null;
function afficherToast(texte, annuler) {
  $("toast-texte").textContent = texte;
  $("toast-annuler").hidden = !annuler;
  actionAnnuler = annuler;
  $("toast").hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => { $("toast").hidden = true; actionAnnuler = null; }, 5000);
}
$("toast-annuler").addEventListener("click", () => { if (actionAnnuler) actionAnnuler(); $("toast").hidden = true; });

function deplacer(id, versId) {
  const e = elements.get(id);
  if (!e || e.parent === versId || versId === id || descendants(id).includes(versId)) return;
  const avant = { parent: e.parent, historique: e.historique };
  const dest = elements.get(versId);
  ecrire([{ ...e, parent: versId, historique: [...e.historique, { de: cheminTexte(e), le: Date.now() }].slice(-MAX_HISTO) }]);
  if (versId) noterRecent(versId);
  afficherToast(`${e.nom} → ${dest ? dest.nom : "Tout en haut"}`, () => {
    const now = elements.get(id);
    if (now) ecrire([{ ...now, ...avant }]);
  });
}

function supprimer(id) {
  const e = elements.get(id);
  if (!e) return;
  const ids = [id, ...descendants(id)];
  const copies = ids.map(i => elements.get(i));
  retour();
  effacer(ids);
  afficherToast(ids.length > 1 ? `${e.nom} et son contenu supprimés` : `${e.nom} supprimé`, () => ecrire(copies));
}

let minuteurNomCase = null;
let ignorerClic = false;   // juste après un glisser, le « clic » du lâcher ne doit rien ouvrir
document.addEventListener("click", ev => {
  if (ignorerClic) { ev.preventDefault(); ev.stopPropagation(); return; }
  const t = ev.target;
  const el = s => t.closest(s);
  let b;
  if ((b = el("[data-aller]"))) { const a = b.dataset.aller; a === "accueil" ? remplacer("") : (MODALES.includes(a) && MODALES.includes(location.hash.slice(1)) ? remplacer(a) : aller(a)); return; }
  if ((b = el("[data-theme-choix]"))) { changerReglage("theme", b.dataset.themeChoix); window.appliquerTheme(b.dataset.themeChoix); afficherTheme(); return; }
  if ((b = el("[data-anim-choix]"))) { changerReglage("animations", b.dataset.animChoix); document.documentElement.dataset.anim = b.dataset.animChoix; afficherReglages(); return; }
  if (t === $("ecran-reglages") || t === $("ecran-theme")) { remplacer(""); return; }

  // Voile : toucher le fond sombre ferme
  if (t === $("voile")) { retour(); return; }
  if (!$("voile").hidden) {
    const menu = $("voile").querySelector(".menu");
    if (menu && !el(".menu-wrap")) menu.hidden = true;
    if ((b = el("[data-action]"))) {
      const a = b.dataset.action;
      if (a === "fermer") retour();
      else if (a === "menu") menu.hidden = !menu.hidden;
      else if (a === "modifier") remplacer("modifier=" + voileId);
      else if (a === "supprimer") supprimer(voileId);
      else if (a === "deplacer") remplacer("deplacer=" + voileId);
      else if (a === "ouvrir") {
        const e = elements.get(voileId);
        if (estContenant(e)) remplacer("dans=" + e.id);
        else { aSurligner = e.id; $("recherche").value = ""; remplacer(e.parent ? "dans=" + e.parent : ""); }
      }
      else if (a === "photo") $("f-fichier").click();
      else if (a === "retirer-photo") { form.photo = ""; majPhotoForm(); }
      else if (a === "enreg-autre") enregistrerFormulaire(true);
      else if (a === "case-suppr") supprimerCase(voileId);
      else if (a === "case-dessous") {
        const { ci, ki } = form, m = meubleFacade();
        const k = colonnesValides(m)[ci].cases[ki], c = nouvelleCase(m, k.genre, genresDe(colonnesValides(m)));
        majFacade(cols => cols[ci].cases.splice(ki + 1, 0, { id: c.id, h: 1, genre: k.genre }), [c]);
        retour();
      }
      return;
    }
    if ((b = el("[data-modele]"))) { appliquerModele(b.dataset.modele); return; }
    if (voileType === "case" && (b = el("[data-genre], [data-haut], [data-larg]"))) {
      const { ci, ki } = form;
      majFacade(cols => {
        const k = cols[ci].cases[ki];
        if (b.dataset.genre) k.genre = b.dataset.genre;
        if (b.dataset.haut) k.h = +b.dataset.haut;
        if (b.dataset.larg) cols[ci].w = +b.dataset.larg;
      });
      ouvrirCase(ci, ki);
      return;
    }
    if ((b = el("[data-vers]"))) { $("recherche").value = ""; remplacer("dans=" + b.dataset.vers); return; }
    if ((b = el("[data-tag]"))) { $("recherche").value = "#" + b.dataset.tag; remplacer(""); return; }
    if ((b = el("[data-type]"))) { form.type = b.dataset.type; $("voile").querySelectorAll("[data-type]").forEach(x => x.setAttribute("aria-pressed", x === b)); return; }
    if ((b = el("[data-sugg]"))) {
      const v = $("f-tags").value.trim().replace(/,\s*$/, "");
      $("f-tags").value = (v ? v + ", " : "") + b.dataset.sugg;
      majSuggestions(); return;
    }
    if ((b = el("[data-dest]"))) { const id = voileId; retour(); deplacer(id, b.dataset.dest); return; }
    return;
  }

  // Accueil
  if ((b = el("[data-dans]"))) { $("recherche").value = ""; b.dataset.dans ? aller("dans=" + b.dataset.dans) : remplacer(""); return; }
  if ((b = el("[data-fiche]"))) { aller("fiche=" + b.dataset.fiche); return; }
  if ((b = el("[data-plan-edit]"))) { aller("plan=" + b.dataset.planEdit); return; }
  // Vue de face
  if ((b = el("[data-ouvre]")) && !facadeEdition) {
    const e = elements.get(b.dataset.ouvre);
    if (e) estContenant(e) ? aller("dans=" + e.id) : aller("fiche=" + e.id);
    return;
  }
  if ((b = el("[data-case]"))) {
    facadeEdition ? aller(`case=${b.dataset.ci}-${b.dataset.ki}`) : aller("dans=" + b.dataset.case);
    return;
  }
  if ((b = el("[data-fa]"))) {
    const a = b.dataset.fa, m = meubleFacade();
    if (a === "modele") aller("modeles");
    else if (a === "modifier") { facadeEdition = m.id; afficherAccueil(); }
    else if (a === "fini") { facadeEdition = ""; afficherAccueil(); }
    else if (a === "colonne") {
      const c = nouvelleCase(m, "etagere", genresDe(colonnesValides(m)));
      majFacade(cols => cols.push({ w: 1, cases: [{ id: c.id, h: 1, genre: "etagere" }] }), [c]);
    } else if (a === "ajout-case") {
      const ci = +b.dataset.ci, cols0 = colonnesValides(m), der = cols0[ci].cases.at(-1);
      const c = nouvelleCase(m, der.genre, genresDe(cols0));
      majFacade(cols => cols[ci].cases.push({ id: c.id, h: 1, genre: der.genre }), [c]);
    }
    return;
  }
  if (el("[data-action='plan-replier']")) { changerReglage("planReplie", !reglages.planReplie); afficherAccueil(); return; }
  if ((b = el(".plan-vue [data-lien]"))) {
    const e = elements.get(b.dataset.lien);
    if (e) estContenant(e) ? aller("dans=" + e.id) : aller("fiche=" + e.id);
    return;
  }
  if ((b = el("[data-action='ajouter-ici']")) || t.closest("#btn-ajouter")) { aller("ajouter=" + ($("recherche").value.trim() ? "" : dansId)); return; }
  if ((b = el(".ligne"))) {
    const e = elements.get(b.dataset.id);
    if (!e) return;
    const enRecherche = !!$("recherche").value.trim();
    if (estContenant(e) && !enRecherche) aller("dans=" + e.id);
    else aller("fiche=" + e.id);
  }
}, true);

document.addEventListener("submit", ev => { ev.preventDefault(); if (ev.target.id === "form") enregistrerFormulaire(false); });
document.addEventListener("input", ev => {
  if (ev.target.id === "recherche") afficherAccueil();
  else if (ev.target.id === "f-tags") majSuggestions();
  else if (ev.target.id === "c-nom") {   // nom d'une case : enregistré après une petite pause
    clearTimeout(minuteurNomCase);
    const id = voileId, nom = ev.target.value.trim();
    minuteurNomCase = setTimeout(() => { const e = elements.get(id); if (e && nom && e.nom !== nom) ecrire([{ ...e, nom }]); }, 500);
  }
});
document.addEventListener("change", async ev => {
  if (ev.target.id !== "f-fichier" || !ev.target.files[0]) return;
  try { form.photo = await reduirePhoto(ev.target.files[0]); majPhotoForm(); }
  catch (e) { afficherToast("Photo illisible", null); }
});
$("effacer-recherche").addEventListener("click", () => { $("recherche").value = ""; afficherAccueil(); $("recherche").focus(); });
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && !$("voile").hidden) retour();
  // Entrée dans le nom = enregistrer (pas de saut à la ligne inutile)
  if (ev.key === "Enter" && ev.target.id === "f-nom") { ev.preventDefault(); enregistrerFormulaire(false); }
});
$("btn-connexion").addEventListener("click", seConnecter);
$("btn-deconnexion").addEventListener("click", () => signOut(auth).then(() => location.reload()));
$("ouvrir-notes").addEventListener("click", () => {
  NotesIdees.ouvrir(donnees.idees, texte => { donnees.idees = texte; sauverDonnees(); });
});

// ---------- 7. Glisser une ligne sur un contenant ou sur le fil d'Ariane ----------
// Téléphone : appui long (0,35 s) puis glisser. PC : glisser direct à la souris.
// Le défilement est bloqué seulement une fois la ligne attrapée (touchmove non passif) :
// avant, un doigt qui bouge = on fait défiler la liste normalement.
let glisse = null;
$("liste").addEventListener("pointerdown", ev => {
  const ligne = ev.target.closest(".ligne");
  if (!ligne || ev.button > 0 || $("recherche").value.trim()) return;
  const depart = { x: ev.clientX, y: ev.clientY }, doigt = ev.pointerId, souris = ev.pointerType === "mouse";
  let minuteur = souris ? null : setTimeout(() => attraper(ligne, depart, doigt), 350);
  const bouger = e => {
    if (e.pointerId !== doigt) return;
    if (!glisse) {
      const loin = Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > 8;
      if (loin && souris) attraper(ligne, depart, doigt);
      else if (loin) { clearTimeout(minuteur); finir(); return; }
      else return;
    }
    suivreGlisse(e);
  };
  const lacher = e => {
    if (e.pointerId !== doigt) return;
    clearTimeout(minuteur); finir();
    if (glisse) lacherGlisse(e.type === "pointerup");
  };
  const finir = () => {
    document.removeEventListener("pointermove", bouger);
    document.removeEventListener("pointerup", lacher);
    document.removeEventListener("pointercancel", lacher);
  };
  document.addEventListener("pointermove", bouger);
  document.addEventListener("pointerup", lacher);
  document.addEventListener("pointercancel", lacher);
});
document.addEventListener("touchmove", ev => { if (glisse) ev.preventDefault(); }, { passive: false });
$("liste").addEventListener("contextmenu", ev => { if (ev.target.closest(".ligne")) ev.preventDefault(); });

function attraper(ligne, depart, doigt) {
  const r = ligne.getBoundingClientRect();
  const fantome = ligne.cloneNode(true);
  fantome.classList.add("fantome");
  Object.assign(fantome.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
  document.body.appendChild(fantome);
  ligne.classList.add("souleve");
  glisse = { id: ligne.dataset.id, ligne, fantome, dy: depart.y - r.top, x: depart.x, y: depart.y, cible: null, doigt,
    interdits: new Set([ligne.dataset.id, ...descendants(ligne.dataset.id)]), defile: 0 };
  navigator.vibrate?.(12);
  defilerAuto();
}
function suivreGlisse(e) {
  const g = glisse;
  g.x = e.clientX; g.y = e.clientY;
  g.fantome.style.top = (g.y - g.dy) + "px";
  g.defile = g.y < 70 ? -1 : g.y > innerHeight - 70 ? 1 : 0;
  chercherCible();
}
function chercherCible() {
  const g = glisse;
  const sous = document.elementFromPoint(g.x, g.y);
  let c = sous && (sous.closest(".ligne") || sous.closest(".fil-bout") || sous.closest(".plan-vue [data-lien]")
    || sous.closest(".fa-boite.contenant") || sous.closest(".fa-case[data-case]"));
  if (c?.dataset.lien && !elements.has(c.dataset.lien)) c = null;
  const id = c ? cibleId(c) : null;
  const parent = elements.get(g.id)?.parent || "";
  if (c && (g.interdits.has(id) || id === parent)) c = null;
  if (c !== g.cible) {
    g.cible?.classList.remove("cible");
    c?.classList.add("cible");
    g.cible = c;
  }
}
function defilerAuto() {
  if (!glisse) return;
  if (glisse.defile) { window.scrollBy(0, glisse.defile * 10); chercherCible(); }
  requestAnimationFrame(defilerAuto);
}
function lacherGlisse(ok) {
  const g = glisse; glisse = null;
  g.fantome.remove();
  g.ligne.classList.remove("souleve");
  g.cible?.classList.remove("cible");
  ignorerClic = true; setTimeout(() => { ignorerClic = false; }, 60);
  if (ok && g.cible) deplacer(g.id, cibleId(g.cible));
}
const cibleId = c => c.dataset.lien ?? c.dataset.ouvre ?? c.dataset.case ?? c.dataset.id ?? c.dataset.dans;   // dessin du plan : son lien, pas son id de dessin

// ---------- 8. Excel ----------
// Une feuille « Inventaire » dans l'ordre de l'arbre (nom décalé selon la profondeur),
// photo dans la 1re colonne. ID et « Dans (ID) » à la fin servent au réimport exact.
const COLONNES = [
  { header: "", key: "_photo", width: 5 },
  { header: "Nom", key: "nom", width: 30 },
  { header: "Type", key: "type", width: 9 },
  { header: "Emplacement", key: "chemin", width: 38 },
  { header: "Tags", key: "tags", width: 18 },
  { header: "Note", key: "note", width: 30 },
  { header: "Déplacé le", key: "deplace", width: 12 },
  { header: "ID", key: "id", width: 12 },
  { header: "Dans (ID)", key: "parent", width: 12 }
];
$("btn-export").addEventListener("click", async () => {
  try {
    const ExcelJS = await chargerExcelJS();
    const wb = new ExcelJS.Workbook();
    const lignes = [], profs = [];
    const parcourir = (pid, prof) => enfants(pid).forEach(e => {
      const der = e.historique[e.historique.length - 1];
      lignes.push({ nom: e.nom, type: TYPES[e.type].nom, chemin: cheminTexte(e), tags: e.tags.join(", "), note: e.note,
        deplace: der ? dateCourte(der.le) : "", id: e.id, parent: e.parent, _image: e.photo || undefined });
      profs.push({ prof, gras: estContenant(e) });
      parcourir(e.id, prof + 1);
    });
    parcourir("", 0);
    const ws = ajouterFeuille(wb, "Inventaire", COLONNES, lignes, { hauteur: 21, figer: 2 });
    profs.forEach((p, i) => {
      const c = ws.getRow(i + 2).getCell(2);
      c.alignment = { ...c.alignment, indent: Math.min(p.prof, 15) };
      if (p.gras) c.font = { bold: true };
    });
    // Plans : un onglet à part, le plan en texte (JSON) pour pouvoir le réimporter tel quel
    const plans = [...elements.values()].filter(e => !planVide(e.plan) || e.facade);
    if (plans.length) ajouterFeuille(wb, "Plans", [
      { header: "Nom", key: "nom", width: 24 }, { header: "ID", key: "id", width: 12 },
      { header: "Plan", key: "plan", width: 40 }, { header: "Façade", key: "facade", width: 40 }
    ], plans.map(e => ({ nom: e.nom, id: e.id, plan: planVide(e.plan) ? "" : JSON.stringify(e.plan), facade: e.facade ? JSON.stringify(e.facade) : "" })), { hauteur: 21 });
    await telechargerClasseur(wb, NOM_APPLI);
  } catch (err) { afficherToast("Export impossible : " + err.message, null); }
});

$("btn-import").addEventListener("click", () => $("fichier-import").click());
$("fichier-import").addEventListener("change", async ev => {
  const f = ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  try {
    const wb = await lireClasseur(f);
    const ws = wb.getWorksheet("Inventaire") || wb.worksheets[0];
    const images = imagesParLigne(wb, ws);
    const plans = new Map();
    const facades = new Map();
    const lireJSON = c => { try { const t = String(c.text || "").trim(); return t ? JSON.parse(t) : null; } catch (e) { return null; } };   // illisible : ignoré
    wb.getWorksheet("Plans")?.eachRow((rang, n) => {
      if (n === 1) return;
      const id = String(rang.getCell(2).text).trim();
      plans.set(id, lireJSON(rang.getCell(3)));
      facades.set(id, lireJSON(rang.getCell(4)));
    });
    const cols = {};
    ws.getRow(1).eachCell((c, i) => { cols[simplifier(c.text)] = i; });
    const lire = (rang, nom) => cols[nom] ? String(rang.getCell(cols[nom]).text ?? "").trim() : "";
    const typeDe = t => ORDRE_TYPES.find(k => simplifier(TYPES[k].nom) === simplifier(t) || k === simplifier(t)) || "objet";
    const lus = [];
    ws.eachRow((rang, n) => {
      if (n === 1) return;
      const nom = lire(rang, "nom");
      if (!nom) return;
      lus.push({ id: lire(rang, "id") || nouvelId(), nom, type: typeDe(lire(rang, "type")), parentId: lire(rang, "dans (id)"),
        chemin: lire(rang, "emplacement"), tags: lire(rang, "tags").split(",").map(t => t.trim()).filter(Boolean),
        note: lire(rang, "note"), photo: images.get(n) || "" });
    });
    if (!lus.length) { afficherToast("Rien à importer", null); return; }
    // Sans « Dans (ID) » (fichier fait à la main) : on retrouve le parent par son chemin « A › B › C »
    const ids = new Set(lus.map(l => l.id));
    const parChemin = new Map();
    lus.forEach(l => parChemin.set(simplifier([l.chemin, l.nom].filter(Boolean).join(" › ")), l.id));
    lus.forEach(l => {
      if (!ids.has(l.parentId)) l.parentId = l.chemin ? (parChemin.get(simplifier(l.chemin)) || "") : "";
    });
    if (!confirm(`Remplacer tout l'inventaire par les ${lus.length} éléments du fichier ?`)) return;
    const anciens = [...elements.keys()].filter(id => !ids.has(id));
    const avant = new Map(elements);
    effacer(anciens);
    ecrire(lus.map(l => normaliser(l.id, { ...l, parent: l.parentId, plan: plans.get(l.id), facade: facades.get(l.id), historique: avant.get(l.id)?.historique || [], cree: avant.get(l.id)?.cree || Date.now() })));
    afficherToast(`${lus.length} éléments importés`, null);
    remplacer("");
  } catch (err) { afficherToast("Import impossible : " + err.message, null); }
});
function imagesParLigne(wb, ws) {
  const m = new Map();
  ws.getImages().forEach(im => {
    const f = wb.getImage(Number(im.imageId));
    if (!f || !f.buffer || !/png|jpe?g|gif/i.test(f.extension || "")) return;
    const o = new Uint8Array(f.buffer); let s = "";
    for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    m.set(Math.round(im.range.tl.nativeRow ?? im.range.tl.row) + 1, `data:image/${/jpe?g/i.test(f.extension) ? "jpeg" : f.extension};base64,` + btoa(s));
  });
  return m;
}

// ---------- 9. Démarrage ----------
let rechargerApres = false;
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  // Nouvelle version : rechargement une fois (pas à la 1re installation, ni fenêtre ouverte)
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!avaitUneVersion || rechargerApres) return;
    rechargerApres = true;
    if ($("voile").hidden) location.reload();
  });
  new MutationObserver(() => { if (rechargerApres && $("voile").hidden) location.reload(); })
    .observe($("voile"), { attributes: true, attributeFilter: ["hidden"] });
}

$("version").textContent = VERSION;
if (MODE_DEMO) demarrerDemo(); else demarrerFirebase();
