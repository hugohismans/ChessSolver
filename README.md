# ChessCam

Photographiez un échiquier réel, l'app reconnaît la position et Stockfish
vous donne le meilleur coup. Tout tourne **dans le navigateur** : aucun
serveur, aucune image ni position envoyée sur Internet.

## État d'avancement

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Saisie manuelle de la position, Stockfish, meilleur coup | ✅ |
| 2 | Caméra, détection du plateau (OpenCV.js), ajustement des coins | ✅ |
| 3 | Reconnaissance des pièces (TF.js) et calibration de son propre jeu | ✅ |
| 4 | PWA hors ligne, cache des modèles, finitions mobiles | ✅ |

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

## Fonctionnalités (phase 3)

- **Reconnaissance des pièces** : après validation des coins, les 64 cases
  sont classées en 13 classes (vide + 6 pièces x 2 couleurs) par le modèle
  du profil actif, dans un Web Worker (TensorFlow.js : WebGL, sinon
  WebAssembly, sinon CPU). Environ une demi-seconde.
- **Orientation automatique** : la case a1 est toujours foncée, les pions ne
  sont jamais sur les rangées 1 et 8, les blancs sont en général en bas. Le
  bouton « Tourner la photo » corrige si besoin.
- **Écran de correction obligatoire** : la position reconnue s'affiche sur
  l'éditeur, les cases incertaines (confiance < 80 %) sont encadrées en
  jaune. Les corrections peuvent être ajoutées aux exemples du profil actif
  (case cochée par défaut). « Voir les cases » montre les vignettes vues
  par le modèle avec la pièce reconnue et la confiance.
- **Plusieurs photos de la même position** : sur l'écran de correction,
  « Ajouter une photo » (jusqu'à 3). Chaque photo est orientée
  automatiquement pour coller aux précédentes, puis les probabilités sont
  fusionnées case par case (moyenne géométrique). Une photo prise d'un
  autre côté du plateau est la plus utile : les erreurs typiques (tête
  d'une pièce haute qui déborde sur la case de derrière) ne tombent pas sur
  les mêmes cases. Les corrections déjà faites sont conservées, une photo
  peut être retirée, et les vignettes de toutes les photos rejoignent le
  profil. Mesuré sur des photos de synthèse (3 positions, 192 cases) : 37
  erreurs avec une photo, 18 avec deux, 7 avec trois ; surtout, les erreurs
  restantes sont presque toutes signalées en jaune, alors qu'avec une seule
  photo la plupart passent inaperçues.
- **Calibrer mon jeu** (bouton en haut de l'écran Position) :
  - profils multiples (« jeu en bois », « jeu de voyage »...), création,
    renommage, suppression, bascule ;
  - étape 1 : 5 à 10 photos de la position de départ, sous divers angles et
    éclairages ; chaque photo donne 64 cases étiquetées automatiquement
    (l'orientation est trouvée en comparant à la position de départ, et les
    cases douteuses sont signalées avant ajout) ;
  - étape 2 (facultative) : photos de positions quelconques, l'app propose
    sa reconnaissance, l'utilisateur corrige, les 64 cases sont ajoutées ;
  - bouton « Entraîner » : dans un Web Worker, avec barre de progression,
    bouton Arrêter et précision mesurée sur des photos mises de côté,
    comparée à celle du modèle de base ;
  - augmentation de données (rotation légère, luminosité, contraste,
    miroir, léger recadrage) ;
  - stockage du modèle et des exemples dans IndexedDB ;
  - export / import du profil dans un fichier `.chesscam` (tête du modèle +
    exemples, compressé).

### Le modèle

Transfer learning en deux parties :

- **extracteur** : MobileNetV2 (alpha 0,35, entrée 96x96) pré-entraîné sur
  ImageNet, affiné sur le jeu de données de base, puis **gelé** dans l'app
  (0,8 Mo, poids en float16) ;
- **tête** : couches denses 1280 -> 128 -> 13, propre à chaque profil. La
  calibration ne ré-entraîne que la tête, à partir de celle du modèle de
  base : les vignettes (et leurs variantes augmentées) passent une seule
  fois dans l'extracteur, puis la tête apprend sur les vecteurs obtenus.
  C'est rapide même sur un téléphone.

Chaque vignette couvre la case et la moitié de la case du dessus (dans le
sens de la photo), car les pièces debout débordent vers le haut sur les
photos prises en biais. Le même code de découpe (`src/lib/vision/tiles.ts`)
sert à l'app et à la préparation des données d'entraînement.

### Modèle de base et entraînement (dossier `training/`)

Le modèle livré dans `public/models/base` est entraîné sur le jeu de
données public Roboflow « Chess Pieces »
(`joseph-nelson/chess-pieces-new`, version 23, 289 photos réelles annotées,
domaine public). Résultats sur les photos de test (jamais vues) : 99,3 % des
cases reconnues, 0,45 erreur par photo en moyenne. Ce jeu ne montre qu'un
seul plateau et un seul jeu de pièces : pour un autre jeu, la calibration
fait la différence.

Pour ré-entraîner :

```bash
# 1. Télécharger le jeu de données (clé API Roboflow gratuite)
export ROBOFLOW_API_KEY=...   # ne jamais l'écrire dans le dépôt
curl -sL -o /tmp/rf.zip "$(curl -s "https://api.roboflow.com/joseph-nelson/chess-pieces-new/23/coco?api_key=$ROBOFLOW_API_KEY" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['export']['link'])")"
mkdir -p /tmp/rf && unzip -q /tmp/rf.zip -d /tmp/rf

# 2. Construire les vignettes étiquetées (détection du plateau et découpe
#    avec le code de l'app, attribution de chaque pièce annotée à sa case)
npx tsx training/build-dataset.ts /tmp/rf training/data

# 3. Entraîner et exporter au format TF.js (CPU : environ 5 minutes)
python3 -m venv training/.venv
training/.venv/bin/pip install -r training/requirements.txt
training/.venv/bin/python training/train.py --data training/data --out public/models/base

# 4. Vérifier que TF.js redonne les mêmes prédictions que Keras
npx tsx training/check-export.ts
```

`train.py` utilise Keras 2 (`tf_keras`) pour que la topologie soit lisible
par TensorFlow.js, et écrit lui-même le format « layers model » (pas besoin
du paquet `tensorflowjs`, incompatible avec numpy 2).

## Fonctionnalités (phase 4)

- **Application installable** (PWA) : manifeste, icônes (dont « maskable »
  pour Android), mode plein écran. Bouton « Installer ChessCam » dans les
  Réglages quand le navigateur le propose ; sur iPhone, les Réglages
  expliquent la marche à suivre (Partager, « Sur l'écran d'accueil »).
- **Hors ligne après le premier chargement** : le service worker (Workbox,
  via `vite-plugin-pwa`) met en cache l'application, Stockfish, OpenCV.js,
  TensorFlow.js (moteur WASM) et le modèle de reconnaissance (MobileNet +
  tête), soit environ 19 Mo téléchargés en arrière-plan. Photo, détection,
  reconnaissance, calibration et analyse fonctionnent sans réseau. Un badge
  « Hors ligne » s'affiche dans l'en-tête.
- **Mises à jour** : chaque fichier en cache porte une révision ; seuls les
  fichiers modifiés sont retéléchargés (OpenCV, 13 Mo, ne l'est pas à chaque
  version). Une invite propose de passer à la nouvelle version.
- **Données protégées** : à la création d'un profil, l'app demande au
  navigateur de ne pas effacer ses données (profils, exemples, cache). Les
  Réglages affichent l'espace utilisé.
- **Finitions mobiles** : écran maintenu allumé pendant la prise de vue et
  l'entraînement, lampe torche si le téléphone en a une, vibration au
  déclenchement et en fin d'entraînement, boutons sans délai ni zoom au
  double appui, mise en page vérifiée jusqu'à 320 px de large (iPhone SE),
  zones sûres des écrans à encoche, moteur de calcul de la reconnaissance
  affiché dans les Réglages (WebGL, WebAssembly ou processeur).

Les icônes se régénèrent avec `node scripts/make-icons.cjs` (depuis
`scripts/icon.svg`, nécessite Playwright).

## Démarrer

Prérequis : Node.js 20 ou plus récent. Le service worker n'est actif que
dans le build (`npm run build` puis `npm run preview`), pas en
développement.

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
  lib/vision/image.ts           canvas : photo, rotation
  lib/vision/tiles.ts           découpe des 64 vignettes (app et entraînement), repères
  lib/recognition/ml.worker.ts  worker TF.js : reconnaissance et entraînement
  lib/recognition/storage.ts    IndexedDB : profils, exemples, export / import
  lib/recognition/orient.ts     orientation automatique du plateau
  lib/recognition/run.ts        enchaînement photo -> position
  lib/state/*.svelte.ts         état partagé (runes) : position, réglages, photo
  lib/components/Board.svelte   échiquier SVG : pièces, flèches, surlignages, toucher
  lib/components/Editor.svelte  écran de saisie / correction
  lib/components/Analysis.svelte écran d'analyse
  lib/components/Camera.svelte  écran photo (caméra, galerie, repérage en direct)
  lib/components/Corners.svelte écran des coins (détection + CornerEditor)
  lib/components/Squares.svelte écran des cases reconnues (débogage)
  lib/components/Calibration.svelte      écran « Calibrer mon jeu »
  lib/components/CalibrationCheck.svelte vérification d'une photo de départ
training/                       préparation des données, entraînement, export TF.js
public/models/base/             modèle de base (extracteur + tête, format TF.js)
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
- TensorFlow.js : Apache 2.0. MobileNetV2 (poids ImageNet de Keras) : Apache 2.0.
- Jeu de données Roboflow « Chess Pieces » : domaine public.
