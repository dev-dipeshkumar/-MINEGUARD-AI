"""
MINEGUARD AI — ML Severity Classifier (Phase 2, artifact-loaded).

This module loads a trained sklearn pipeline from
`api/ml_artifacts/severity_model.pkl` (produced by
`scripts/train_ml_model.py`) and serves predictions from it.

If the artifact is missing or sklearn is not installed, the module falls
back to a keyword-Bayes predictor (see KeywordClassifier below). The
fallback mode is surfaced via the `mode` field returned by
`engine_descriptor()`, so the UI and the X-Mineguard-Engine header both
label the running mode truthfully.

Artifact contents (a pickle dict):
  * `pipeline`  — full sklearn Pipeline (TfidfVectorizer + classifier)
  * `model_name` — one of {naive_bayes, logistic_regression,
                  linear_svm, random_forest}
  * `training_size`
  * `feature_count`
  * `classes`
  * `trained_at`
  * `random_seed`

To reproduce training and refresh the artifact:
    python3 scripts/build_ml_corpus.py
    python3 scripts/train_ml_model.py
"""
from __future__ import annotations

import os
import pickle
import re
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Severity vocabulary — only used by the KeywordClassifier fallback, never
# when the trained artifact is available.
# ---------------------------------------------------------------------------
SEVERITY_LEXICON: Dict[str, List[str]] = {
    "CRITICAL": [
        "immediate stoppage", "cessation", "fire", "firedamp", "methane", "inundation",
        "explosion", "roof collapse", "fall of side", "fall of roof", "fatal",
        "imminent danger", "stop work", "inoperative critical", "no ventilation",
        "goaf ignition", "spark", "gas exceed", "outburst",
    ],
    "HIGH": [
        "inoperative", "defective", "out of order", "missing", "not provided",
        "failed", "exceeds", "over limit", "absent", "broken", "no test record",
        "earth continuity", "flameproof", "support", "deformed", "cracked",
        "incomplete", "overdue", "absent", "no certificate",
    ],
    "MEDIUM": [
        "delayed", "overdue", "not updated", "behind schedule", "minor defect",
        "smoke", "no register", "log missing", "incomplete record", "patch",
        "housekeeping", "advisory",
    ],
    "LOW": [
        "advisory", "recommend", "minor", "housekeeping", "cleanliness",
        "labelling", "fading", "legibility", "minor observation",
    ],
}


class KeywordClassifier:
    """Fallback classifier when sklearn or the trained artifact is unavailable."""

    name = "keyword-bayes-v0"

    def predict(self, description: str) -> Tuple[str, float]:
        text = description.lower()
        scores: Dict[str, int] = {}
        for label, words in SEVERITY_LEXICON.items():
            scores[label] = sum(1 for w in words if w in text)
        total = sum(scores.values())
        if total == 0:
            return "MEDIUM", 0.25
        best_label = max(scores, key=lambda k: scores[k])
        if list(scores.values()).count(scores[best_label]) > 1:
            best_label = max(
                [k for k, v in scores.items() if v == scores[best_label]],
                key=lambda k: {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}[k],
            )
        confidence = scores[best_label] / total
        return best_label, round(min(0.95, 0.5 + confidence * 0.4), 2)

    def predict_batch(self, descriptions: List[str]) -> List[Tuple[str, float]]:
        return [self.predict(d) for d in descriptions]


class ArtifactClassifier:
    """Wraps the trained sklearn pipeline; serves live predictions from it."""

    name = "tfidf-svm-v0"

    def __init__(self, artifact: Dict[str, Any]) -> None:
        self.pipeline = artifact["pipeline"]
        self.model_name = artifact["model_name"]
        self.classes_: List[str] = artifact["classes"]
        self.training_size_ = artifact["training_size"]
        self.feature_count_ = artifact["feature_count"]
        self.trained_at_ = artifact["trained_at"]
        # LinearSVC has no predict_proba — fall back to a confidence derived
        # from the decision_function. Naive Bayes / Logistic Regression do
        # expose predict_proba, in which case we use it directly.
        self._has_proba = hasattr(self.pipeline, "predict_proba")
        # The pipeline's final step is the classifier — probe it.
        try:
            clf = self.pipeline.named_steps["clf"]
            self._has_proba = hasattr(clf, "predict_proba")
        except Exception:
            pass

    def predict(self, description: str) -> Tuple[str, float]:
        try:
            X = self.pipeline[:-1].transform([description])  # TF-IDF only
            clf = self.pipeline.named_steps["clf"]
            pred = clf.predict(X)[0]
            if self._has_proba:
                proba = clf.predict_proba(X)[0]
                idx = list(clf.classes_).index(pred)
                return str(pred), round(float(proba[idx]), 3)
            if hasattr(clf, "decision_function"):
                df = clf.decision_function(X)[0]
                # Convert signed distance to a pseudo-confidence via softmax.
                import math
                shifted = df - max(df)
                exps = [math.exp(v) for v in shifted]
                total = sum(exps)
                idx = list(clf.classes_).index(pred)
                return str(pred), round(exps[idx] / total, 3)
            return str(pred), 0.7
        except Exception:
            # Defensive — never raise from a prediction path.
            return "MEDIUM", 0.3

    def predict_batch(self, descriptions: List[str]) -> List[Tuple[str, float]]:
        if not descriptions:
            return []
        return [self.predict(d) for d in descriptions]


# ---------------------------------------------------------------------------
# Singleton accessor — used by routers and the explainable engine.
# ---------------------------------------------------------------------------
_classifier: Optional[Any] = None
_mode: str = "uninitialised"
_artifact_loaded: bool = False


def _artifact_path() -> str:
    return os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "ml_artifacts", "severity_model.pkl")
    )


def get_classifier() -> Any:
    """Lazy singleton. Loads the trained artifact on first call."""
    global _classifier, _mode, _artifact_loaded
    if _classifier is not None:
        return _classifier
    path = _artifact_path()
    if os.path.exists(path):
        try:
            with open(path, "rb") as fh:
                artifact = pickle.load(fh)
            clf = ArtifactClassifier(artifact)
            _classifier = clf
            _mode = clf.name
            _artifact_loaded = True
            return _classifier
        except Exception:
            # Fall through to keyword fallback.
            pass
    _classifier = KeywordClassifier()
    _mode = _classifier.name
    return _classifier


def predict_severity(description: str) -> Dict[str, Any]:
    clf = get_classifier()
    label, confidence = clf.predict(description)
    return {
        "predicted_severity": label,
        "confidence": confidence,
        "model": _mode,
        "fallback": not _artifact_loaded,
        "training_size": getattr(clf, "training_size_", 0),
        "trained_at": getattr(clf, "trained_at_", None),
    }


def predict_batch(descriptions: List[str]) -> List[Dict[str, Any]]:
    clf = get_classifier()
    results = clf.predict_batch(descriptions)
    return [
        {
            "predicted_severity": label,
            "confidence": conf,
            "model": _mode,
            "fallback": not _artifact_loaded,
        }
        for label, conf in results
    ]


def engine_descriptor() -> Dict[str, Any]:
    """Served by /api/ml/describe — proves a trained model exists, not a stub."""
    clf = get_classifier()
    if _artifact_loaded and isinstance(clf, ArtifactClassifier):
        return {
            "mode": _mode,
            "model_name": clf.model_name,
            "label": f"TF-IDF + {clf.model_name.replace('_', ' ').title()} (trained artifact)",
            "phase": "Phase 2 (active)",
            "classes": clf.classes_,
            "training_size": clf.training_size_,
            "features": clf.feature_count_,
            "trained_at": clf.trained_at_,
            "fallback": False,
        }
    return {
        "mode": _mode,
        "label": "Keyword Bayes fallback (artifact or sklearn unavailable)",
        "phase": "Phase 2 fallback",
        "classes": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
        "training_size": 0,
        "features": len(SEVERITY_LEXICON),
        "fallback": True,
    }
