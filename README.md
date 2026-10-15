# ChessCam

Photographiez un échiquier réel, l'app reconnaît la position et Stockfish
vous donne le meilleur coup. Tout tourne **dans le navigateur** : aucun
serveur, aucune image ni position envoyée sur Internet.

## État d'avancement

| Phase | Contenu | État |
| --- | --- | --- |
| 1 | Saisie manuelle de la position, Stockfish, meilleur coup | ✅ |
| 2 | Caméra, détection du plateau (OpenCV.js), ajustement des coins | à venir |
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

`npm run dev` et `npm run build` copient d'abord le moteur Stockfish depuis
`node_modules/stockfish` vers `public/engine/` (script
`scripts/copy-engine.mjs`).

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
  lib/state/*.svelte.ts         état partagé (runes) : position, réglages
  lib/components/Board.svelte   échiquier SVG : pièces, flèches, surlignages, toucher
  lib/components/Editor.svelte  écran de saisie / correction
  lib/components/Analysis.svelte écran d'analyse
tests/                          tests Vitest
scripts/copy-engine.mjs         copie du moteur WASM dans public/engine
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
