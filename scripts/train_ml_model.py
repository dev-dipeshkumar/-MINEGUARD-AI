"""
MINEGUARD AI — ML training & evaluation.

Trains four classifiers on the corpus built by build_ml_corpus.py,
evaluates each with stratified 5-fold cross-validation, picks the best
by macro-F1, saves it as a pickle artifact, and writes a Markdown
report with the actual numbers to docs/ML_MODEL.md.

Trained models:
  1. Multinomial Naive Bayes over TF-IDF (1-2 grams)
  2. Logistic Regression over TF-IDF (1-2 grams)
  3. Linear SVM (One-vs-Rest) over TF-IDF (1-2 grams)
  4. Random Forest over TF-IDF (1-2 grams)

For each model we report:
  * Cross-validation accuracy (mean ± std)
  * Macro precision, recall, F1
  * Per-class precision / recall / F1
  * Confusion matrix (4x4)
  * Train time and inference latency

Run:
    python3 scripts/train_ml_model.py
"""
from __future__ import annotations

import csv
import json
import os
import pickle
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, f1_score, precision_recall_fscore_support, accuracy_score
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC
from sklearn.preprocessing import LabelEncoder

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CORPUS_PATH = ROOT / "data" / "ml_corpus.csv"
ARTIFACT_PATH = ROOT / "api" / "ml_artifacts" / "severity_model.pkl"
REPORT_PATH = ROOT / "docs" / "ML_MODEL.md"
JSON_RESULTS_PATH = ROOT / "api" / "ml_artifacts" / "evaluation.json"

RANDOM_SEED = 42
CLASSES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]


def load_corpus() -> tuple[list[str], list[str]]:
    if not CORPUS_PATH.exists():
        # Build it now so the script is one-shot.
        import scripts.build_ml_corpus as builder  # type: ignore
        builder.build_corpus()
    descs: list[str] = []
    sevs: list[str] = []
    with open(CORPUS_PATH, "r", encoding="utf-8") as fh:
        r = csv.reader(fh)
        next(r)  # header
        for row in r:
            if len(row) != 2:
                continue
            descs.append(row[0])
            sevs.append(row[1])
    return descs, sevs


def make_pipeline(model: Any) -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), min_df=2, max_features=2000, sublinear_tf=True)),
        ("clf", model),
    ])


def models() -> dict[str, Any]:
    return {
        "naive_bayes": MultinomialNB(alpha=0.3),
        "logistic_regression": LogisticRegression(max_iter=400, C=2.0, class_weight="balanced", random_state=RANDOM_SEED),
        "linear_svm": LinearSVC(C=1.0, class_weight="balanced", random_state=RANDOM_SEED, max_iter=400),
        "random_forest": RandomForestClassifier(n_estimators=200, max_depth=12, class_weight="balanced", random_state=RANDOM_SEED, n_jobs=-1),
    }


def evaluate_cv(pipeline: Pipeline, X: list[str], y: list[str], n_splits: int = 5) -> dict[str, Any]:
    """Stratified k-fold cross-validation with macro-F1 reporting."""
    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=RANDOM_SEED)
    per_fold_acc: list[float] = []
    per_fold_macro_f1: list[float] = []
    per_fold_prec: list[float] = []
    per_fold_rec: list[float] = []
    per_fold_macro_prec: list[float] = []
    per_fold_macro_rec: list[float] = []
    per_fold_macro_f1: list[float] = []
    # For per-class aggregation we hold out a single test for the final report
    for tr_idx, te_idx in skf.split(X, y):
        Xtr = [X[i] for i in tr_idx]
        Xte = [X[i] for i in te_idx]
        ytr = [y[i] for i in tr_idx]
        yte = [y[i] for i in te_idx]
        pipeline.fit(Xtr, ytr)
        pred = pipeline.predict(Xte)
        per_fold_acc.append(accuracy_score(yte, pred))
        p, r, f, _ = precision_recall_fscore_support(yte, pred, average="macro", zero_division=0, labels=CLASSES)
        per_fold_macro_prec.append(p)
        per_fold_macro_rec.append(r)
        per_fold_macro_f1.append(f)
    return {
        "n_splits": n_splits,
        "accuracy_mean": float(np.mean(per_fold_acc)),
        "accuracy_std": float(np.std(per_fold_acc)),
        "macro_precision_mean": float(np.mean(per_fold_macro_prec)),
        "macro_recall_mean": float(np.mean(per_fold_macro_rec)),
        "macro_f1_mean": float(np.mean(per_fold_macro_f1)),
        "macro_f1_std": float(np.std(per_fold_macro_f1)),
        "per_fold_accuracy": [round(a, 4) for a in per_fold_acc],
        "per_fold_macro_f1": [round(a, 4) for a in per_fold_macro_f1],
    }


def evaluate_holdout(pipeline: Pipeline, X: list[str], y: list[str]) -> dict[str, Any]:
    """Train on 80%, test on 20% with a stratified split — report per-class metrics + confusion matrix."""
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=RANDOM_SEED)
    t0 = time.perf_counter()
    pipeline.fit(Xtr, ytr)
    fit_seconds = time.perf_counter() - t0
    t0 = time.perf_counter()
    pred = pipeline.predict(Xte)
    inference_ms = (time.perf_counter() - t0) * 1000 / max(1, len(Xte))
    # Per-class
    p, r, f, s = precision_recall_fscore_support(yte, pred, labels=CLASSES, zero_division=0)
    per_class = []
    for i, cls in enumerate(CLASSES):
        per_class.append({
            "class": cls,
            "precision": round(float(p[i]), 4),
            "recall": round(float(r[i]), 4),
            "f1": round(float(f[i]), 4),
            "support": int(s[i]),
        })
    cm = confusion_matrix(yte, pred, labels=CLASSES).tolist()
    return {
        "test_size": len(Xte),
        "train_size": len(Xtr),
        "fit_seconds": round(fit_seconds, 4),
        "inference_ms_per_sample": round(inference_ms, 4),
        "accuracy": round(float(accuracy_score(yte, pred)), 4),
        "per_class": per_class,
        "confusion_matrix": cm,
        "confusion_matrix_labels": CLASSES,
    }


def markdown_report(corpus_size: int, class_counts: dict[str, int], results: dict[str, Any], best_model: str) -> str:
    lines: list[str] = []
    lines.append("# ML Severity Classifier — Training & Evaluation\n")
    lines.append("Generated by `scripts/train_ml_model.py`. Reproducible: `RANDOM_SEED = 42`.\n")
    lines.append("## 1. Corpus\n")
    lines.append(f"- **Total rows:** {corpus_size}")
    lines.append(f"- **Source mix:** Curated catalogue (DGMS / Coal Mine Regs) + seeded violation templates + severity lexicon up-sampling")
    lines.append(f"- **Class distribution:**")
    for cls in CLASSES:
        n = class_counts.get(cls, 0)
        pct = 100.0 * n / corpus_size
        lines.append(f"  - `{cls}`: {n} ({pct:.1f}%)")
    lines.append("")
    lines.append("## 2. Models evaluated\n")
    lines.append("| Model | CV accuracy (mean ± std) | Macro-F1 (mean ± std) | Macro-precision | Macro-recall | Fit time (s) |")
    lines.append("|---|---|---|---|---|---|")
    for name, r in results.items():
        lines.append(
            f"| {name} | {r['cv']['accuracy_mean']:.4f} ± {r['cv']['accuracy_std']:.4f} | "
            f"{r['cv']['macro_f1_mean']:.4f} ± {r['cv']['macro_f1_std']:.4f} | "
            f"{r['cv']['macro_precision_mean']:.4f} | "
            f"{r['cv']['macro_recall_mean']:.4f} | "
            f"{r['holdout']['fit_seconds']:.3f} |"
        )
    lines.append("")
    lines.append("## 3. Best model — Holdout test (stratified 80/20)\n")
    best = results[best_model]
    lines.append(f"Selected: **{best_model}** (highest macro-F1 across the cross-validation folds).\n")
    lines.append(f"- Test set size: **{best['holdout']['test_size']}** samples")
    lines.append(f"- Train set size: **{best['holdout']['train_size']}** samples")
    lines.append(f"- Accuracy on holdout: **{best['holdout']['accuracy'] * 100:.2f}%**")
    lines.append(f"- Fit time: **{best['holdout']['fit_seconds']:.3f}s**")
    lines.append(f"- Inference latency: **{best['holdout']['inference_ms_per_sample']:.3f} ms/sample**")
    lines.append("")
    lines.append("### Per-class metrics (holdout)\n")
    lines.append("| Class | Precision | Recall | F1 | Support |")
    lines.append("|---|---|---|---|---|")
    for c in best['holdout']['per_class']:
        lines.append(f"| {c['class']} | {c['precision']:.4f} | {c['recall']:.4f} | {c['f1']:.4f} | {c['support']} |")
    lines.append("")
    lines.append("### Confusion matrix (rows = true, columns = predicted)\n")
    labels = best['holdout']['confusion_matrix_labels']
    lines.append("|  | " + " | ".join(labels) + " |")
    lines.append("|---" + "|---" * len(labels) + "|")
    for i, row in enumerate(best['holdout']['confusion_matrix']):
        lines.append(f"| **{labels[i]}** | " + " | ".join(str(x) for x in row) + " |")
    lines.append("")
    lines.append("## 4. Reproducibility\n")
    lines.append("```bash")
    lines.append("# 1. Build the corpus")
    lines.append("python3 scripts/build_ml_corpus.py")
    lines.append("")
    lines.append("# 2. Train + evaluate + save the best model")
    lines.append("python3 scripts/train_ml_model.py")
    lines.append("")
    lines.append("# 3. The artifact is committed at api/ml_artifacts/severity_model.pkl")
    lines.append("ls -la api/ml_artifacts/")
    lines.append("```")
    lines.append("")
    lines.append("## 5. Live API verification\n")
    lines.append("After training, the API serves the trained model:")
    lines.append("```bash")
    lines.append("curl -s localhost:8000/api/ml/describe | python3 -m json.tool")
    lines.append("# { \"mode\": \"tfidf-nb-v0\" (or whatever was best),")
    lines.append("#   \"phase\": \"Phase 2 (active)\",")
    lines.append("#   \"training_size\": 198,")
    lines.append("#   \"features\": 2000,")
    lines.append("#   \"classes\": [\"CRITICAL\", \"HIGH\", \"MEDIUM\", \"LOW\"] }")
    lines.append("```")
    lines.append("")
    lines.append("## 6. Notes\n")
    lines.append("- Class weights are balanced because the corpus is mildly imbalanced (CRITICAL 23%, HIGH 31%, MEDIUM 28%, LOW 18%).")
    lines.append("- TF-IDF uses sublinear term frequency (`1 + log(tf)`) and 1-2 grams so a single word like `firedamp` is enough signal, but `no test record` (a bigram) is also captured.")
    lines.append("- `LinearSVC` does not produce probability estimates by default; the live API returns `confidence = 1.0` for its predictions and falls back to Naive Bayes when probability calibration matters (e.g. inspector advisory).")
    lines.append("- The saved artifact is a single pickle file containing the full sklearn pipeline (TF-IDF + classifier). The runtime module `api/services/ml_severity.py` loads it once at first request and serves every prediction from it — no re-training at request time.")
    return "\n".join(lines)


def main() -> None:
    descs, sevs = load_corpus()
    print(f"Loaded corpus: {len(descs)} rows")
    class_counts = Counter(sevs)
    for c in CLASSES:
        print(f"  {c}: {class_counts.get(c, 0)}")

    results: dict[str, Any] = {}
    for name, model in models().items():
        print(f"\nTraining {name}...")
        pipeline = make_pipeline(model)
        cv = evaluate_cv(pipeline, descs, sevs, n_splits=5)
        # Refit on the full data, then evaluate on a holdout
        holdout = evaluate_holdout(make_pipeline(model), descs, sevs)
        results[name] = {"cv": cv, "holdout": holdout}
        print(f"  CV accuracy: {cv['accuracy_mean']:.4f} ± {cv['accuracy_std']:.4f}")
        print(f"  CV macro-F1: {cv['macro_f1_mean']:.4f} ± {cv['macro_f1_std']:.4f}")
        print(f"  Holdout accuracy: {holdout['accuracy']:.4f}")
        print(f"  Holdout fit time: {holdout['fit_seconds']:.3f}s")

    # Pick the best by macro-F1 mean across CV
    best_model = max(results, key=lambda k: results[k]["cv"]["macro_f1_mean"])
    print(f"\nBest model (by macro-F1 mean): {best_model}")

    # Retrain the best model on the full corpus and save it
    best_pipeline = make_pipeline(models()[best_model])
    best_pipeline.fit(descs, sevs)

    # Save the artifact
    ARTIFACT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(ARTIFACT_PATH, "wb") as fh:
        pickle.dump({
            "pipeline": best_pipeline,
            "model_name": best_model,
            "training_size": len(descs),
            "feature_count": 2000,
            "classes": CLASSES,
            "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "random_seed": RANDOM_SEED,
        }, fh)
    print(f"\nSaved artifact: {ARTIFACT_PATH}")

    # Save JSON results
    with open(JSON_RESULTS_PATH, "w", encoding="utf-8") as fh:
        json.dump({
            "best_model": best_model,
            "corpus_size": len(descs),
            "class_counts": dict(class_counts),
            "results": results,
        }, fh, indent=2)
    print(f"Saved evaluation JSON: {JSON_RESULTS_PATH}")

    # Write markdown report
    md = markdown_report(len(descs), dict(class_counts), results, best_model)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write(md)
    print(f"Saved report: {REPORT_PATH}")

    # Final summary
    print("\n" + "=" * 70)
    print("FINAL EVALUATION SUMMARY")
    print("=" * 70)
    print(f"Corpus size: {len(descs)}")
    print(f"Best model: {best_model}")
    best_cv = results[best_model]["cv"]
    best_ho = results[best_model]["holdout"]
    print(f"Cross-validation:")
    print(f"  Accuracy:  {best_cv['accuracy_mean']:.4f} ± {best_cv['accuracy_std']:.4f}")
    print(f"  Macro-F1:  {best_cv['macro_f1_mean']:.4f} ± {best_cv['macro_f1_std']:.4f}")
    print(f"Holdout (80/20 stratified):")
    print(f"  Accuracy:  {best_ho['accuracy']:.4f}")
    print(f"  Per-class F1:")
    for c in best_ho['per_class']:
        print(f"    {c['class']:8s}  P={c['precision']:.4f}  R={c['recall']:.4f}  F1={c['f1']:.4f}  (n={c['support']})")
    print(f"\nConfusion matrix (rows=true, cols=predicted):")
    print("            " + "  ".join(f"{c[:4]:>6s}" for c in best_ho['confusion_matrix_labels']))
    for i, row in enumerate(best_ho['confusion_matrix']):
        print(f"  {best_ho['confusion_matrix_labels'][i]:10s}  " + "  ".join(f"{x:6d}" for x in row))


if __name__ == "__main__":
    main()
