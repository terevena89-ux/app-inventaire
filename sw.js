// Service worker : garde une copie de l'appli pour l'ouvrir sans réseau, et la met à jour.
// À CHAQUE NOUVELLE VERSION : changer le numéro ci-dessous.
const CACHE = "inventaire-v0.4.0";

const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "plan.js", "champs-mobile.js", "notes-idees.js", "excel-style.js", "firebase-config.js",
  "manifest.json", "icones/icone.svg", "icones/icone-192.png", "icones/icones.svg"
];

// « reload » : GitHub laisse le tel garder un fichier 10 min ; sans ça on rangerait
// l'ancienne version sous l'étiquette de la nouvelle.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FICHIERS.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Bibliothèques à version fixe : la copie suffit
  if (["www.gstatic.com", "cdnjs.cloudflare.com"].includes(url.hostname)) {
    e.respondWith(caches.match(req).then(copie => copie || fetch(req).then(rep => {
      const clone = rep.clone();
      caches.open(CACHE).then(c => c.put(req, clone));
      return rep;
    })));
    return;
  }
  // Fichiers de l'appli : réseau d'abord, copie en secours (req.url : une navigation ne se modifie pas)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.url, { cache: "no-cache" }).then(rep => {
        if (!url.search) { const clone = rep.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }
        return rep;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
});
