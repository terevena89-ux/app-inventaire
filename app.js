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
import { normaliserPlan, planVide, vueHTML, ouvrirEditeur, fermerEditeur, editeurOuvert, cadrage, svgVue, boiteTournee, centrePlan } from "./plan.js";

// ---------- 1. Base et données ----------

const VERSION = "v0.7.1";
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
let reglages = { theme: "auto", animations: "completes", vibrations: true };
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
    facade: normaliserFacade(d.facade),  // seulement pour un meuble (vue de face)
    couleur: COULEURS.includes(d.couleur) ? d.couleur : "",   // tuile de l'icône (au choix)
    principal: !!d.principal,           // lieu montré en grand sur l'accueil (étoile)
    etat: ETATS[d.etat] ? d.etat : "",   // pastille : à ranger / introuvable
    mobile: !!d.mobile,                  // objet qui bouge souvent (pas d'endroit fixe)
    quantite: d.quantite === "" || d.quantite == null || !Number.isFinite(+d.quantite) ? null : Math.max(0, Math.round(+d.quantite)),
    achat: normaliserAchat(d.achat),
    // Sorti de l'inventaire (jeté, donné…) : gardé pour l'écran Archive. avec = id de l'élément sorti avec lui (son contenant)
    archive: d.archive && d.archive.le ? { raison: RAISONS[d.archive.raison] ? d.archive.raison : "autre", le: Number(d.archive.le) || 0,
      de: String(d.archive.de || ""), avec: String(d.archive.avec || "") } : null
  };
}
const ETATS = { aranger: "À ranger", introuvable: "Introuvable" };
const COULEURS = ["jaune", "corail", "rose", "violet", "bleu", "turquoise", "vert", "gris"];
const RAISONS = { jete: "Jeté", donne: "Donné", vendu: "Vendu", perdu: "Perdu", autre: "Autre" };
// Achat = { date, garantie (AAAA-MM-JJ), prix (€), facture (photo) } ; null si rien n'est rempli
function normaliserAchat(a) {
  if (!a || typeof a !== "object") return null;
  const jour = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
  const r = { date: jour(a.date), garantie: jour(a.garantie),
    prix: a.prix === "" || a.prix == null || !Number.isFinite(+a.prix) ? null : Math.round(+a.prix * 100) / 100,
    facture: typeof a.facture === "string" && a.facture.startsWith("data:image/") ? a.facture : "" };
  return r.date || r.garantie || r.prix != null || r.facture ? r : null;
}
// Façade = colonnes de cases empilées : { cols: [{ w, cases: [{ id, h, genre }] }] }
// id = l'élément « Case » (enfant du meuble) ; w / h = largeur / hauteur relatives ; ratio = hauteur / largeur du dessin.
const GENRES = { etagere: "Étagère", tiroir: "Tiroir", penderie: "Penderie", porte: "Porte", dessus: "Dessus", dessous: "Dessous" };
function normaliserFacade(f) {
  if (!f || !Array.isArray(f.cols)) return null;
  const t = v => Math.min(50, Math.max(0.1, Math.round((Number(v) || 1) * 100) / 100));   // tailles relatives, modelées à la main (v0.5)
  const cols = f.cols.filter(c => c && Array.isArray(c.cases)).map(c => ({
    w: t(c.w), cases: c.cases.filter(k => k && k.id).map(k => ({ id: String(k.id), h: t(k.h), genre: GENRES[k.genre] ? k.genre : "etagere" }))
  })).filter(c => c.cases.length);
  const ratio = Number(f.ratio) >= 0.2 && Number(f.ratio) <= 4 ? Math.round(Number(f.ratio) * 1000) / 1000 : null;   // hauteur du dessin / largeur de l'écran
  const largeur = Number(f.largeur) >= 0.25 && Number(f.largeur) < 1 ? Math.round(Number(f.largeur) * 1000) / 1000 : null;   // largeur du dessin / largeur de l'écran (rien = toute la largeur)
  return cols.length ? { cols, ratio, largeur } : null;
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
    if (e.archive) continue;   // sortis de l'inventaire : seulement dans l'écran Archive
    const p = elements.has(e.parent) && e.parent !== e.id && !elements.get(e.parent).archive ? e.parent : "";
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
// Chaque écran a son adresse (#dans=ID, #fiche=ID, #reglages…), mais on n'empile PAS l'historique
// du navigateur (avant, des pages remplacées faisaient sauter ou bloquer le bouton retour).
// Le bouton retour du téléphone est intercepté et fait un « retour logique », comme un explorateur :
// fermer ce qui est ouvert, sinon remonter au contenant parent ; à l'accueil, il quitte l'appli.
// Technique : une entrée « socle » + une entrée « appli » ; appuyer sur retour fait passer du
// socle à l'appli (événement popstate), on remet l'entrée appli et on fait le retour logique.
let dansId = "";
let hashActuel = "";   // adresse de l'écran affiché (sans le #)
let hashSous = "";     // écran de base sous une fenêtre (fiche, réglages…) : on y revient en la fermant
const COUCHES = ["fiche", "modifier", "ajouter", "deplacer", "sortir", "verifier", "endroit", "modeles", "case", "plan", "reglages", "theme", "archive"];
const cleDe = h => String(h).split("=")[0];
function naviguer(adresse) {
  if (COUCHES.includes(cleDe(adresse)) && !COUCHES.includes(cleDe(hashActuel))) hashSous = hashActuel;
  if (history.state?.socle) history.pushState({ appli: 1 }, "", "#" + adresse);   // ré-armer le retour
  else history.replaceState({ appli: 1 }, "", "#" + adresse);
  router();
}
const aller = naviguer, remplacer = naviguer;
// Que fait « retour » maintenant ? (null = rien, on peut quitter l'appli)
function cibleRetour() {
  const cle = cleDe(hashActuel);
  if (cle === "theme" || cle === "archive") return "reglages";
  if (COUCHES.includes(cle)) return COUCHES.includes(cleDe(hashSous)) ? "" : hashSous;
  if ($("recherche").value.trim() || filtre) return "effacer";
  if (onglet !== "maison") return dansId ? "dans=" + dansId : "";
  if (dansId) {
    const e = elements.get(dansId), p = e && elements.get(e.parent);
    return p && !p.archive && !(p.principal && !p.parent) ? "dans=" + p.id : "";
  }
  return null;
}
function retour() {
  if (document.querySelector(".visionneuse")) { document.querySelectorAll(".visionneuse").forEach(v => v.remove()); return true; }
  const c = cibleRetour();
  if (c === null) return false;
  if (c === "effacer") { $("recherche").value = ""; filtre = ""; afficherAccueil(); return true; }
  naviguer(c);
  return true;
}
window.addEventListener("popstate", ev => {
  if (!ev.state?.socle) return;
  if (cibleRetour() === null && !document.querySelector(".visionneuse")) { history.back(); return; }   // accueil : on quitte
  history.pushState({ appli: 1 }, "", "#" + hashActuel);
  retour();
});
history.replaceState({ socle: 1 }, "", location.href);
history.pushState({ appli: 1 }, "", location.href);

const MODALES = ["reglages", "theme", "archive"];
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
function fermerVoile() { cancelAnimationFrame(animEndroit); clearTimeout(animEndroit); $("voile").hidden = true; $("voile").innerHTML = ""; voileType = voileId = ""; form = null; }

function router() {
  if (!MODE_DEMO && !uid) return;
  const h = decodeURIComponent(location.hash.slice(1));
  hashActuel = h;
  const [cle, val = ""] = h.split("=");
  if (MODALES.includes(cle)) {
    fermerVoile(); montrer(cle);
    if (cle === "reglages") afficherReglages(); else if (cle === "archive") afficherArchive(); else afficherTheme();
    return;
  }
  montrer("accueil");
  const avant = dansId;
  if (cle === "dans") dansId = elements.has(val) ? val : "";
  else if (!cle) dansId = "";
  // Glissement doux : entrer dans un contenant = la liste arrive de droite, remonter = de gauche
  if (avant !== dansId && !animationsReduites()) {
    const entre = !avant || (elements.get(dansId) && ancetres(elements.get(dansId)).some(a => a.id === avant));
    const dx = entre ? 26 : -26;
    requestAnimationFrame(() => ["courant", "plan", "facade", "liste"].forEach(i => $(i).animate(
      [{ transform: `translateX(${dx}px)`, opacity: .35 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.8,.3,1)" })));
  }
  // Onglet du bas : #objets / #escalier ; un endroit ouvert = onglet Maison ; une fiche garde l'onglet en cours
  if (cle === "objets" || cle === "escalier") onglet = cle;
  else if (cle === "dans" || !cle) onglet = "maison";
  if (cle === "plan") { fermerVoile(); ouvrirPlan(val); }
  else fermerEditeur();
  afficherAccueil();
  if (cle === "fiche") { if (voileType !== "fiche" || voileId !== val) ouvrirFiche(val); }
  else if (cle === "modifier") { if (voileType !== "form") ouvrirFormulaire(elements.get(val), null); }
  else if (cle === "ajouter") { if (voileType !== "form") ouvrirFormulaire(null, elements.has(val) ? val : ""); }
  else if (cle === "deplacer") { if (voileType !== "deplacer") ouvrirDeplacer(val); }
  else if (cle === "sortir") { if (voileType !== "sortir") ouvrirSortir(val); }
  else if (cle === "endroit") { if (voileType !== "endroit") ouvrirEndroit(val); }
  else if (cle === "verifier") { if (voileType !== "verifier") ouvrirVerifier(val); }
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
    vibrer,
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
  const lignes = Math.max(...cols.map(c => c.cases.length));
  const W = $("facade").clientWidth || 364;
  const H = o.mini ? 64 : o.ratio ? Math.round(Math.min(520, Math.max(90, W * o.ratio))) : Math.min(300, Math.max(130, lignes * 44));
  // En mode modifier : séparateurs à tirer entre les cases, entre les colonnes, et sous le meuble
  const sepH = (ci, ki) => o.edition && ki ? `<div class="fa-sep h" data-sep="h" data-ci="${ci}" data-ki="${ki}"></div>` : "";
  const sepV = ci => o.edition && ci ? `<div class="fa-sep v" data-sep="v" data-ci="${ci}"></div>` : "";
  // Le meuble (cadre + poignées) : largeur réglable (centré), hauteur réglable
  const larg = o.mini || !o.largeur ? 100 : Math.round(o.largeur * 1000) / 10;
  return `<div class="fa-meuble" style="width:${larg}%">` + `<div class="fa-cadre${o.edition ? " edition" : ""}${o.mini ? " mini" : ""}" style="height:${H}px">` + cols.map((c, ci) => sepV(ci) + `<div class="fa-col" style="flex:${c.w}">`
    + c.cases.map((k, ki) => {
      const e = elements.get(k.id), kids = o.mini ? [] : enfants(k.id);
      return sepH(ci, ki) + `<div class="fa-case g-${k.genre}${k.id && k.id === o.focus ? " actif" : ""}" style="flex:${k.h}"${o.mini ? "" : ` data-case="${k.id}" data-ci="${ci}" data-ki="${ki}"`}>
        <span class="fa-nom">${echapper(o.mini ? "" : e?.nom)}</span>
        ${kids.length ? `<div class="fa-contenu">${kids.map(x => `<span class="fa-boite${estContenant(x) ? " contenant" : ""}${x.id === o.objet ? " actif" : ""}${x.couleur ? " coul-" + x.couleur : ""}" data-ouvre="${x.id}">${x.photo ? `<img src="${x.photo}" alt="">` : ""}${echapper(x.nom)}</span>`).join("")}</div>` : ""}
      </div>`;
    }).join("")
    + (o.edition ? `<button class="fa-plus" data-fa="ajout-case" data-ci="${ci}" aria-label="Ajouter une case">${icone("plus")}</button>` : "")
    + `</div>`).join("") + `</div>`
    // Poignées : à droite (largeur), en bas (hauteur), au coin (les deux d'un geste)
    + (o.edition ? `<div class="fa-tire droite" data-sep="droite" aria-label="Largeur du meuble"></div><div class="fa-tire bas" data-sep="bas" aria-label="Hauteur du meuble"></div><div class="fa-tire coin" data-sep="coin" aria-label="Taille du meuble"></div>` : "")
    + `</div>`;
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
  zone.innerHTML = facadeHTML(cols, { focus, edition, ratio: meuble.facade?.ratio, largeur: meuble.facade?.largeur })
    + (edition
      ? `<div class="fa-barre"><button class="btn" data-fa="colonne">${icone("plus")}Colonne</button><button class="btn" data-fa="modele">Modèle</button><button class="btn plein" data-fa="fini">${icone("check")}OK</button></div>`
      : `<div class="plan-outils"><button class="btn-icone petit" data-fa="modifier" aria-label="Modifier la façade">${icone("pencil")}</button>
         <button class="btn-icone petit" data-action="plan-replier" aria-label="Replier">${icone("chevron-up")}</button></div>`);
}
const meubleFacade = () => trouverFacade(elements.get(dansId))?.meuble;

// Modeler la façade au doigt : on tire un séparateur, les deux voisins se partagent la place
// (tailles en poids relatifs) ; la barre du bas change la hauteur du meuble (ratio hauteur / largeur).
$("facade").addEventListener("pointerdown", ev => {
  const sep = ev.target.closest("[data-sep]");
  if (!sep) return;
  ev.preventDefault();
  try { sep.setPointerCapture(ev.pointerId); } catch (e) { /* doigt déjà levé */ }
  const cadre = $("facade").querySelector(".fa-cadre"), type = sep.dataset.sep;
  let a, b;
  if (type === "h") { b = sep.nextElementSibling; a = sep.previousElementSibling; }
  if (type === "v") { b = sep.nextElementSibling; a = sep.previousElementSibling; }
  const depart = type === "v" ? ev.clientX : ev.clientY, x0 = ev.clientX, y0 = ev.clientY;
  const ta = a ? (type === "v" ? a.offsetWidth : a.offsetHeight) : 0, tb = b ? (type === "v" ? b.offsetWidth : b.offsetHeight) : 0;
  const boite = $("facade").querySelector(".fa-meuble"), Z = $("facade").clientWidth || 364;
  const H0 = cadre.offsetHeight, W0 = boite.offsetWidth;
  const somme = a && b ? parseFloat(a.style.flex) + parseFloat(b.style.flex) : 0;   // poids des deux voisins (inchangé)
  sep.classList.add("tire");
  vibrer("prise");
  const bouger = e => {
    const d = (type === "v" ? e.clientX : e.clientY) - depart;
    // Meuble centré : le bord droit suit le doigt, donc la largeur change de 2 × le déplacement
    if (type === "droite" || type === "coin") boite.style.width = Math.min(Z, Math.max(Z * .25, W0 + 2 * (e.clientX - x0))) + "px";
    if (type === "bas" || type === "coin") cadre.style.height = Math.min(520, Math.max(90, H0 + e.clientY - y0)) + "px";
    if (type === "droite" || type === "bas" || type === "coin") return;
    const na = Math.max(22, Math.min(ta + tb - 22, ta + d));
    a.style.flex = String(somme * na / (ta + tb)); b.style.flex = String(somme * (ta + tb - na) / (ta + tb));
  };
  const lacher = () => {
    sep.removeEventListener("pointermove", bouger);
    sep.removeEventListener("pointerup", lacher);
    sep.removeEventListener("pointercancel", lacher);
    sep.classList.remove("tire");
    const m = meubleFacade();
    if (!m) return;
    if (type === "droite" || type === "bas" || type === "coin") {
      // Tailles rapportées à la largeur de l'écran (le même meuble garde sa forme sur le tel et le PC)
      ecrire([{ ...m, facade: normaliserFacade({ ...m.facade, cols: colonnesValides(m), ratio: cadre.offsetHeight / Z, largeur: boite.offsetWidth / Z }) }]);
      vibrer("depot");
      return;
    }
    // Nouveaux poids = tailles à l'écran, rapportées à la somme des deux poids d'avant
    const ci = +sep.dataset.ci, ki = +sep.dataset.ki, la = parseFloat(a.style.flex), lb = parseFloat(b.style.flex);
    majFacade(cols => {
      const [x, y] = type === "v" ? [cols[ci - 1], cols[ci]] : [cols[ci].cases[ki - 1], cols[ci].cases[ki]];
      const cle = type === "v" ? "w" : "h", somme = x[cle] + y[cle];
      x[cle] = somme * la / (la + lb); y[cle] = somme * lb / (la + lb);
    });
  };
  sep.addEventListener("pointermove", bouger);
  sep.addEventListener("pointerup", lacher);
  sep.addEventListener("pointercancel", lacher);
});

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
  ecrire([{ ...m, facade: normaliserFacade({ cols, ratio: m.facade?.ratio, largeur: m.facade?.largeur }) }, ...extra]);
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
  const rot = lireRotation(lieu.id);
  zone.dataset.lieu = lieu.id;
  zone.innerHTML = vueHTML(lieu.plan, { chaine, W: zone.clientWidth || 360, H: 230, rot })
    // Boussole (comme une carte) : visible quand le plan est tourné ; la toucher remet le nord en haut
    + `<button class="boussole" data-action="nord" aria-label="Remettre le nord en haut"${Math.abs(rot) < 1 ? " hidden" : ""}><svg viewBox="0 0 24 24" style="transform:rotate(${rot}deg)"><path class="b-nord" d="M12 3l4 9h-8z"/><path class="b-sud" d="M12 21l-4-9h8z"/></svg></button>`
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
  : `<span class="vign t-${e.type}${e.couleur ? " coul-" + e.couleur : ""}">${icone(TYPES[e.type].ic)}</span>`;

// Pastilles (à ranger, introuvable, mobile) et quantité « ×6 »
const pastillesHTML = e => (e.etat ? `<span class="pastille p-${e.etat}">${ETATS[e.etat]}</span>` : "")
  + (e.mobile ? `<span class="pastille p-mobile">Mobile</span>` : "");
const qteHTML = e => e.quantite != null ? `<span class="qte">×${e.quantite}</span>` : "";
function ligneHTML(e, avecChemin) {
  const kids = enfants(e.id), cont = estContenant(e);
  const sous = avecChemin ? (cheminTexte(e) || (e.mobile ? "" : "Tout en haut")) : kids.map(k => k.nom).join(", ");
  return `<div class="ligne${cont ? " contenant" : ""}${e.quantite === 0 ? " epuise" : ""}" data-id="${e.id}">${vignette(e)}
    <div class="l-txt"><span class="l-nom"><span class="l-n">${echapper(e.nom)}</span>${qteHTML(e)}${pastillesHTML(e)}</span>${sous ? `<span class="l-sous">${echapper(sous)}</span>` : ""}</div>
    ${cont && !avecChemin ? icone("chevron-right") : ""}</div>`;
}

// Puces-filtres sous la recherche (seulement s'il y a quelque chose à montrer)
let filtre = "";
const FILTRES = { aranger: ["À ranger", e => e.etat === "aranger"], mobile: ["Mobiles", e => e.mobile], introuvable: ["Introuvables", e => e.etat === "introuvable"] };
function afficherFiltres(visible) {
  const actifs = [...elements.values()].filter(e => !e.archive);
  const puces = Object.entries(FILTRES).map(([k, [nom, f]]) => [k, nom, actifs.filter(f).length]).filter(([k, , n]) => n || filtre === k);
  if (filtre && !puces.some(([k]) => k === filtre)) filtre = "";
  $("filtres").hidden = !visible || !puces.length;
  $("filtres").innerHTML = puces.map(([k, nom, n]) => `<button class="filtre p-${k}" data-filtre="${k}" aria-pressed="${filtre === k}">${nom} <b>${n}</b></button>`).join("");
}

let aSurligner = "";
function afficherAccueil() {
  const q = $("recherche").value.trim();
  $("effacer-recherche").hidden = !q;
  document.querySelectorAll("[data-onglet]").forEach(b => b.setAttribute("aria-current", b.dataset.onglet === onglet ? "page" : "false"));
  // Onglets Objets et Escalier (la recherche reste générale dans l'escalier)
  const autre = onglet === "objets" || (onglet === "escalier" && !q);
  $("vue-onglet").hidden = $("onglet-outils").hidden = !autre;
  $("liste").hidden = autre;
  if (autre) {
    ["fil", "courant", "plan", "facade", "filtres"].forEach(i => { $(i).hidden = true; });
    if (onglet === "objets") afficherObjets(q); else afficherEscalier();
    return;
  }
  const cur0 = elements.get(dansId);
  afficherFiltres(!cur0 || !!filtre);
  if (q || filtre) { $("plan").hidden = $("facade").hidden = true; afficherResultats(q); return; }
  const cur = cur0;
  // Accueil : le lieu marqué « principal » (étoile) montre son plan et ses pièces ; les autres lieux en dessous
  const principal = cur ? null : [...elements.values()].find(e => e.principal && !e.archive && !e.parent);
  // Dans un meuble (ou une de ses cases) : sa façade à la place du plan
  const fac = trouverFacade(cur);
  $("facade").hidden = !fac;
  if (fac) { $("plan").hidden = true; afficherFacade(fac); } else afficherPlan(cur || principal);
  const fil = cur ? [...ancetres(cur), cur] : [];
  $("fil").hidden = false;
  $("fil").innerHTML = `<button class="fil-bout" data-dans="">${icone("home")}Tout</button>`
    + fil.map(a => `<span class="sep">›</span><button class="fil-bout" data-dans="${a.id}">${echapper(a.nom)}</button>`).join("");
  $("fil").scrollLeft = $("fil").scrollWidth;
  const tete = cur || principal;
  $("courant").hidden = !tete;
  if (tete) {
    const infos = [TYPES[tete.type].nom, ...tete.tags].join(" · ");
    $("courant").innerHTML = `${cur ? `<button class="btn-icone remonter" data-action="remonter" aria-label="Remonter">${icone("arrow-left")}</button>` : ""}${vignette(tete)}<div class="c-txt"><b>${echapper(tete.nom)}${tete.principal ? ` ${icone("star")}` : ""}</b><span>${echapper(infos)}${tete.note ? " · " + echapper(tete.note) : ""}</span></div>
      <button class="btn-icone" data-fiche="${tete.id}" aria-label="Fiche">${icone("dots")}</button>`;
  }
  // Lâcher un objet glissé sur la liste (pas sur une ligne) = le ranger ici
  $("liste").dataset.depot = tete ? tete.id : "";
  const liste = enfants(tete ? tete.id : "");
  const autres = principal ? enfants("").filter(e => e.id !== principal.id) : [];
  $("liste").innerHTML = (liste.length ? liste.map(e => ligneHTML(e, false)).join("")
    : `<div class="vide">${tete ? "Vide" : ""}<br><button class="btn" data-action="ajouter-ici">${icone("plus")}${tete ? "Ajouter" : "Ajouter un lieu"}</button></div>`)
    + (autres.length ? `<div class="groupe-titre h4">Autres lieux</div>` + autres.map(e => ligneHTML(e, false)).join("") : "");
  if (aSurligner) {
    const l = $("liste").querySelector(`[data-id="${aSurligner}"]`);
    if (l) { l.classList.add("eclair"); l.scrollIntoView({ block: "center" }); }
    aSurligner = "";
  }
}

// ---------- Onglet Objets : tous les objets, sans les contenants ----------
let onglet = "maison";
const TRIS = { piece: "Pièce", az: "A→Z", recents: "Récents", tags: "Tags" };
const dateActivite = e => Math.max(e.cree || 0, e.historique.at(-1)?.le || 0);   // ajout ou dernier déplacement
function afficherObjets(q) {
  const tri = TRIS[reglages.triObjets] ? reglages.triObjets : "piece";
  $("onglet-outils").innerHTML = `<div class="seg seg-large">${Object.entries(TRIS).map(([k, n]) => `<button data-tri="${k}" aria-pressed="${k === tri}">${n}</button>`).join("")}</div>`;
  const mots = simplifier(q).split(/\s+/).filter(Boolean);
  const l = [...elements.values()].filter(e => !e.archive && e.type === "objet"
    && mots.every(m => simplifier([e.nom, ...e.tags, e.note, cheminTexte(e)].join(" ")).includes(m)));
  let groupes;
  if (tri === "az") groupes = [["", l.sort(triNom)]];
  else if (tri === "recents") groupes = [["", l.sort((a, b) => dateActivite(b) - dateActivite(a))]];
  else {
    const m = new Map(), ajouter = (k, e) => { if (!m.has(k)) m.set(k, []); m.get(k).push(e); };
    const SANS = tri === "tags" ? "Sans tag" : "À ranger · Mobiles";
    if (tri === "tags") l.forEach(e => (e.tags.length ? e.tags : [SANS]).forEach(t => ajouter(t, e)));
    else l.forEach(e => {
      const a = ancetres(e), p = a.find(x => x.type === "piece") || a[0];
      ajouter(p ? cheminComplet(p) : SANS, e);
    });
    // « À ranger · Mobiles » en premier, « Sans tag » en dernier
    groupes = [...m].sort(([a], [b]) => (a === SANS) - (b === SANS) || a.localeCompare(b, "fr", { numeric: true }))
      .map(([k, xs]) => [k, xs.sort(triNom)]);
    if (tri === "piece") groupes.sort(([a], [b]) => (b === SANS) - (a === SANS));
  }
  $("vue-onglet").innerHTML = l.length
    ? groupes.map(([t, xs]) => (t ? `<div class="groupe-titre h4">${echapper(t)}</div>` : "") + xs.map(e => ligneHTML(e, true)).join("")).join("")
    : `<p class="vide">${q ? "Rien trouvé" : "Aucun objet"}</p>`;
}

// ---------- Onglet Escalier : l'arbre, décalé selon la profondeur, de tel niveau à tel niveau ----------
const CLE_PLIES = "inv-plies";
const lirePlies = () => { try { return new Set(JSON.parse(localStorage.getItem(CLE_PLIES)) || []); } catch (e) { return new Set(); } };
function plier(id) {
  const s = lirePlies();
  s.has(id) ? s.delete(id) : s.add(id);
  try { localStorage.setItem(CLE_PLIES, JSON.stringify([...s])); } catch (e) { /* rien */ }
}
function afficherEscalier() {
  let de = ORDRE_TYPES.indexOf(reglages.escDe), a = ORDRE_TYPES.indexOf(reglages.escA);
  if (de < 0) de = 0;
  if (a < 0) a = ORDRE_TYPES.length - 1;
  if (a < de) [de, a] = [a, de];
  const options = sel => ORDRE_TYPES.map((t, i) => `<option value="${t}"${i === sel ? " selected" : ""}>${TYPES[t].nom}</option>`).join("");
  $("onglet-outils").innerHTML = `<label class="esc-choix">De<select id="esc-de">${options(de)}</select></label><label class="esc-choix">À<select id="esc-a">${options(a)}</select></label>`;
  const plies = lirePlies(), rang = e => ORDRE_TYPES.indexOf(e.type);
  // Un niveau au-dessus de « De » est sauté (ses enfants remontent), un niveau au-delà de « À » est caché
  const visibles = id => enfants(id).flatMap(k => rang(k) > a ? [] : rang(k) < de ? visibles(k.id) : [k]);
  let html = "";
  const parcourir = (liste, niv) => liste.forEach(e => {
    const kids = visibles(e.id), plie = plies.has(e.id);
    html += `<div class="ligne esc${estContenant(e) ? " contenant" : ""}${e.quantite === 0 ? " epuise" : ""}" data-id="${e.id}" style="padding-left:${4 + niv * 16}px">
      ${kids.length ? `<button class="esc-fleche" data-plier="${e.id}" aria-label="${plie ? "Déplier" : "Replier"}">${icone(plie ? "chevron-right" : "chevron-down")}</button>` : `<span class="esc-fleche"></span>`}
      ${vignette(e)}<span class="l-nom"><span class="l-n">${echapper(e.nom)}</span>${qteHTML(e)}${pastillesHTML(e)}</span></div>`;
    if (kids.length && !plie) parcourir(kids, niv + 1);
  });
  parcourir(visibles(""), 0);
  $("vue-onglet").innerHTML = html || `<p class="vide">Rien à ce niveau</p>`;
}

// Recherche : chaque mot doit se trouver dans le nom, les tags, la note ou l'emplacement.
// « #tag » = seulement ce tag.
function afficherResultats(q) {
  $("fil").hidden = true; $("courant").hidden = true;
  const tag = q.startsWith("#") ? simplifier(q.slice(1)) : "";
  const mots = simplifier(q).split(/\s+/).filter(Boolean);
  const res = [...elements.values()].filter(e => {
    if (e.archive) return false;
    if (filtre && !FILTRES[filtre][1](e)) return false;
    if (!q) return true;
    if (tag) return e.tags.some(t => simplifier(t) === tag);
    const texte = simplifier([e.nom, ...e.tags, e.note, cheminTexte(e)].join(" "));
    return mots.every(m => texte.includes(m));
  });
  const debut = e => simplifier(e.nom).startsWith(mots[0] || "") ? 0 : 1;
  res.sort((a, b) => debut(a) - debut(b) || triNom(a, b));
  $("liste").innerHTML = res.length ? res.slice(0, 300).map(e => ligneHTML(e, true)).join("") : `<p class="vide">Rien trouvé</p>`;
}

let sensQte = "";   // le chiffre de la quantité « roule » vers le haut ou le bas
function ouvrirFiche(id) {
  const e = elements.get(id);
  if (!e) { fermerVoile(); return; }
  const kids = enfants(id), anc = ancetres(e), cont = estContenant(e);
  ouvrirVoile(`
    ${e.photo ? `<img class="f-photo" src="${e.photo}" alt="">` : ""}
    <div class="f-tete">${e.photo ? "" : vignette(e)}
      <div class="f-titre"><h2>${echapper(e.nom)}</h2><span class="f-type">${TYPES[e.type].nom}</span>${pastillesHTML(e)}</div>
      <div class="menu-wrap"><button class="btn-icone" data-action="menu" aria-label="Plus">${icone("dots")}</button>
        <div class="menu" hidden>
          <button data-action="modifier">${icone("pencil")}Modifier</button>
          ${kids.length ? `<button data-action="verifier">${icone("check")}Vérifier le contenu</button>` : ""}
          ${e.type === "lieu" && !e.parent ? `<button data-action="principal">${icone("star")}${e.principal ? "Plus lieu principal" : "Lieu principal"}</button>` : ""}
          <button data-action="sortir" class="danger">${icone("archive")}Sortir de l'inventaire</button>
        </div></div>
      <button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button>
    </div>
    ${anc.length || !e.mobile ? `<div class="f-chemin">${icone("map-pin")}${anc.length
      ? anc.map(a => `<button data-vers="${a.id}">${echapper(a.nom)}</button>`).join(`<span class="sep">›</span>`)
      : `<span>Tout en haut</span>`}</div>` : ""}
    ${e.quantite != null ? `<div class="f-qte${e.quantite === 0 ? " epuise" : ""}"><span class="h4">Quantité</span>
      <button class="btn-icone petit" data-action="qte-moins" aria-label="Moins">${icone("minus")}</button><b class="${sensQte ? "roule-" + sensQte : ""}">${e.quantite}</b>
      <button class="btn-icone petit" data-action="qte-plus" aria-label="Plus">${icone("plus")}</button>${e.quantite === 0 ? `<span class="f-type">épuisé</span>` : ""}</div>` : ""}
    ${e.note ? `<p class="f-note">${echapper(e.note)}</p>` : ""}
    ${e.tags.length ? `<div class="f-tags">${e.tags.map(t => `<button class="puce" data-tag="${echapper(t)}">${echapper(t)}</button>`).join("")}</div>` : ""}
    ${kids.length ? `<div class="f-contenu"><span class="h4">Contient</span> ${echapper(kids.map(k => k.nom).join(", "))}</div>` : ""}
    ${achatHTML(e.achat)}
    <div class="f-actions">
      ${e.etat === "introuvable" ? `<button class="btn plein" data-action="retrouve">${icone("check")}Retrouvé</button>` : ""}
      <button class="btn${e.etat === "introuvable" ? "" : " plein"}" data-action="deplacer">${icone("transfer")}${e.etat === "aranger" || (!e.parent && e.type === "objet") ? "Ranger" : "Déplacer"}</button>
      ${cont || anc.length ? `<button class="btn" data-action="${cont ? "ouvrir" : "endroit"}">${icone(cont ? "chevron-right" : "map-pin")}${cont ? "Ouvrir" : "Voir l'endroit"}</button>` : ""}
    </div>
    ${e.historique.length ? `<details class="f-histo"><summary>${icone("history")}Anciens endroits</summary>
      ${[...e.historique].reverse().map(h => `<div class="h-ligne"><span>${echapper(h.de || "Tout en haut")}</span><span class="date">${dateCourte(h.le)}</span></div>`).join("")}
    </details>` : ""}`, "fiche", id);
  sensQte = "";
}

// Bloc « Achat » de la fiche : date, prix, garantie (avec badge), facture
const euros = p => p.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const dateIso = s => s ? dateCourte(new Date(s + "T12:00").getTime()) : "";
function achatHTML(a) {
  if (!a) return "";
  const lignes = [];
  if (a.date || a.prix != null) lignes.push(`<span>${[a.date ? "Acheté le " + dateIso(a.date) : "", a.prix != null ? euros(a.prix) : ""].filter(Boolean).join(" · ")}</span>`);
  if (a.garantie) {
    const ok = new Date(a.garantie + "T23:59") >= new Date();
    lignes.push(`<span>Garantie jusqu'au ${dateIso(a.garantie)} <span class="badge ${ok ? "ok" : "fini"}">${ok ? "sous garantie" : "finie"}</span></span>`);
  }
  return `<div class="f-achat">${lignes.join("")}${a.facture ? `<button class="f-facture" data-action="facture">${icone("photo")}Facture</button>` : ""}</div>`;
}
function voirImage(src) {
  const v = document.createElement("div");
  v.className = "visionneuse";
  v.innerHTML = `<img src="${src}" alt="">`;
  v.addEventListener("click", () => v.remove());
  document.body.appendChild(v);
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
    type: neuf ? (typeImpose || TYPE_PROPOSE[parentEl ? parentEl.type : ""]) : e.type, photo: e?.photo || "",
    etat: e?.etat || "", mobile: !!e?.mobile, facture: e?.achat?.facture || "", couleur: e?.couleur || "" };
  const a = e?.achat || {};
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
    <div class="f-couleurs">${["", ...COULEURS].map(c => `<button type="button" class="pastel${c ? " coul-" + c : " aucune"}" data-couleur="${c}" aria-pressed="${c === form.couleur}" aria-label="${c || "Sans couleur"}"></button>`).join("")}</div>
    <div class="f-etats">
      <button type="button" class="filtre p-aranger" data-etat="aranger" aria-pressed="${form.etat === "aranger"}">À ranger</button>
      <button type="button" class="filtre p-mobile" data-etat="mobile" aria-pressed="${form.mobile}">Mobile</button>
      <button type="button" class="filtre p-introuvable" data-etat="introuvable" aria-pressed="${form.etat === "introuvable"}">Introuvable</button>
      <label class="f-qte-champ">Quantité <input id="f-qte" type="number" inputmode="numeric" min="0" value="${e?.quantite ?? ""}"></label>
    </div>
    <details class="f-achat-form"${e?.achat ? " open" : ""}><summary>${icone("tag")}Achat et garantie</summary>
      <div class="f-grille">
        <label>Acheté le<input id="f-date" type="date" class="champ" value="${a.date || ""}"></label>
        <label>Prix (€)<input id="f-prix" type="text" inputmode="decimal" class="champ" value="${a.prix != null ? String(a.prix).replace(".", ",") : ""}"></label>
        <label>Garantie jusqu'au<input id="f-garantie" type="date" class="champ" value="${a.garantie || ""}"></label>
        <div class="f-ans"><button type="button" class="puce" data-ans="1">+1 an</button><button type="button" class="puce" data-ans="2">+2 ans</button></div>
      </div>
      <div class="photo-zone" id="f-facture"></div>
    </details>
    <div class="f-actions">
      ${neuf ? `<button type="button" class="btn" data-action="enreg-autre">${icone("plus")}Autre</button>` : ""}
      <button type="submit" class="btn plein">${icone("check")}Enregistrer</button>
    </div>
    <input type="file" id="f-fichier" accept="image/*" hidden>
    <input type="file" id="f-fichier-facture" accept="image/*" hidden>
  </form>`, "form");
  majPhotoForm(); majSuggestions(); majFactureForm();
  if (neuf) $("f-nom").focus();
}
function majPhotoForm() {
  $("f-photo").innerHTML = form.photo
    ? `<img src="${form.photo}" alt=""><button type="button" class="btn" data-action="photo">${icone("camera")}Changer</button><button type="button" class="btn danger" data-action="retirer-photo">${icone("trash")}</button>`
    : `<button type="button" class="btn" data-action="photo">${icone("camera")}Photo</button>`;
}
function majFactureForm() {
  $("f-facture").innerHTML = form.facture
    ? `<img src="${form.facture}" alt=""><button type="button" class="btn" data-action="facture-photo">${icone("camera")}Changer</button><button type="button" class="btn danger" data-action="retirer-facture">${icone("trash")}</button>`
    : `<button type="button" class="btn" data-action="facture-photo">${icone("camera")}Photo de la facture</button>`;
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
  // Objet tapé sans endroit (ni mobile) : il tombe tout seul dans « À ranger »
  let etat = form.etat;
  if (!form.id && !base.parent && form.type === "objet" && !form.mobile && !etat) etat = "aranger";
  const q = $("f-qte").value.trim();
  const achat = normaliserAchat({ date: $("f-date").value, garantie: $("f-garantie").value, prix: $("f-prix").value.replace(",", ".").trim() || null, facture: form.facture });
  ecrire([normaliser(base.id, { ...base, nom, type: form.type, note: $("f-note").value.trim(), tags, photo: form.photo,
    etat, mobile: form.mobile, quantite: q === "" ? null : q, achat, couleur: form.couleur })]);
  vibrer("succes"); feterCoche();
  if (autre) {   // saisie à la chaîne : même endroit, même type
    afficherToast(`Ajouté : ${nom}`, null);
    ouvrirFormulaire(null, form.parent, form.type);
  } else retour();
}

// Photo réduite (≈ 480 px, < 60 Ko) : juste pour reconnaître l'objet, et léger à synchroniser
async function reduirePhoto(fichier, taille0 = 480, limite = 80000) {
  const bmp = await createImageBitmap(fichier, { imageOrientation: "from-image" });
  let taille = taille0, qualite = 0.7, resultat = "";
  for (let essai = 0; essai < 6; essai++) {
    const r = Math.min(1, taille / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    resultat = c.toDataURL("image/jpeg", qualite);
    if (resultat.length < limite) break;
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
    const res = [...elements.values()].filter(x => !x.archive && !interdits.has(x.id) && mots.every(m => simplifier(x.nom + " " + cheminTexte(x)).includes(m))).sort(triNom);
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
  document.querySelectorAll("[data-vib-choix]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vibChoix === "oui") === String(reglages.vibrations !== false)));
  $("btn-deconnexion").hidden = MODE_DEMO;
  majSynchro();
}
function afficherTheme() {
  document.querySelectorAll("[data-theme-choix]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themeChoix === reglages.theme));
}

// ---------- 6. Actions ----------

// Vibrations (réglage par appareil) : petites, différentes selon le moment
const VIBRATIONS = { tic: 6, ouvre: 10, prise: 14, depot: [12, 40, 18], succes: [8, 50, 14] };
function vibrer(type) { if (reglages.vibrations !== false) navigator.vibrate?.(VIBRATIONS[type] || 8); }

// Petites récompenses : coche qui se dessine, éclat de confettis
function feterCoche() {
  if (animationsReduites()) return;
  const d = document.createElement("div");
  d.className = "recompense";
  d.innerHTML = `<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg>`;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 900);
}
function eclat() {
  if (animationsReduites()) return;
  const d = document.createElement("div");
  d.className = "eclat";
  d.innerHTML = Array.from({ length: 14 }, (_, i) => {
    const a = i / 14 * Math.PI * 2, r = 70 + (i % 3) * 22;
    return `<i style="--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r}px;--c:${["#E9A72E", "#DD5F45", "#3F9A5A", "#3F7FD9", "#A9784A", "#DB5E93"][i % 6]}"></i>`;
  }).join("");
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 900);
}

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
  const avant = { parent: e.parent, historique: e.historique, etat: e.etat };
  const dest = elements.get(versId);
  // Rangé quelque part = plus « à ranger » ni « introuvable »
  ecrire([{ ...e, parent: versId, etat: versId ? "" : e.etat, historique: [...e.historique, { de: cheminTexte(e), le: Date.now() }].slice(-MAX_HISTO) }]);
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

// --- Voir l'endroit : pop-up qui zoome du plan entier vers la pièce, allume le meuble,
// puis montre sa vue de face avec la case (et l'objet) allumés. Toucher = sauter l'animation. ---
let animEndroit = 0;
const boxTexte = b => `${b.x} ${b.y} ${b.w} ${b.h}`;
const animationsReduites = () => document.documentElement.dataset.anim === "simples" || matchMedia("(prefers-reduced-motion: reduce)").matches;
function ouvrirEndroit(id) {
  const e = elements.get(id);
  if (!e) { fermerVoile(); return; }
  const anc = ancetres(e), chaine = [e, ...[...anc].reverse()], lieu = anc[0] || e;
  const plan = planVide(lieu.plan) ? null : lieu.plan;
  const iM = chaine.findIndex(x => x.facade), meuble = iM > 0 ? chaine[iM] : null;
  const cols = meuble ? colonnesValides(meuble) : [];
  let b0 = null, b1 = null, svg = "";
  if (plan) {
    const c = cadrage(plan, chaine.map(x => x.id)), rot = lireRotation(lieu.id), ctr = centrePlan(plan);
    b0 = boiteTournee(cadrage(plan, []).box, rot, ctr); b1 = boiteTournee(c.box, rot, ctr);
    svg = svgVue(plan, { rot, W: 340, H: 200 }, b0, c.focus);
  }
  ouvrirVoile(`<div class="f-tete"><h2>${echapper(e.nom)}</h2><button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="f-chemin">${icone("map-pin")}<span>${echapper(cheminTexte(e) || "Tout en haut")}</span></div>
    <div class="scene" id="scene">
      ${svg ? `<div class="sc-plan">${svg}</div>` : ""}
      ${cols.length ? `<div class="sc-facade"${svg ? " hidden" : ""}>${facadeHTML(cols, { focus: chaine[iM - 1].id, objet: e.id, ratio: meuble.facade.ratio, largeur: meuble.facade.largeur })}</div>` : ""}
      ${!svg && !cols.length ? `<p class="vide">Pas de plan pour ce lieu</p>` : ""}
    </div>
    <div class="f-actions"><button class="btn plein" data-action="ouvrir">${icone("map-pin")}Y aller</button></div>`, "endroit", id);
  const scene = $("scene"), sv = scene.querySelector("svg"), fa = scene.querySelector(".sc-facade");
  const montrerFacade = () => { if (fa && fa.hidden) { fa.hidden = false; fa.classList.add("apparait"); vibrer("tic"); } };
  const fin = () => { cancelAnimationFrame(animEndroit); clearTimeout(animEndroit); if (sv) sv.setAttribute("viewBox", boxTexte(b1)); montrerFacade(); };
  scene.addEventListener("click", fin);
  if (!sv || animationsReduites()) { fin(); return; }
  // Zoom doux (accélère puis ralentit) du plan entier vers la pièce, après un court temps de pause
  const t0 = performance.now() + 350, D = 900;
  const pas = now => {
    const t = Math.min(1, Math.max(0, (now - t0) / D)), s = t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    sv.setAttribute("viewBox", ["x", "y", "w", "h"].map(c => b0[c] + (b1[c] - b0[c]) * s).join(" "));
    if (t < 1) animEndroit = requestAnimationFrame(pas);
    else animEndroit = setTimeout(montrerFacade, 450);
  };
  animEndroit = requestAnimationFrame(pas);
}

// --- Sortir de l'inventaire (archive) ---
function ouvrirSortir(id) {
  const e = elements.get(id);
  if (!e) { fermerVoile(); return; }
  const n = descendants(id).length;
  ouvrirVoile(`<div class="f-tete"><h2>Sortir « ${echapper(e.nom)} »</h2><button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    ${n ? `<p class="f-type">avec son contenu (${n})</p>` : ""}
    <div class="raisons">${Object.entries(RAISONS).map(([k, r]) => `<button class="btn" data-raison="${k}">${r}</button>`).join("")}</div>
    <button class="lien-danger" data-action="supprimer">Supprimer pour de bon</button>`, "sortir", id);
}
function archiver(id, raison) {
  const e = elements.get(id);
  if (!e) return;
  const ids = [id, ...descendants(id)], le = Date.now();
  const copies = ids.map(i => elements.get(i));
  retour();
  ecrire(copies.map(x => ({ ...x, archive: { raison, le, de: cheminTexte(x), avec: x.id === id ? "" : id } })));
  vibrer("depot");
  afficherToast(`${e.nom} → Archive (${RAISONS[raison]})`, () => ecrire(copies));
}
const groupeArchive = id => [...elements.values()].filter(x => x.id === id || x.archive?.avec === id);
function restaurer(id) {
  const g = groupeArchive(id), e = elements.get(id);
  if (!e) return;
  // L'ancien contenant a disparu ou est archivé : tout en haut, « à ranger »
  const parentOk = elements.has(e.parent) && !elements.get(e.parent).archive;
  ecrire(g.map(x => x.id === id ? { ...x, archive: null, parent: parentOk ? x.parent : "", etat: parentOk ? x.etat : "aranger" } : { ...x, archive: null }));
  afficherToast(`${e.nom} restauré`, null);
  afficherArchive();
}
function supprimerDefinitif(id) {
  const g = groupeArchive(id), e = elements.get(id);
  if (!e || !confirm(`Supprimer « ${e.nom} »${g.length > 1 ? ` et son contenu (${g.length - 1})` : ""} pour de bon ? Impossible de revenir en arrière.`)) return;
  effacer(g.map(x => x.id));
  afficherArchive();
}
function afficherArchive() {
  const q = simplifier($("archive-cherche").value);
  const l = [...elements.values()].filter(e => e.archive && !e.archive.avec && (!q || simplifier(e.nom + " " + e.archive.de).includes(q)))
    .sort((a, b) => b.archive.le - a.archive.le);
  $("liste-archive").innerHTML = l.length ? l.map(e => {
    const n = groupeArchive(e.id).length - 1;
    return `<details class="a-ligne"><summary>${vignette(e)}<span class="l-txt"><span class="l-nom">${echapper(e.nom)}${n ? ` <span class="qte">+${n}</span>` : ""}</span>
      <span class="l-sous">${RAISONS[e.archive.raison]} · ${dateCourte(e.archive.le)}${e.archive.de ? " · " + echapper(e.archive.de) : ""}</span></span></summary>
      <div class="a-actions"><button class="btn" data-restaurer="${e.id}">${icone("undo")}Restaurer</button>
        <button class="btn danger" data-supprimer-def="${e.id}">${icone("trash")}Supprimer</button></div></details>`;
  }).join("") : `<p class="vide">Vide</p>`;
}

// --- Vérifier le contenu (mode inventaire) : pas coché = introuvable ---
function ouvrirVerifier(id) {
  const e = elements.get(id), kids = enfants(id);
  if (!e || !kids.length) { fermerVoile(); return; }
  ouvrirVoile(`<div class="f-tete"><h2>Vérifier « ${echapper(e.nom)} »</h2><button class="btn-icone" data-action="fermer" aria-label="Fermer">${icone("x")}</button></div>
    <div class="v-liste">${kids.map(k => `<label class="v-ligne"><input type="checkbox" data-verif="${k.id}"${k.etat === "introuvable" ? "" : " checked"}>
      ${vignette(k)}<span class="l-nom"><span class="l-n">${echapper(k.nom)}</span>${qteHTML(k)}</span></label>`).join("")}</div>
    <div class="f-actions"><button class="btn" data-action="verif-tout">Tout cocher</button><button class="btn plein" data-action="verif-fini">${icone("check")}Terminé</button></div>`, "verifier", id);
}
function finirVerifier() {
  const changes = [];
  document.querySelectorAll("[data-verif]").forEach(c => {
    const k = elements.get(c.dataset.verif);
    if (!k) return;
    if (!c.checked && k.etat !== "introuvable") changes.push({ ...k, etat: "introuvable" });
    if (c.checked && k.etat === "introuvable") changes.push({ ...k, etat: "" });
  });
  const manquants = [...document.querySelectorAll("[data-verif]")].filter(c => !c.checked).length;
  if (changes.length) ecrire(changes);
  if (!manquants) { eclat(); vibrer("succes"); }
  retour();
  afficherToast(manquants ? `${manquants} introuvable${manquants > 1 ? "s" : ""}` : "Tout est là", null);
}

let minuteurNomCase = null;
let ignorerClic = false;   // juste après un glisser, le « clic » du lâcher ne doit rien ouvrir
document.addEventListener("click", ev => {
  if (ignorerClic) { ev.preventDefault(); ev.stopPropagation(); return; }
  const t = ev.target;
  const el = s => t.closest(s);
  let b;
  if ((b = el("[data-aller]"))) { const a = b.dataset.aller; a === "accueil" ? naviguer(hashSous && !COUCHES.includes(cleDe(hashSous)) ? hashSous : "") : naviguer(a); return; }
  if ((b = el("[data-theme-choix]"))) { changerReglage("theme", b.dataset.themeChoix); window.appliquerTheme(b.dataset.themeChoix); afficherTheme(); return; }
  if ((b = el("[data-vib-choix]"))) { changerReglage("vibrations", b.dataset.vibChoix === "oui"); afficherReglages(); vibrer("succes"); return; }
  if ((b = el("[data-anim-choix]"))) { changerReglage("animations", b.dataset.animChoix); document.documentElement.dataset.anim = b.dataset.animChoix; afficherReglages(); return; }
  if (t === $("ecran-reglages") || t === $("ecran-theme") || t === $("ecran-archive")) { naviguer(hashSous && !COUCHES.includes(cleDe(hashSous)) ? hashSous : ""); return; }
  if ((b = el("[data-restaurer]"))) { restaurer(b.dataset.restaurer); return; }
  if ((b = el("[data-supprimer-def]"))) { supprimerDefinitif(b.dataset.supprimerDef); return; }

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
      else if (a === "sortir") remplacer("sortir=" + voileId);
      else if (a === "principal") {   // un seul lieu principal
        const e = elements.get(voileId), devient = !e.principal;
        ecrire([...elements.values()].filter(x => x.principal && x.id !== e.id).map(x => ({ ...x, principal: false })).concat([{ ...e, principal: devient }]));
        afficherToast(devient ? `${e.nom} : lieu principal` : `${e.nom} n'est plus le lieu principal`, null);
      }
      else if (a === "endroit") remplacer("endroit=" + voileId);
      else if (a === "verifier") remplacer("verifier=" + voileId);
      else if (a === "verif-tout") $("voile").querySelectorAll("[data-verif]").forEach(c => { c.checked = true; });
      else if (a === "verif-fini") finirVerifier();
      else if (a === "retrouve") { const e = elements.get(voileId); ecrire([{ ...e, etat: "" }]); afficherToast(`${e.nom} retrouvé`, null); }
      else if (a === "qte-plus" || a === "qte-moins") {
        const e = elements.get(voileId);
        sensQte = a === "qte-plus" ? "haut" : "bas"; vibrer("tic");
        ecrire([{ ...e, quantite: Math.max(0, e.quantite + (a === "qte-plus" ? 1 : -1)) }]);
      }
      else if (a === "facture") voirImage(elements.get(voileId).achat.facture);
      else if (a === "facture-photo") $("f-fichier-facture").click();
      else if (a === "retirer-facture") { form.facture = ""; majFactureForm(); }
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
    if ((b = el("[data-raison]"))) { archiver(voileId, b.dataset.raison); return; }
    if ((b = el("[data-couleur]"))) {
      form.couleur = b.dataset.couleur;
      $("voile").querySelectorAll("[data-couleur]").forEach(x => x.setAttribute("aria-pressed", x === b));
      vibrer("tic"); return;
    }
    if ((b = el("[data-etat]"))) {
      const k = b.dataset.etat;
      if (k === "mobile") { form.mobile = !form.mobile; if (form.mobile && form.etat === "aranger") form.etat = ""; }
      else { form.etat = form.etat === k ? "" : k; if (k === "aranger") form.mobile = false; }
      $("voile").querySelectorAll("[data-etat]").forEach(x => x.setAttribute("aria-pressed", x.dataset.etat === "mobile" ? form.mobile : x.dataset.etat === form.etat));
      return;
    }
    if ((b = el("[data-ans]"))) {   // garantie = date d'achat (ou aujourd'hui) + 1 ou 2 ans
      const d = $("f-date").value ? new Date($("f-date").value + "T12:00") : new Date();
      d.setFullYear(d.getFullYear() + +b.dataset.ans);
      $("f-garantie").value = d.toISOString().slice(0, 10);
      return;
    }
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
  if ((b = el("[data-onglet]"))) {
    const k = b.dataset.onglet;
    if (k === onglet && k === "maison") { $("recherche").value = ""; remplacer(""); return; }   // 2e toucher sur Maison = retour à l'accueil
    remplacer(k === "maison" ? (dansId ? "dans=" + dansId : "") : k);
    window.scrollTo(0, 0);
    return;
  }
  if (el("[data-action='remonter']")) { retour(); return; }   // flèche ← : remonter d'un cran
  if (el("[data-action='nord']")) {   // boussole : le plan revient doucement au nord
    const svg = $("plan").querySelector(".plan-vue"), lieu = $("plan").dataset.lieu, r0 = Number(svg?.dataset.rot) || 0;
    noterRotation(lieu, 0);
    if (!svg || animationsReduites()) { afficherAccueil(); return; }
    const t0 = performance.now(), pas = now => {
      const t = Math.min(1, (now - t0) / 350);
      appliquerRotation(svg, r0 * (1 - t) * (1 - t));
      if (t < 1) requestAnimationFrame(pas); else afficherAccueil();
    };
    requestAnimationFrame(pas);
    return;
  }
  if ((b = el("[data-tri]"))) { changerReglage("triObjets", b.dataset.tri); afficherAccueil(); return; }
  if ((b = el("[data-plier]"))) { plier(b.dataset.plier); afficherAccueil(); return; }
  if ((b = el("[data-filtre]"))) { filtre = filtre === b.dataset.filtre ? "" : b.dataset.filtre; afficherAccueil(); return; }
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
  if (el("[data-action='ajouter-ici']")) { aller("ajouter=" + ($("liste").dataset.depot || "")); return; }
  if (t.closest("#btn-ajouter")) { aller("ajouter=" + ($("recherche").value.trim() || onglet !== "maison" ? "" : dansId)); return; }
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
  else if (ev.target.id === "archive-cherche") afficherArchive();
  else if (ev.target.id === "f-tags") majSuggestions();
  else if (ev.target.id === "c-nom") {   // nom d'une case : enregistré après une petite pause
    clearTimeout(minuteurNomCase);
    const id = voileId, nom = ev.target.value.trim();
    minuteurNomCase = setTimeout(() => { const e = elements.get(id); if (e && nom && e.nom !== nom) ecrire([{ ...e, nom }]); }, 500);
  }
});
document.addEventListener("change", ev => {
  if (ev.target.dataset.verif) vibrer("tic");
  if (ev.target.id === "esc-de" || ev.target.id === "esc-a") { changerReglage(ev.target.id === "esc-de" ? "escDe" : "escA", ev.target.value); afficherAccueil(); }
});
document.addEventListener("change", async ev => {
  const id = ev.target.id, f = ev.target.files?.[0];
  if (!f || (id !== "f-fichier" && id !== "f-fichier-facture")) return;
  try {
    // Facture : plus grande, pour pouvoir lire le texte
    if (id === "f-fichier") { form.photo = await reduirePhoto(f); majPhotoForm(); }
    else { form.facture = await reduirePhoto(f, 1100, 200000); majFactureForm(); }
  } catch (e) { afficherToast("Photo illisible", null); }
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

// ---------- 7. Glisser un objet vers un autre endroit ----------
// Téléphone : appui long (0,4 s) puis glisser. PC : glisser direct à la souris.
// Au doigt on écoute les événements « touch » (et pas « pointer ») : Chrome Android peut
// interrompre un geste « pointer » (appui long natif, début de défilement) et l'objet retombait.
// Avec « touch », bloquer touchmove une fois l'objet attrapé suffit à garder la main.
// Seule une étiquette (icône + nom) suit le doigt. Rester 1 s immobile sur un endroit (fil d'Ariane,
// contenant, pièce du plan, case) l'ouvre sans lâcher (un rond se remplit) ; bouger annule.
let glisse = null;
const OUVRIR_APRES = 1000;
function brancherGlisser(zone) {
  // --- Doigt ---
  zone.addEventListener("touchstart", ev => {
    if (ev.touches.length !== 1 || glisse) return;
    const ligne = ev.target.closest(".ligne");
    if (!ligne || ev.target.closest("[data-plier]")) return;
    if (zone === $("liste") && $("recherche").value.trim()) return;
    const t0 = ev.touches[0], depart = { x: t0.clientX, y: t0.clientY }, id = t0.identifier;
    const minuteur = setTimeout(() => attraper(ligne, depart, id), 400);
    const trouver = e => [...e.changedTouches].find(t => t.identifier === id);
    const bouger = e => {
      const t = trouver(e);
      if (!t) return;
      if (!glisse) {   // avant l'appui long : un doigt qui bouge = défilement normal
        if (Math.hypot(t.clientX - depart.x, t.clientY - depart.y) > 10) { clearTimeout(minuteur); finir(); }
        return;
      }
      e.preventDefault();
      suivreGlisse({ clientX: t.clientX, clientY: t.clientY });
    };
    const lacher = e => {
      if (!trouver(e)) return;
      clearTimeout(minuteur); finir();
      if (glisse) { e.preventDefault(); lacherGlisse(e.type === "touchend"); }
    };
    const finir = () => {
      document.removeEventListener("touchmove", bouger);
      document.removeEventListener("touchend", lacher);
      document.removeEventListener("touchcancel", lacher);
    };
    document.addEventListener("touchmove", bouger, { passive: false });
    document.addEventListener("touchend", lacher, { passive: false });
    document.addEventListener("touchcancel", lacher);
  }, { passive: true });
  // --- Souris (PC) : glisser dès que la souris bouge, bouton enfoncé ---
  zone.addEventListener("pointerdown", ev => {
    if (ev.pointerType !== "mouse" || ev.button > 0 || glisse) return;
    const ligne = ev.target.closest(".ligne");
    if (!ligne || ev.target.closest("[data-plier]")) return;
    if (zone === $("liste") && $("recherche").value.trim()) return;
    const depart = { x: ev.clientX, y: ev.clientY };
    const bouger = e => {
      if (!glisse) { if (Math.hypot(e.clientX - depart.x, e.clientY - depart.y) > 8) attraper(ligne, depart, "souris"); else return; }
      suivreGlisse(e);
    };
    const lacher = e => {
      document.removeEventListener("pointermove", bouger);
      document.removeEventListener("pointerup", lacher);
      if (glisse) lacherGlisse(e.type === "pointerup");
    };
    document.addEventListener("pointermove", bouger);
    document.addEventListener("pointerup", lacher);
  });
  // Appui long : pas de menu du téléphone ni de sélection de texte sur les lignes
  zone.addEventListener("contextmenu", ev => { if (ev.target.closest(".ligne")) ev.preventDefault(); });
}
brancherGlisser($("liste"));
brancherGlisser($("vue-onglet"));

function attraper(ligne, depart, doigt) {
  const e = elements.get(ligne.dataset.id);
  if (!e) return;
  const etiquette = document.createElement("div");
  etiquette.className = "etiquette";
  etiquette.innerHTML = `${vignette(e)}<span>${echapper(e.nom)}</span>`;
  document.body.appendChild(etiquette);
  ligne.classList.add("souleve");
  glisse = { id: e.id, ligne, etiquette, x: depart.x, y: depart.y, cible: null, survol: null, minuteur: 0, doigt,
    interdits: new Set([e.id, ...descendants(e.id)]), defile: 0 };
  placerEtiquette();
  vibrer("prise");
  defilerAuto();
}
// L'étiquette flotte au-dessus du doigt (sinon le doigt la cache)
function placerEtiquette() { glisse.etiquette.style.transform = `translate(${glisse.x - 22}px, ${glisse.y - 62}px)`; }
function suivreGlisse(e) {
  const g = glisse;
  g.x = e.clientX; g.y = e.clientY;
  placerEtiquette();
  g.defile = g.y < 70 ? -1 : g.y > innerHeight - 140 ? 1 : 0;
  // Le doigt bouge pendant l'attente : on recommence l'attente (il faut rester immobile pour ouvrir)
  if (g.attente && Math.hypot(g.x - g.attente.x, g.y - g.attente.y) > 16) armerSurvol(g, g.cible);
  chercherCible();
}
const elementVise = c => c && (c.dataset.lien && !elements.has(c.dataset.lien) ? null : c);
function chercherCible() {
  const g = glisse;
  const sous = document.elementFromPoint(g.x, g.y);
  let c = sous && elementVise(sous.closest(".ligne") || sous.closest(".fil-bout") || sous.closest(".plan-vue [data-lien]")
    || sous.closest(".fa-boite.contenant") || sous.closest(".fa-case[data-case]"));
  // Ailleurs sur la liste (ou sur l'en-tête de l'endroit ouvert) : ranger ici
  if (!c && sous && (sous.closest("#liste") || sous.closest("#courant")) && !$("liste").hidden) c = $("liste");
  const id = c ? cibleId(c) : null;
  if (c && g.interdits.has(id)) c = null;
  if (c === g.cible) return;
  g.cible?.classList.remove("cible");
  g.cible = c;
  if (c && cibleId(c) !== (elements.get(g.id)?.parent || "")) c.classList.add("cible");
  armerSurvol(g, c);
}
// Survol prolongé d'un endroit qui s'ouvre (pas la liste elle-même, pas un objet) :
// un rond se remplit autour du doigt pendant 1 s, puis l'endroit s'ouvre.
function armerSurvol(g, c) {
  clearTimeout(g.minuteur);
  g.anneau?.remove(); g.anneau = null; g.attente = null;
  if (!c) return;
  const vise = elements.get(cibleId(c));
  const ouvrable = c !== $("liste") && (c.classList.contains("fil-bout") || (vise && estContenant(vise)));
  if (!ouvrable) return;
  g.attente = { x: g.x, y: g.y };
  g.anneau = document.createElement("div");
  g.anneau.className = "anneau";
  g.anneau.style.transform = `translate(${g.x - 28}px, ${g.y - 28}px)`;
  g.anneau.style.animationDuration = OUVRIR_APRES + "ms";
  document.body.appendChild(g.anneau);
  g.minuteur = setTimeout(() => {
    if (glisse !== g || g.cible !== c) return;
    const dest = cibleId(c);
    vibrer("ouvre");
    g.anneau?.remove(); g.anneau = null; g.attente = null;
    g.cible = null;
    naviguer(dest ? "dans=" + dest : "");
    setTimeout(() => { if (glisse === g) chercherCible(); }, 80);   // la page a changé sous le doigt
  }, OUVRIR_APRES);
}
function defilerAuto() {
  if (!glisse) return;
  if (glisse.defile) { window.scrollBy(0, glisse.defile * 10); chercherCible(); }
  requestAnimationFrame(defilerAuto);
}
function lacherGlisse(ok) {
  const g = glisse; glisse = null;
  clearTimeout(g.minuteur); g.anneau?.remove();
  // (l'étiquette est retirée par poser(), après son petit vol)
  g.ligne.classList.remove("souleve");
  document.querySelectorAll(".souleve").forEach(x => x.classList.remove("souleve"));
  g.cible?.classList.remove("cible", "survol");
  ignorerClic = true; setTimeout(() => { ignorerClic = false; }, 60);
  if (ok && g.cible) poser(g, cibleId(g.cible)); else g.etiquette.remove();
}
// L'objet « se pose » : l'étiquette file vers la destination en rapetissant, puis la ligne d'arrivée rebondit
function poser(g, dest) {
  const vise = g.cible?.getBoundingClientRect?.();
  deplacer(g.id, dest);
  vibrer("depot");
  const arrivee = document.querySelector(`.ligne[data-id="${dest}"]`) || document.querySelector(`.ligne[data-id="${g.id}"]`);
  if (animationsReduites() || !vise) { g.etiquette.remove(); return; }
  const r = arrivee?.getBoundingClientRect() || vise;
  setTimeout(() => g.etiquette.remove(), 600);   // filet de sécurité si l'animation ne se termine pas
  g.etiquette.animate([{ transform: g.etiquette.style.transform, opacity: 1 },
    { transform: `translate(${r.left + 20}px, ${r.top + r.height / 2 - 18}px) scale(.45)`, opacity: .2 }],
    { duration: 260, easing: "cubic-bezier(.5,0,.75,0)" }).finished.then(() => {
    g.etiquette.remove();
    arrivee?.animate([{ transform: "scale(1)" }, { transform: "scale(1.035)", background: "var(--accent-doux)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
  });
}
// Id visé : dessin du plan = son lien (pas son id de dessin) ; liste = l'endroit ouvert
const cibleId = c => c.dataset.lien ?? c.dataset.ouvre ?? c.dataset.case ?? c.dataset.id ?? c.dataset.dans ?? c.dataset.depot;

// ---------- Plan de l'accueil : déplacer (1 doigt, souris), zoomer et tourner (2 doigts, molette) ----------
// Comme une carte : la rotation est libre et retenue sur ce téléphone (par lieu) ; la boussole remet le nord.
// Marche aussi avec un 2e doigt pendant qu'on glisse un objet avec le 1er.
const CLE_ROT = "inv-rotations";
const lireRotations = () => { try { return JSON.parse(localStorage.getItem(CLE_ROT)) || {}; } catch (e) { return {}; } };
const lireRotation = id => Number(lireRotations()[id]) || 0;
function noterRotation(id, rot) {
  const r = lireRotations();
  r[id] = Math.round((((rot % 360) + 540) % 360 - 180) * 10) / 10;   // entre -180 et 180
  try { localStorage.setItem(CLE_ROT, JSON.stringify(r)); } catch (e) { /* rien */ }
}
const pv = { ptrs: new Map(), svg: null, vb0: null, d0: 0, a0: 0, m0: null, Pp: null, rot0: 0, bouge: false, tourne: false };
const lireVB = svg => { const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number); return { x, y, w, h }; };
function echellePlan(svg, vb) { const r = svg.getBoundingClientRect(); return { r, s: Math.max(vb.w / r.width, vb.h / r.height) }; }
// Rotation d'un point autour du centre du plan (repère « écran » <-> repère du plan)
function tournerPt([x, y], deg, svg) {
  const cx = +svg.dataset.cx, cy = +svg.dataset.cy, r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}
function appliquerRotation(svg, rot) {
  svg.dataset.rot = rot;
  svg.querySelector(".pl-rot").setAttribute("transform", `rotate(${rot} ${svg.dataset.cx} ${svg.dataset.cy})`);
  const b = $("plan").querySelector(".boussole");
  if (b) { b.hidden = Math.abs(((rot % 360) + 540) % 360 - 180) < 1; b.querySelector("svg").style.transform = `rotate(${rot}deg)`; }
}
function departGeste() {
  const p = [...pv.ptrs.values()], svg = pv.svg;
  pv.vb0 = lireVB(svg);
  pv.rot0 = Number(svg.dataset.rot) || 0;
  pv.m0 = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : { ...p[0] };
  pv.d0 = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1 : 0;
  pv.a0 = p.length > 1 ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0;
  pv.tourne = false;
  // Point du plan (non tourné) sous le centre des doigts : il restera sous les doigts
  const { r, s } = echellePlan(svg, pv.vb0), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const racine = [pv.vb0.x + pv.vb0.w / 2 + (pv.m0.x - cx) * s, pv.vb0.y + pv.vb0.h / 2 + (pv.m0.y - cy) * s];
  pv.Pp = tournerPt(racine, -pv.rot0, svg);
}
$("plan").addEventListener("pointerdown", ev => {
  const svg = ev.target.closest(".plan-vue");
  if (!svg || (glisse && ev.pointerId === glisse.doigt)) return;
  pv.svg = svg;
  pv.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pv.ptrs.size === 1) pv.bouge = false;
  departGeste();
});
document.addEventListener("pointermove", ev => {
  if (!pv.ptrs.has(ev.pointerId)) return;
  pv.ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  const p = [...pv.ptrs.values()], vb0 = pv.vb0, { r, s } = echellePlan(pv.svg, vb0);
  const m = p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0];
  if (!pv.bouge && Math.hypot(m.x - pv.m0.x, m.y - pv.m0.y) < 5 && p.length < 2) return;
  pv.bouge = true;
  let z = 1, rot = pv.rot0;
  if (p.length > 1) {
    z = Math.min(8, Math.max(0.15, pv.d0 / (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1)));
    // Rotation : seulement après un vrai mouvement de rotation (sinon un simple pincer tournerait un peu)
    let da = (Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) - pv.a0) * 180 / Math.PI;
    da = ((da + 540) % 360) - 180;
    if (Math.abs(da) > 10) pv.tourne = true;
    if (pv.tourne) rot = pv.rot0 + da;
  }
  if (rot !== Number(pv.svg.dataset.rot)) appliquerRotation(pv.svg, rot);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const [qx, qy] = tournerPt(pv.Pp, rot, pv.svg);
  const w = vb0.w * z, h = vb0.h * z, s2 = s * z;
  pv.svg.setAttribute("viewBox", `${qx - (m.x - cx) * s2 - w / 2} ${qy - (m.y - cy) * s2 - h / 2} ${w} ${h}`);
});
const finGestePlan = ev => {
  if (!pv.ptrs.has(ev.pointerId)) return;
  pv.ptrs.delete(ev.pointerId);
  if (pv.bouge) { ignorerClic = true; setTimeout(() => { ignorerClic = false; }, 60); }
  if (pv.tourne && $("plan").dataset.lieu) noterRotation($("plan").dataset.lieu, Number(pv.svg.dataset.rot));
  if (pv.ptrs.size) departGeste();
};
document.addEventListener("pointerup", finGestePlan);
document.addEventListener("pointercancel", finGestePlan);
$("plan").addEventListener("wheel", ev => {
  const svg = ev.target.closest(".plan-vue");
  if (!svg) return;
  ev.preventDefault();
  const vb = lireVB(svg), { r, s } = echellePlan(svg, vb), z = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const px = vb.x + vb.w / 2 + (ev.clientX - cx) * s, py = vb.y + vb.h / 2 + (ev.clientY - cy) * s;
  const w = vb.w * z, h = vb.h * z;
  svg.setAttribute("viewBox", `${px - (ev.clientX - cx) * s * z - w / 2} ${py - (ev.clientY - cy) * s * z - h / 2} ${w} ${h}`);
}, { passive: false });

// ---------- 8. Excel ----------
// Une feuille « Inventaire » dans l'ordre de l'arbre (nom décalé selon la profondeur),
// photo dans la 1re colonne. ID et « Dans (ID) » à la fin servent au réimport exact.
const COLONNES = [
  { header: "", key: "_photo", width: 5 },
  { header: "Nom", key: "nom", width: 30 },
  { header: "Type", key: "type", width: 9 },
  { header: "Quantité", key: "quantite", width: 9, centre: true },
  { header: "État", key: "etat", width: 11 },
  { header: "Mobile", key: "mobile", width: 8, centre: true },
  { header: "Couleur", key: "couleur", width: 10 },
  { header: "Emplacement", key: "chemin", width: 38 },
  { header: "Tags", key: "tags", width: 18 },
  { header: "Note", key: "note", width: 30 },
  { header: "Acheté le", key: "achete", width: 11 },
  { header: "Garantie", key: "garantie", width: 11 },
  { header: "Prix", key: "prix", width: 9 },
  { header: "Déplacé le", key: "deplace", width: 12 },
  { header: "ID", key: "id", width: 12 },
  { header: "Dans (ID)", key: "parent", width: 12 }
];
const COLONNES_ARCHIVE = [
  ...COLONNES.slice(0, 4),
  { header: "Raison", key: "raison", width: 9 },
  { header: "Sorti le", key: "sorti", width: 11 },
  { header: "Ancien endroit", key: "de", width: 38 },
  ...COLONNES.slice(8, 13),
  { header: "ID", key: "id", width: 12 },
  { header: "Dans (ID)", key: "parent", width: 12 },
  { header: "Avec (ID)", key: "avec", width: 12 }
];
const iso = ms => new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function ligneXL(e) {
  const der = e.historique[e.historique.length - 1];
  return { nom: e.nom, type: TYPES[e.type].nom, quantite: e.quantite ?? "", etat: ETATS[e.etat] || "", mobile: e.mobile ? "Oui" : "", couleur: e.couleur,
    chemin: cheminTexte(e), tags: e.tags.join(", "), note: e.note, achete: e.achat?.date || "", garantie: e.achat?.garantie || "",
    prix: e.achat?.prix ?? "", deplace: der ? dateCourte(der.le) : "", id: e.id, parent: e.parent, _image: e.photo || undefined,
    raison: e.archive ? RAISONS[e.archive.raison] : "", sorti: e.archive ? iso(e.archive.le) : "", de: e.archive?.de || "", avec: e.archive?.avec || "" };
}
$("btn-export").addEventListener("click", async () => {
  try {
    const ExcelJS = await chargerExcelJS();
    const wb = new ExcelJS.Workbook();
    const lignes = [], profs = [];
    const parcourir = (pid, prof) => enfants(pid).forEach(e => {
      lignes.push(ligneXL(e));
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
    // Archive : ce qui est sorti de l'inventaire, le plus récent d'abord (contenu juste sous son contenant)
    const sortis = [...elements.values()].filter(e => e.archive && !e.archive.avec).sort((a, b) => b.archive.le - a.archive.le)
      .flatMap(e => [e, ...[...elements.values()].filter(x => x.archive?.avec === e.id)]);
    if (sortis.length) ajouterFeuille(wb, "Archive", COLONNES_ARCHIVE, sortis.map(ligneXL), { hauteur: 21, figer: 2 });
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
    const plans = new Map();
    const facades = new Map();
    const lireJSON = c => { try { const t = String(c.text || "").trim(); return t ? JSON.parse(t) : null; } catch (e) { return null; } };   // illisible : ignoré
    wb.getWorksheet("Plans")?.eachRow((rang, n) => {
      if (n === 1) return;
      const id = String(rang.getCell(2).text).trim();
      plans.set(id, lireJSON(rang.getCell(3)));
      facades.set(id, lireJSON(rang.getCell(4)));
    });
    const typeDe = t => ORDRE_TYPES.find(k => simplifier(TYPES[k].nom) === simplifier(t) || k === simplifier(t)) || "objet";
    const cleDe = (table, t) => Object.keys(table).find(k => simplifier(table[k]) === simplifier(t) || k === simplifier(t)) || "";
    // Lit une feuille (Inventaire ou Archive) : colonnes reconnues par leur titre
    const lus = [];
    const lireOnglet = (ws, archive) => {
      if (!ws) return;
      const images = imagesParLigne(wb, ws), cols = {};
      ws.getRow(1).eachCell((c, i) => { cols[simplifier(c.text)] = i; });
      const lire = (rang, nom) => cols[nom] ? String(rang.getCell(cols[nom]).text ?? "").trim() : "";
      ws.eachRow((rang, n) => {
        if (n === 1) return;
        const nom = lire(rang, "nom");
        if (!nom) return;
        const sorti = Date.parse(lire(rang, "sorti le"));
        lus.push({ id: lire(rang, "id") || nouvelId(), nom, type: typeDe(lire(rang, "type")), parentId: lire(rang, "dans (id)"),
          chemin: archive ? "" : lire(rang, "emplacement"), tags: lire(rang, "tags").split(",").map(t => t.trim()).filter(Boolean),
          note: lire(rang, "note"), photo: images.get(n) || "", quantite: lire(rang, "quantite"), etat: cleDe(ETATS, lire(rang, "etat")),
          mobile: /^(oui|x|1|vrai)$/i.test(lire(rang, "mobile")),
          couleur: simplifier(lire(rang, "couleur")),
          achat: { date: lire(rang, "achete le"), garantie: lire(rang, "garantie"), prix: lire(rang, "prix").replace(",", ".") || null },
          archive: archive ? { raison: cleDe(RAISONS, lire(rang, "raison")) || "autre", le: Number.isFinite(sorti) ? sorti : Date.now(),
            de: lire(rang, "ancien endroit"), avec: lire(rang, "avec (id)") } : null });
      });
    };
    lireOnglet(wb.getWorksheet("Inventaire") || wb.worksheets[0], false);
    lireOnglet(wb.getWorksheet("Archive"), true);
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
    // Gardés depuis l'appli (pas dans le fichier) : historique, date de création, photo de facture
    ecrire(lus.map(l => normaliser(l.id, { ...l, parent: l.parentId, plan: plans.get(l.id), facade: facades.get(l.id),
      achat: { ...l.achat, facture: avant.get(l.id)?.achat?.facture || "" },
      historique: avant.get(l.id)?.historique || [], cree: avant.get(l.id)?.cree || Date.now() })));
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
