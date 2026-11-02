# OptiSpace : landing page 3D et maquettes de l'application

OptiSpace, par 3istor : un petit boîtier noir posé sur la table de chaque salle de réunion. Un bandeau LED indique l'état
(vert : libre, orange : réservée en attente, rouge : occupée), des radars détectent la présence réelle, et une réservation
sans personne est libérée automatiquement. Ce dossier (`landing/` du dépôt `3-Istor/optispace`) contient la dernière version de chaque vue : la landing page 3D
(sources et fichier final) et les écrans de l'application exportés de la maquette Design.

## Contenu, et ce qu'il faut lire

| Chemin | Contenu | À lire ? |
|---|---|---|
| `landing/src/` | Sources de la landing : `page.html` (HTML et CSS) et `js/01…06` | Oui, c'est ici qu'on modifie |
| `landing/optispace-landing-3d.html` | Fichier final autonome (environ 400 Ko : CSS Tailwind minifié, JS, images en base64) | Non : il est généré par `npm run build` |
| `../docs/maquettes/*.dc.html` | Les 12 écrans de l'application, dernière version | Oui, comme spécification d'interface |
| `../docs/maquettes/design-system.css` | Le bloc CSS commun à tous les écrans (boutons, cartes, champs, tableaux…) | Oui, pour les styles |

## Règles éditoriales (à respecter partout)

- Tout le texte visible est en français. Ton sobre, premium, sans emoji.
- Jamais de tiret cadratin (U+2014) : le build échoue s'il en trouve un. Utiliser deux-points, virgules ou parenthèses.
- Les espaces insécables (` :`, ` ?`, `« »`, ` %`, ` €`, ` min`) sont ajoutées par le build. Pour « 14 h », écrire `14&nbsp;h`.
- « Facility manager » (f minuscule à manager). L'histoire en 11 étapes ne change pas sans demande explicite.
- Infos produit : disponible le 15 janvier 2027 ; boîtier 150 € HT, installation 40 € HT par salle, abonnement 39 € HT par mois et par salle (jusqu'en 2028) ; libération après 10 min sans présence par défaut (réglable) ; réservations de 30 min à 3 h pour les salles, de 15 min à 1 h pour les bulles ; radars de présence, aucune caméra, aucun enregistrement.

## Design (repris des maquettes de l'application)

- Polices : DM Sans (texte), Sora (titres, chiffres clés). Chiffres en `font-variant-numeric: tabular-nums`.
- Couleurs : encre `#0E1726`, texte secondaire `#5B6676`, bordures `#E4E8EE` / `#DCE1E8`, fond `#F6F7F9`,
  bleu `#1E56D6` (survol `#1A4CC0`, texte bleu `#1747B3`), bleu clair `#EAF0FD`.
- États : libre `#1A8F4E`, en attente `#D9771F`, occupée `#D63F45`, hors ligne `#8A94A3`, à venir `#2F6FE0`.
  Sur la landing, la LED du boîtier : vert `#2FA66B`, orange `#F08A24`, rouge `#E5484D`.
- Rayons 8 à 10 px, ombres douces, aucun dégradé criard.

## Landing 3D : architecture

`page.html` contient la structure et le CSS ; les six fichiers JS sont **concaténés dans un seul `<script type="module">`**
et partagent la même portée (pas d'`import`/`export` entre eux, et attention aux noms en double : `GEO`, `MAT`, `P`, `tl`… existent déjà).
Bibliothèques par CDN : Three.js 0.169 (importmap jsDelivr), GSAP 3.12.5 et ScrollTrigger (cdnjs).

| Fichier | Rôle |
|---|---|
| `01-scene.js` | Rendu Three.js (caméra orthographique en plongée, `VIEW` grand écran et `NVIEW` petit écran), lumières, matériaux, l'étage (open space, couloir, salle Atlas, bureau d'Arthur…), boîtier et LED, fusion du décor fixe |
| `02-personnages.js` | Personnages en pâte blanche (Hugo, Joe, Newfel, Brian, Raphaël, Arthur « Facility manager », le CEO, figurants), poses, étiquettes |
| `03-histoire.js` | La timeline GSAP unique `tl` (en pause), les 11 étapes, la caméra (`camTo`, presets `CAM`), les écrans téléphone et PC, puis `render()` |
| `04-lecture.js` | Lecture au scroll : section `#histoire` épinglée, l'animation rejoint la cible à vitesse plafonnée (`MAX_SPEED`), pas de défilement automatique, boutons étape précédente / suivante et « Passer l'histoire » |
| `05-hero.js` | Hero : trame de points animée (canvas `#heroDots`) |
| `06-demain.js` | Section « Demain » : le bâtiment entier qui s'équipe |

Sections de la page : `#top` (hero), `#histoire` (épinglée), `#demain`, `#produit`, `#tarifs`, `#demo`.

**Étapes et labels de la timeline** (les labels marquent l'état de repos de chaque étape ; `MAIN_STEPS` dans `04-lecture.js` liste ceux où s'arrêtent les boutons) :

| # | Texte | Label |
|---|---|---|
| 1 | Mardi 9:00 · Hugo réserve Atlas (téléphone) | `s1` |
| 2 | Mardi 14:00 · La réunion commence (orange) | `s2` |
| 3 | Mardi 14:02 · L'équipe arrive (radar, rouge) | `s3r`, `s3` |
| 4 | Mardi 14:20 · Ils ont fini plus tôt (accéléré, notification) | `s4t`, `s4` |
| 5 | Mardi 14:40 · Vingt minutes rendues (vert) | `s5` |
| 6 | Mardi soir, puis la nuit | `s6n`, `s6` |
| 7 | Mercredi 9:30 · Rien de libre pour 14 h (Joe cherche sur son PC et active une alerte) | `s6j` |
| 8 | Mercredi 14:00 · Personne n'est venu (visio de Hugo, notification) | `s7` |
| 9 | Mercredi 14:10 · La salle se libère | `s8` |
| 10 | Mercredi 14:11 · Joe est prévenu, réserve, entre (rouge) | `s9b`, `s9` |
| 11 | Mercredi 18:00 · Arthur présente le bilan au CEO (tableau de bord) | `s10` |

Chiffres du bilan (à garder cohérents) : réservé 2 h 49 (mardi 60 min, mercredi 109 min), utilisé 57 min (8 + 49), soit 34 % ;
70 min libérées (20 mardi, 50 mercredi) ; 49 min réutilisées par Joe (14:11 à 15:00).

**Écrans téléphone et PC** (`#devPhone`, `#devPc` dans `page.html`) : maquettes de l'application à **taille logique fixe**
(téléphone 300 × 620, PC de largeur `lw` selon le mode) mises à l'échelle par la variable CSS `--k`. Le texte ne se recompose
donc jamais, quelle que soit la taille de la scène. Ne pas les rendre fluides.
- Aides dans `03-histoire.js` : `phoneShow(at, vue)`, `phoneHide`, `phView`, `pcShow(at, mode, ancre3D, propriétaire, vue, voile)`,
  `pcHide(at, retourDansLEcran)`, `swap` (état A vers B), `push`/`pushOut` (notifications), `toast`, `tapOn` (doigt), `click` et `CUR` (curseur).
- Modes du PC : `search` (plein cadre, zoom depuis l'écran de Joe), `visio` (à gauche, la salle reste visible), `dash` (écran mural à droite).
  Scène de moins de 560 px de large (`.dv-narrow`) : `search` et `dash` passent en plein cadre sans bord, et des éléments `.wide-only` se masquent.
- Sur grand écran, le bas du téléphone sort volontairement du cadre pour garder un texte lisible.

**Ajouter ou retirer une étape** : un `<article class="step">` dans `#copy`, `textTo(i, at)` (index de l'article),
`STEP_START`, le nombre de `<span>` du `.rail` et sa grille CSS, le compteur « / 11 » et `MAIN_STEPS`.

**Pièges connus**
- Tout doit rester réversible quand on remonte le scroll : préférer `tl.set` puis `tl.to` à `fromTo` pour les effets ponctuels.
- Ne pas combiner la propriété CSS `translate` et les `x`/`y` de GSAP sur un même élément (décalages imprévisibles).
- Cadrage : `camTo(at, durée, cadrage, ease, cadragePetitEcran)` anime les deux cadrages ; sur petit écran les écrans prennent plus de place.
- Les mesures de fluidité en navigateur headless (rendu logiciel) sont fausses : vérifier les FPS dans un vrai navigateur.

## Commandes (depuis `landing/`)

```bash
npm install && npx playwright install chromium   # une fois
npm run build                                     # régénère optispace-landing-3d.html
npm run verif                                     # aucun texte coupé dans les écrans (5 tailles, 8 étapes)
npm run capture -- 1440x900 s1,s6j,s10            # captures/1440x900_s1.png… (ajouter "page" pour la page entière)
```

Après toute modification : `npm run build`, puis `npm run verif`, puis regarder les captures concernées (grand écran 1440x900 et mobile 390x844).

## Maquettes de l'application (`../docs/maquettes/`)

Export de la maquette Design « OptiSpace · Site de gestion de salles » (source : https://claude.ai/artifact/M2SS63pdGktp8NoqZn7rbF,
accessible seulement connecté à claude.ai ; export du 2 novembre 2026). Seule la dernière version de chaque écran est incluse ;
les anciennes itérations de landing sont remplacées par `landing/`.

Format `.dc.html` : du HTML avec un gabarit `<x-dc>` (trous `{{…}}`, boucles `<sc-for>`, conditions `<sc-if>`) et une classe
`Component extends DCLogic` pour l'état. Le fichier `support.js` qu'ils appellent n'est pas fourni : **les lire comme une
spécification** (structure, textes, états, styles en ligne), pas les exécuter. Les liens entre écrans pointent vers les autres
`.dc.html` (le lien du logo de `Main.dc.html` vise une ancienne landing absente).

| Fichier | Écran |
|---|---|
| `Main.dc.html` | Connexion (via Keycloak) |
| `EmployeRecherche.dc.html` | Employé · Réserver un espace (critères, résultats, aucun résultat, « M'avertir si un espace se libère ») |
| `EmployeProfil.dc.html` | Employé · Mes réservations |
| `Notifications.dc.html` | Centre de notifications (employé et Facility manager), notifications du navigateur |
| `AdminDashboard.dc.html` | Facility manager · Tableau de bord (indicateurs, graphiques, synthèse) |
| `AdminSalles.dc.html` | Facility manager · Salles et bulles |
| `AdminBoitier.dc.html` | Facility manager · Boîtiers (descellement et maintenance) |
| `AdminReglages.dc.html` | Facility manager · Paramètres |
| `AdminProfil.dc.html` | Facility manager · Profil |
| `Support.dc.html` | Équipe 3istor · Console support (tickets, procédures, FAQ) |
| `Erreurs.dc.html` | Messages d'erreur |
| `Chargement.dc.html` | États de chargement |

`canvas.json` donne le titre et la taille de chaque écran ; `img/` contient les logos 3istor.

## Hébergement

L'application est derrière le SSO de la plateforme ; la landing doit rester publique. Son hébergement est à décider (ticket IOT-69).
