# Inventaire — journal des nouveautés

## 0.7.1 — 2026-11-26
Corrections après essai sur le téléphone.
- Retour : le bouton retour du téléphone remonte toujours d'un cran (ferme la fiche / les réglages / la recherche, sinon remonte au contenant parent, à l'accueil il quitte). Avant, certaines pages remplacées le faisaient sauter ou bloquer. Flèche ← dans l'en-tête pour remonter aussi.
- Glisser au doigt refait avec les événements tactiles : Chrome ne peut plus l'interrompre en route ; un doigt qui défile n'attrape rien, l'appui long (0,4 s) attrape.
- Ouvrir en survolant : 1 seconde immobile, avec un rond qui se remplit autour du doigt ; bouger annule.
- Vue de face : un gros rond au coin pour changer largeur et hauteur du meuble d'un geste (commode étroite et haute…), une poignée à droite (largeur), une en bas (hauteur) ; barres entre les cases plus épaisses.

## 0.7.0 — 2026-11-25
Plan et sensations.
- Plan de l'accueil (et « Voir l'endroit ») sans noms ; portes dessinées d'un seul trait.
- Plan de l'accueil qui tourne librement à deux doigts, comme une carte ; orientation retenue sur ce téléphone ; boussole pour remettre le nord en haut.
- Mode « Libre » (ex-Angles) : coins déplacés sans grille, aimantés sur un autre coin, à angle droit ou à 45° des murs voisins, ou alignés avec un coin.
- Couleur au choix pour chaque élément (8 pastels) : tuile de l'icône dans les listes et l'escalier, liseré dans la vue de face. Gardée dans l'Excel.
- Vibrations (réglage Oui / Non) : prendre, ouvrir au survol, poser, aimants du plan, enregistrer, cocher, quantité, sortir.
- Animations : l'objet glissé file vers sa place et la ligne rebondit ; fiches qui montent avec un léger ressort ; la liste glisse de droite en entrant, de gauche en remontant ; coche dessinée à l'enregistrement ; éclat de confettis quand « Tout est là » ; quantité qui roule.

## 0.6.0 — 2026-11-25
Navigation et listes.
- Onglets en bas : Maison, Objets, Escalier.
- Objets : tous les objets sans leurs contenants, classés par pièce, A → Z, récents ou par tag ; la recherche filtre la liste.
- Escalier : l'arbre décalé selon la profondeur, chaque contenant se replie / se déplie, niveaux « De … À … » (ex. de Meuble à Case).
- Lieu principal (étoile, menu « ⋯ » d'un lieu) : l'accueil montre son plan et ses pièces, puis « Autres lieux ».
- « Voir l'endroit » : pop-up qui zoome du plan entier vers la pièce, allume le meuble, puis montre la vue de face avec la case et l'objet allumés. Toucher pour sauter ; « Y aller ».
- Glisser : seule une étiquette (icône + nom) suit le doigt ; rester ½ s sur un endroit (fil d'Ariane, contenant, pièce du plan, case) l'ouvre sans lâcher ; lâcher sur la liste range ici ; petites vibrations.
- Plan de l'accueil : se déplace au doigt et se zoome à deux doigts (molette sur PC), y compris avec un 2e doigt pendant un glisser.

## 0.5.0 — 2026-11-25
Rangement des objets.
- Pastilles « À ranger », « Mobile », « Introuvable » (dans la liste, la fiche et le formulaire) et puces-filtres sous la recherche quand il y en a.
- Un objet tapé sans endroit tombe tout seul dans « À ranger » ; le ranger (Déplacer / glisser) retire la pastille.
- Quantité facultative « ×6 », boutons − / + dans la fiche ; à 0 l'objet reste, grisé.
- Achat et garantie : date d'achat, prix, fin de garantie (+1 an / +2 ans), badge « sous garantie », photo de la facture (plus grande, lisible).
- Vérifier le contenu d'un contenant (menu « ⋯ ») : ce qui n'est pas coché devient « Introuvable » ; bouton « Retrouvé » dans la fiche.
- « Sortir de l'inventaire » (Jeté, Donné, Vendu, Perdu, Autre) avec son contenu, Annuler possible ; écran Réglages › Archive pour chercher, restaurer ou supprimer pour de bon.
- Vue de face modelée au doigt (crayon) : tirer les séparateurs entre cases et colonnes, et la barre du bas pour la hauteur du meuble.
- Excel : nouvelles colonnes (quantité, état, mobile, achat, garantie, prix) et onglet « Archive ».

## 0.4.0 — 2026-11-25
Plan plus pratique à dessiner.
- Pièces : on les agrandit en tirant un mur (petite barre au milieu). Les coins ne se tirent qu'avec le bouton « Angles » (qui garde le « + » pour ajouter un coin) ; un mur en biais se tire aussi en entier.
- Pièces aimantées : un mur approché d'un autre s'y pose. Deux pièces qui se touchent se collent : elles bougent ensemble (avec leurs meubles, portes et fenêtres) et un mur commun bouge pour les deux. Boutons « Dissocier » / « Coller ».
- Dimensions précises en cm : largeur × longueur d'une pièce rectangle ou d'un meuble, longueur d'un mur en mode Angles, largeur d'une porte ou fenêtre. Surface en m² de la pièce choisie.
- Portes : faciles à attraper (toute la zone d'ouverture), elles suivent leur mur quand la pièce bouge.
- Nouveau : fenêtres (double trait dans le mur), posées comme les portes.

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
