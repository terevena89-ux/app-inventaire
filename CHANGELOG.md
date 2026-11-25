# Inventaire — journal des nouveautés

## 0.3.0 — 2026-11-25
La vue de face des meubles.
- Dans un meuble (ou une de ses cases), sa façade remplace le plan : étagères, tiroirs, penderie, portes, dessus / dessous, avec les boîtes et objets dessinés dedans (photo + nom). Toucher une case ou une boîte l'ouvre ; la case ouverte est colorée.
- 7 modèles de départ (étagères, tiroirs, commode 2 colonnes, penderie + étagères, placard 2 portes, lit, bureau), puis ajustement au crayon : ajouter une case ou une colonne, renommer, changer le genre, la hauteur, la largeur, supprimer (avec Annuler).
- Les cases sont de vrais éléments (nouveau type « Case ») : on y range, on les retrouve dans la recherche ; la liste suit l'ordre de la façade.
- Glisser un objet de la liste sur une case ou une boîte de la façade pour l'y ranger.
- Excel : la façade est gardée dans l'onglet « Plans ».

## 0.2.0 — 2026-11-25
Le plan vu de dessus.
- Un plan par lieu, affiché au-dessus de la liste (repliable) ; dans une pièce reliée, il se recentre sur elle et la colore.
- Mode « Modifier le plan » (crayon) en plein écran : pièces de toutes formes (coins à tirer, « + » au milieu d'un mur pour ajouter un coin, murs en biais), portes qui se collent aux murs (sens, largeur), 26 meubles au trait (chambre, salon, cuisine, salle de bain, rangement, forme libre) à déplacer, étirer, tourner.
- Zoom à deux doigts (molette sur PC), Annuler, Tout voir. Enregistrement automatique.
- Chaque dessin peut être nommé et relié (« Relier à… ») à un élément de la liste : le toucher sur le plan l'ouvre.
- Glisser un objet de la liste sur une pièce ou un meuble relié du plan pour l'y ranger.
- Excel : onglet « Plans » en plus, réimporté avec le reste.

## 0.1.0 — 2026-11-25
Première version : la base.
- Lieux, pièces, meubles, boîtes, objets, rangés librement les uns dans les autres.
- Liste avec fil d'Ariane (Tout › Appart › Chambre…) ; toucher un contenant l'ouvre.
- Recherche dans les noms, tags, notes et emplacements ; `#tag` pour un seul tag.
- Fiche : photo, emplacement cliquable, note, tags, contenu, anciens endroits ; Modifier / Supprimer dans « ⋯ ».
- Ajout à la chaîne (bouton « Autre »), type proposé selon l'endroit.
- Déplacer : bouton (récents + arbre + recherche) ou appui long puis glisser sur un contenant ou le fil d'Ariane. Annuler possible.
- Synchro téléphone / PC (Firebase), hors ligne, thème, animations, Notes, export / import Excel avec photos.
