# ChessCam

Photographiez un échiquier réel, l'app reconnaît la position et Stockfish
vous donne le meilleur coup. Tout tourne **dans le navigateur** : aucun
serveur, aucune image ni position envoyée sur Internet.

## État d'avancement

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Saisie manuelle de la position, Stockfish, meilleur coup | ✅ |
| 2 | Caméra, détection du plateau (OpenCV.js), ajustement des coins | ✅ |
| 3 | Reconnaissance des pièces (TF.js) et calibration de son propre jeu | à venir |
| 4 | PWA hors ligne, cache des modèles, finitions mobiles | à venir |

## Fonctionnalités (phase 1)

- **Éditeur de position** : touchez une case pour choisir sa pièce dans un
  menu, ou sélectionnez une pièce dans la palette pour la poser d'un toucher
  sur plusieurs cases. Gomme, position de départ, plateau vide, retournement.
- **Réglages de la position** : trait, droits de roque (grisés quand ils sont
  impossibles), prise en passant (proposée seulement si elle est envisageable).
- **Validation** : la position est vérifiée en continu (un roi de chaque
  couleur, pions hors des rangées 1 et 8, camp sans le trait pas en échec,
  puis validation chess.js). Les erreurs sont expliquées en clair.
- **Import / export FEN**.
- **Analyse Stockfish 19** (WebAssembly) dans un Web Worker : profondeur
  réglable (18 par défaut), 3 meilleures lignes (MultiPV 3), flèches sur
  l'échiquier, barre d'évaluation, score en centipions ou « mat en N »,
  bouton Stop.
- **Suivi de partie** : jouez le coup conseillé ou n'importe quel coup en
  touchant les pièces (promotion au choix), annulez, l'analyse se relance
  automatiquement.
- Notation française (C, F, T, D, R) ou anglaise, coordonnées, orientation
  et position mémorisées localement.
- Le bouton « retour » du téléphone ramène de l'analyse à l'éditeur.

## Fonctionnalités (phase 2)

- **Photo** : caméra arrière (`getUserMedia`) avec repérage du plateau en
  direct (contour vert quand l'échiquier est trouvé), ou import depuis la
  galerie (orientation EXIF respectée). Photos réduites à 1600 px.
- **Détection automatique du plateau** (OpenCV.js, dans un Web Worker) :
  coins de la zone de jeu 8x8, sans le cadre, même en perspective, plateau
  tourné, rangées masquées par les pièces. Voir « Détection » plus bas.
- **Ajustement manuel des coins** : toujours proposé, pré-rempli par la
  détection. On fait glisser la poignée la plus proche du doigt
  (déplacement relatif, le doigt ne cache pas le coin), avec une loupe et
  la grille 8x8 projetée pour vérifier l'alignement. Clavier : N change de
  coin, flèches pour déplacer.
- **Redressement et découpe** : plateau aplati (homographie), bouton
  « Tourner » pour mettre les blancs en bas, et affichage de débogage des
  64 vignettes de 96x96 px (option « débord vers le haut » pour inclure le
  haut des pièces, utile à la reconnaissance en phase 3).

## Détection du plateau

Code : `src/lib/vision/detect.ts`, sans dépendance au navigateur (OpenCV
est injecté), donc testable sous Node.

1. **Coins en X** : on cherche dans toute l'image les points où 4 cases se
   touchent en diagonale, avec un filtre « selle » à 4 orientations. Le
   cadre, la table et les jonctions en T du bord n'y répondent pas.
2. **Réseau** : à partir d'une case (4 coins aux signes alternés, sans autre
   coin à l'intérieur), on fait croître un réseau régulier (homographie aux
   moindres carrés) en ajoutant les coins attendus. Secours : quadrilatères
   des contours recalés par un « peigne » de lignes équidistantes.
3. **Placement** : quand une rangée est couverte de pièces, plusieurs
   positions du plateau 8x8 expliquent les coins visibles. On garde celle
   dont le pourtour montre des jonctions en T (cases contre cadre ou table)
   et aucun coin en X.
4. **Affinage** : relocalisation des 49 coins intérieurs puis homographie
   aux moindres carrés avec rejet des points aberrants, jusqu'à stabilité.
5. **Confiance** : nombre de coins retrouvés, damier, cohérence des signes,
   régularité géométrique. En dessous du seuil, l'app demande de placer les
   coins à la main.

Évaluation sur 52 photos de synthèse (perspective, rotation jusqu'à 45°,
avec ou sans cadre, éclairage inégal, flou, pièces debout) : toutes
détectées, 48 avec une erreur maximale sur un coin inférieure à un quart de
case, la pire à 0,31 case. Environ 90 ms par photo sous Node sur un PC.

```bash
# Générer des photos de synthèse (nécessite Playwright et Chromium)
node tests/fixtures/generate.cjs 40 /tmp/photos 100 0.8
# Mesurer la précision de la détection sur un dossier
npx tsx scripts/eval-detection.ts /tmp/photos
```

Huit de ces photos, parmi les plus difficiles, sont dans `tests/fixtures`
et servent de tests automatiques (`npm test`).

## Démarrer

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run dev        # serveur de développement sur http://localhost:5173
npm test           # tests unitaires (Vitest)
npm run check      # vérification TypeScript / Svelte
npm run build      # build statique dans dist/
npm run preview    # sert le build localement
```

`npm run dev` et `npm run build` copient d'abord les fichiers lourds depuis
`node_modules` vers `public/` (script `scripts/copy-vendor.mjs`) :
Stockfish vers `public/engine/` et OpenCV.js vers `public/opencv/`.
OpenCV.js (environ 13 Mo, WebAssembly inclus) n'est téléchargé qu'à la
première ouverture de la caméra, avec une barre de progression.

## Déploiement

Le build est 100 % statique (`dist/`) et utilise des chemins relatifs : il
fonctionne à la racine d'un domaine comme dans un sous-dossier.

- **GitHub Pages** : le workflow `.github/workflows/deploy.yml` construit et
  publie le site à chaque push sur `main`. À activer une seule fois dans
  *Settings > Pages > Source : GitHub Actions*. L'app sera servie sur
  `https://<utilisateur>.github.io/ChessSolver/`.
- **Cloudflare Pages** : commande de build `npm run build`, dossier de sortie
  `dist`.

Le moteur utilisé est la version « lite single-thread » de Stockfish : elle
ne nécessite pas `SharedArrayBuffer`, donc aucun en-tête HTTP particulier
(COOP / COEP) que GitHub Pages ne permet pas de définir. Poids : environ
1,8 Mo.

## Architecture

```
src/
  App.svelte                    navigation entre les écrans
  lib/chess/position.ts         grille 8x8 <-> FEN, roques, en passant, validation
  lib/chess/lines.ts            variantes UCI -> SAN numérotée
  lib/chess/names.ts            noms des pièces, notation française
  lib/engine/stockfish.ts       pilotage UCI du worker Stockfish (une recherche à la fois)
  lib/engine/uci.ts             lecture des lignes « info » / « bestmove », scores
  lib/vision/detect.ts          détection du plateau (OpenCV), redressement
  lib/vision/geometry.ts        homographies, quadrilatères
  lib/vision/vision.worker.ts   worker : chargement d'OpenCV, détection, redressement
  lib/vision/client.ts          appels au worker depuis l'interface
  lib/vision/image.ts           canvas : photo, rotation, découpe des 64 cases
  lib/state/*.svelte.ts         état partagé (runes) : position, réglages, photo
  lib/components/Board.svelte   échiquier SVG : pièces, flèches, surlignages, toucher
  lib/components/Editor.svelte  écran de saisie / correction
  lib/components/Analysis.svelte écran d'analyse
  lib/components/Camera.svelte  écran photo (caméra, galerie, repérage en direct)
  lib/components/Corners.svelte écran des coins (détection + CornerEditor)
  lib/components/Squares.svelte écran des cases (redressement, rotation, 64 vignettes)
tests/                          tests Vitest (+ photos de synthèse dans fixtures/)
scripts/copy-vendor.mjs         copie de Stockfish et d'OpenCV.js dans public/
scripts/eval-detection.ts       mesure de précision de la détection
```

La grille (64 cases dans l'ordre du FEN, `a8` à `h1`) est le format commun
entre l'éditeur et, plus tard, la reconnaissance par photo : l'écran de
correction de la phase 3 réutilisera directement l'éditeur.

L'échiquier est un composant Svelte SVG maison plutôt que cm-chessboard :
il gère nativement le toucher, les flèches MultiPV et les surlignages, sans
dépendance. Il réutilise le sprite de pièces de cm-chessboard.

## Licences

- Stockfish.js : GPL v3 (Nathan Rugg et l'équipe Stockfish).
- Pièces : Cburnett (Wikimedia Commons), CC BY-SA 3.0, adaptées par
  cm-chessboard (MIT).
- chess.js : BSD 2-Clause.
- OpenCV.js : Apache 2.0.
