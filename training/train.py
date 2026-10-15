"""Entraîne le modèle de reconnaissance de base de ChessCam et l'exporte en TF.js.

Architecture (transfer learning) :
  - extracteur : MobileNetV2 (alpha 0,35, entrée 96x96) pré-entraîné sur
    ImageNet, sortie = vecteur de 1280 caractéristiques (moyenne globale) ;
  - tête : petit réseau dense à 13 sorties (case vide + 12 pièces).

Dans l'app, l'extracteur reste gelé : la calibration sur le jeu de
l'utilisateur ne ré-entraîne que la tête, ce qui est rapide sur un téléphone.
Ici, pour le modèle de base, on entraîne d'abord la tête seule, puis on
affine les derniers blocs de MobileNetV2 avec un pas d'apprentissage faible.

Entrée : les fichiers .npy produits par training/build-dataset.ts.
Sortie : public/models/base/{extractor,head}/model.json (+ poids) et
public/models/base/meta.json.

Usage :
  TF_USE_LEGACY_KERAS=1 python training/train.py --data training/data --out public/models/base
"""

import argparse
import json
import os
import time

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")  # Keras 2 : topologie lisible par TF.js
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np  # noqa: E402
import tensorflow as tf  # noqa: E402
import tf_keras as keras  # noqa: E402

# Ordre figé, identique à src/lib/recognition/classes.ts
CLASSES = ["empty", "P", "N", "B", "R", "Q", "K", "p", "n", "b", "r", "q", "k"]
TILE = 96
FEATURES = 1280


def load(data_dir, split):
    """Charge les vignettes (uint8) et les classes d'une partie du jeu."""
    x = np.load(os.path.join(data_dir, f"{split}_x.npy"))
    y = np.load(os.path.join(data_dir, f"{split}_y.npy")).astype("int32")
    return x, y


def preprocess(x):
    """Même normalisation que dans l'app : [0, 255] -> [-1, 1]."""
    return tf.cast(x, tf.float32) / 127.5 - 1.0


def augment(x):
    """Augmentation à la volée : luminosité, contraste, miroir, petite rotation, décalage."""
    x = tf.image.random_flip_left_right(x)
    x = tf.image.random_brightness(x, 0.2)
    x = tf.image.random_contrast(x, 0.75, 1.25)
    x = tf.image.random_saturation(x, 0.7, 1.3)
    return tf.clip_by_value(x, -1.0, 1.0)


def make_dataset(x, y, batch, training, empty_keep=0.25, seed=0):
    """tf.data : en entraînement, on ne garde qu'une partie des cases vides
    (très majoritaires) à chaque époque, et on augmente les images."""
    ds = tf.data.Dataset.from_tensor_slices((x, y))
    if training:
        # repeat() : le filtre rend la taille inconnue, on fixe steps_per_epoch
        ds = ds.shuffle(len(y), seed=seed, reshuffle_each_iteration=True).repeat()
        ds = ds.filter(lambda _x, _y: tf.logical_or(_y != 0, tf.random.uniform([]) < empty_keep))
    ds = ds.map(lambda a, b: (preprocess(a), b), num_parallel_calls=tf.data.AUTOTUNE)
    if training:
        rot = keras.layers.RandomRotation(0.03, fill_mode="reflect")
        zoom = keras.layers.RandomZoom(0.08, fill_mode="reflect")
        ds = ds.map(lambda a, b: (augment(zoom(rot(a, training=True), training=True)), b), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(batch).prefetch(tf.data.AUTOTUNE)


def build_models():
    """Extracteur MobileNetV2 + tête, assemblés en un modèle complet."""
    extractor = keras.applications.MobileNetV2(
        input_shape=(TILE, TILE, 3), alpha=0.35, include_top=False, weights="imagenet", pooling="avg"
    )
    extractor._name = "extractor"
    head = keras.Sequential(
        [
            keras.layers.InputLayer(input_shape=(FEATURES,), name="features"),
            keras.layers.Dropout(0.2, name="head_dropout1"),
            keras.layers.Dense(128, activation="relu", name="head_dense"),
            keras.layers.Dropout(0.3, name="head_dropout2"),
            keras.layers.Dense(len(CLASSES), activation="softmax", name="head_out"),
        ],
        name="head",
    )
    inp = keras.Input((TILE, TILE, 3), name="tile")
    # training=False : les BatchNorm de MobileNetV2 restent en mode inférence,
    # même pendant l'affinage (indispensable avec de petits lots)
    out = head(extractor(inp, training=False))
    return extractor, head, keras.Model(inp, out, name="chesscam")


def class_weights(y):
    """Poids inverses de la racine des fréquences (classes rares renforcées)."""
    counts = np.bincount(y, minlength=len(CLASSES)).astype("float64")
    counts[0] *= 0.25  # cases vides sous-échantillonnées à l'entraînement
    w = 1.0 / np.sqrt(np.maximum(counts, 1))
    w = w / w.mean()
    return {i: float(v) for i, v in enumerate(w)}


def evaluate(model, x, y, name):
    """Précision par case, par classe, et part des photos reconnues sans erreur."""
    pred = model.predict(preprocess(x), batch_size=256, verbose=0).argmax(1)
    acc = float((pred == y).mean())
    per_class = {}
    for i, c in enumerate(CLASSES):
        m = y == i
        if m.any():
            per_class[c] = round(float((pred[m] == i).mean()), 3)
    boards = pred.reshape(-1, 64) == y.reshape(-1, 64)
    perfect = float(boards.all(1).mean())
    errors = float((~boards).sum(1).mean())
    print(f"[{name}] précision par case {acc:.4f} | photos sans erreur {perfect:.2%} | erreurs moyennes par photo {errors:.2f}")
    print(f"[{name}] par classe : {per_class}")
    return {"accuracy": round(acc, 4), "perfect_boards": round(perfect, 4), "errors_per_board": round(errors, 2), "per_class": per_class}


def export_tfjs(model, out_dir, float16=True):
    """Exporte un modèle Keras 2 au format TF.js « layers model » :
    model.json (topologie + manifeste des poids) et un fichier binaire.
    Les poids sont stockés en float16 (taille divisée par 2), TF.js les
    reconvertit en float32 au chargement."""
    os.makedirs(out_dir, exist_ok=True)
    topology = json.loads(model.to_json())
    entries = []
    blob = bytearray()
    for w in model.weights:
        arr = w.numpy().astype("float32")
        entry = {"name": w.name.split(":")[0], "shape": list(arr.shape), "dtype": "float32"}
        if float16:
            entry["quantization"] = {"dtype": "float16", "original_dtype": "float32"}
            blob += arr.astype("<f2").tobytes()
        else:
            blob += arr.astype("<f4").tobytes()
        entries.append(entry)
    with open(os.path.join(out_dir, "weights.bin"), "wb") as f:
        f.write(blob)
    manifest = {
        "format": "layers-model",
        "generatedBy": f"keras v{keras.__version__}",
        "convertedBy": "ChessCam training/train.py",
        "modelTopology": topology,
        "weightsManifest": [{"paths": ["weights.bin"], "weights": entries}],
    }
    with open(os.path.join(out_dir, "model.json"), "w") as f:
        json.dump(manifest, f)
    print(f"Exporté : {out_dir} ({len(blob) / 1e6:.2f} Mo de poids)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="training/data")
    ap.add_argument("--out", default="public/models/base")
    ap.add_argument("--head-epochs", type=int, default=10)
    ap.add_argument("--finetune-epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    keras.utils.set_random_seed(args.seed)
    x_tr, y_tr = load(args.data, "train")
    x_va, y_va = load(args.data, "valid")
    has_test = os.path.exists(os.path.join(args.data, "test_x.npy"))
    print(f"Entraînement : {len(y_tr)} vignettes, validation : {len(y_va)}")

    extractor, head, model = build_models()
    train_ds = make_dataset(x_tr, y_tr, args.batch, True, seed=args.seed)
    val_ds = make_dataset(x_va, y_va, 256, False)
    cw = class_weights(y_tr)
    # Nombre de vignettes vues par époque (cases vides sous-échantillonnées)
    steps = int(np.ceil(((y_tr != 0).sum() + 0.25 * (y_tr == 0).sum()) / args.batch))
    t0 = time.time()

    # 1. Tête seule, extracteur gelé
    extractor.trainable = False
    model.compile(keras.optimizers.Adam(1e-3), "sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit(train_ds, validation_data=val_ds, epochs=args.head_epochs, steps_per_epoch=steps, class_weight=cw, verbose=2)

    # 2. Affinage des derniers blocs de MobileNetV2 (à partir du bloc 10)
    extractor.trainable = True
    start = [i for i, l in enumerate(extractor.layers) if l.name.startswith("block_10")][0]
    for layer in extractor.layers[:start]:
        layer.trainable = False
    for layer in extractor.layers:
        if isinstance(layer, keras.layers.BatchNormalization):
            layer.trainable = False
    model.compile(keras.optimizers.Adam(1e-4), "sparse_categorical_crossentropy", metrics=["accuracy"])
    best = keras.callbacks.ModelCheckpoint("/tmp/chesscam_best.weights.h5", monitor="val_accuracy", save_best_only=True, save_weights_only=True)
    model.fit(train_ds, validation_data=val_ds, epochs=args.finetune_epochs, steps_per_epoch=steps, class_weight=cw, callbacks=[best], verbose=2)
    model.load_weights("/tmp/chesscam_best.weights.h5")
    print(f"Entraînement terminé en {time.time() - t0:.0f} s")

    metrics = {"valid": evaluate(model, x_va, y_va, "validation")}
    if has_test:
        x_te, y_te = load(args.data, "test")
        metrics["test"] = evaluate(model, x_te, y_te, "test")

    # Export : extracteur et tête séparés (l'app ré-entraîne seulement la tête)
    extractor.trainable = False
    export_tfjs(extractor, os.path.join(args.out, "extractor"))
    export_tfjs(head, os.path.join(args.out, "head"), float16=False)
    meta = {
        "name": "Modèle de base",
        "classes": CLASSES,
        "tile": TILE,
        "features": FEATURES,
        "preprocess": "x / 127.5 - 1",
        "dataset": "Roboflow Chess Pieces (joseph-nelson/chess-pieces-new, v23, domaine public)",
        "metrics": metrics,
        "created": time.strftime("%Y-%m-%d"),
    }
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    # Quelques prédictions de référence pour vérifier l'export côté TF.js
    sample = x_va[:16]
    ref = {"probs": model.predict(preprocess(sample), verbose=0).round(5).tolist()}
    np.save(os.path.join(args.data, "check_x.npy"), sample)
    with open(os.path.join(args.data, "check_probs.json"), "w") as f:
        json.dump(ref, f)


if __name__ == "__main__":
    main()
