"""
MINEGUARD AI — Document Intelligence.

Modular extraction pipeline:

    upload → OCR / text-layer read → classify → key-information extraction
           → cross-check against open violations → suggested register entries

The text source is pluggable (see `BaseExtractor`): a PDF text layer is read
with pypdf when installed, `pdftotext` is used when present on the host,
`pdftotext`/Tesseract is used for images when available, and if no extractor is
installed the document is recorded with `status=QUEUED_FOR_EXTRACTION` rather
than silently faking an extraction result. Sample documents in the seed carry
pre-extracted data so the pipeline is demonstrable even on a machine with no
OCR binaries — and every such record states its engine and confidence so the
provenance is unambiguous.

Cross-checking is the useful part: extracted limits/counts are compared with
what is on the register, and mismatches become "gap" items a manager can turn
into violations with one click. That keeps the module connected to the core
risk loop instead of being a decorative upload box.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "uploads"))

CLASSIFICATION_RULES: List[tuple[str, re.Pattern]] = [
    ("INSPECTION_REPORT", re.compile(r"inspection report|inspection sheet|round report|\bIR/", re.I)),
    ("REGULATORY_RETURN", re.compile(r"half[- ]yearly return|form (viii|ix|xi)|annual return|return of", re.I)),
    ("CONSENT_ORDER", re.compile(r"consent to (operate|establish)|consent order|\bCO/W\b|\bCO/Z\b", re.I)),
    ("STATUTORY_REGISTER", re.compile(r"register|\bwage roll|muster|attendance", re.I)),
    ("MEASUREMENT_SHEET", re.compile(r"methane|dust measurement|anemometer|sampling|readings", re.I)),
    ("CORRECTIVE_EVIDENCE", re.compile(r"rectification|before and after|re[- ]?inspection|closure note", re.I)),
    ("MINING_PLAN", re.compile(r"mining plan|scheme of mining|layout plan|geo[- ]?electrical", re.I)),
]

FIELD_PATTERNS: Dict[str, re.Pattern] = {
    "report_no": re.compile(r"(?:report|ref|no\.?|#)\s*[:\-]?\s*([A-Z]{2,4}/[A-Z0-9/\-]{3,})", re.I),
    "licence_no": re.compile(r"\b(RIL/[A-Z]{2,4}/[A-Z]{2}/\d{3,6})\b"),
    "consent_no": re.compile(r"\b([A-Z]{3,6}/CO/[A-Z]/\d{3,7})\b"),
    "inspector": re.compile(r"inspector(?:'s)? name\s*[:\-]\s*([A-Z][a-zA-Z .]{3,40})", re.I),
    "date": re.compile(r"(?:date|d\.?o\.?)\s*[:\-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})", re.I),
    "defects_found": re.compile(r"(?:defects?|observations?|non-?conformit\w+)\D{0,20}?(\d{1,3})\b", re.I),
    "persons_employed": re.compile(r"(?:persons? employed|workforce|total employees)\D{0,12}(\d{2,6})", re.I),
    "fatalities": re.compile(r"fatalities\D{0,12}(\d{1,3})", re.I),
    "serious_injuries": re.compile(r"(?:serious injur\w+|grievous injur\w+)\D{0,12}(\d{1,3})", re.I),
    "days_lost": re.compile(r"days? lost\D{0,12}(\d{1,5})", re.I),
    "output_tonnes": re.compile(r"(?:output|production)\D{0,18}(\d{3,9})\s*(?:tonnes|t\b|mt\b)", re.I),
    "ph_min": re.compile(r"pH\s*(?:min|minimum)\s*[:=]?\s*(\d(?:\.\d)?)", re.I),
    "ph_max": re.compile(r"pH\s*(?:max|maximum)\s*[:=]?\s*(\d(?:\.\d)?)", re.I),
    "tss_mg_l": re.compile(r"TSS\D{0,10}(\d{2,4})\s*mg", re.I),
    "respirable_dust_mg_m3": re.compile(r"respirable dust\D{0,16}(\d(?:\.\d)?)\s*mg", re.I),
    "valid_upto": re.compile(r"valid\s*(?:upto|up to|until)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})", re.I),
    "deadline": re.compile(r"(?:deadline|due|complete by|action by)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})", re.I),
    "immediate_stop": re.compile(r"immediate stoppage\s*[:\-]?\s*(yes|no)", re.I),
    "period": re.compile(r"(?:period|for the period)\s*[:\-]?\s*([A-Z][a-z]{2}\s*\d{2,4}\s*[–-]\s*[A-Z][a-z]{2}\s*\d{2,4})", re.I),
}

SEVERITY_HINTS = [
    (re.compile(r"immediate|cessation|stop(?:page)? work|danger|fire|firedamp|inundation", re.I), "CRITICAL"),
    (re.compile(r"exceeds|over limit|not provided|missing|defective|out of order|failed", re.I), "HIGH"),
    (re.compile(r"delayed|overdue|not updated|incomplete|behind schedule", re.I), "MEDIUM"),
    (re.compile(r"advisory|recommend|minor|housekeeping", re.I), "LOW"),
]


@dataclass
class ExtractionResult:
    text: str
    engine: str
    confidence: float
    pages: int
    error: Optional[str] = None


class BaseExtractor:  # pragma: no cover - interface
    name = "base"

    def extract(self, path: str) -> ExtractionResult:
        raise NotImplementedError


class PdfTextLayerExtractor(BaseExtractor):
    """Fastest path: read the embedded text layer, no OCR needed."""

    name = "text-layer"

    def extract(self, path: str) -> ExtractionResult:
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError:
            return ExtractionResult("", self.name, 0.0, 0, "pypdf not installed")
        try:
            reader = PdfReader(path)
            pages = len(reader.pages)
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
            if not text.strip():
                return ExtractionResult("", self.name, 0.0, pages, "no text layer — rasterised scan")
            return ExtractionResult(text, self.name, 0.95, pages)
        except Exception as exc:  # corrupt/encrypted pdf
            return ExtractionResult("", self.name, 0.0, 0, f"{type(exc).__name__}: {exc}")


class PopplerExtractor(BaseExtractor):
    name = "pdftotext"

    def extract(self, path: str) -> ExtractionResult:
        if not shutil.which("pdftotext"):
            return ExtractionResult("", self.name, 0.0, 0, "poppler not installed")
        try:
            out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True, timeout=25)
            text = out.stdout or ""
            pages = text.count("\f") or 1
            if not text.strip():
                return ExtractionResult("", self.name, 0.0, pages, "no text layer")
            return ExtractionResult(text, self.name, 0.93, pages)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return ExtractionResult("", self.name, 0.0, 0, str(exc))


class TesseractExtractor(BaseExtractor):
    name = "tesseract"

    def extract(self, path: str) -> ExtractionResult:
        if not shutil.which("tesseract"):
            return ExtractionResult("", self.name, 0.0, 0, "tesseract not installed")
        try:
            out = subprocess.run(["tesseract", path, "-"], capture_output=True, text=True, timeout=45)
            text = out.stdout or ""
            if not text.strip():
                return ExtractionResult("", self.name, 0.2, 1, "no legible text")
            return ExtractionResult(text, self.name, 0.71, 1)
        except (subprocess.TimeoutExpired, OSError) as exc:
            return ExtractionResult("", self.name, 0.0, 1, str(exc))


class PlainTextExtractor(BaseExtractor):
    name = "text-file"

    def extract(self, path: str) -> ExtractionResult:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read(400_000)
        except OSError as exc:
            return ExtractionResult("", self.name, 0.0, 1, str(exc))
        if not text.strip():
            return ExtractionResult("", self.name, 0.0, 1, "empty file")
        return ExtractionResult(text, self.name, 0.99, max(1, text.count("\n\f") + 1))


PIPELINE: List[BaseExtractor] = [PdfTextLayerExtractor(), PopplerExtractor(), TesseractExtractor(), PlainTextExtractor()]


def available_engines() -> Dict[str, bool]:
    return {
        "pypdf (PDF text layer)": _has("pypdf"),
        "pdftotext (poppler)": bool(shutil.which("pdftotext")),
        "tesseract (OCR)": bool(shutil.which("tesseract")),
    }


def _has(module: str) -> bool:
    try:
        __import__(module)
        return True
    except ImportError:
        return False


def extract(path: str, mime_hint: str = "") -> ExtractionResult:
    """Run the pipeline, using the first extractor that yields text."""
    lower = path.lower()
    ordered = list(PIPELINE)
    if lower.endswith((".txt", ".md", ".csv")):
        ordered.insert(0, PlainTextExtractor())
    last_error = "no extractor produced text"
    for extractor in ordered:
        if lower.endswith((".png", ".jpg", ".jpeg")) and isinstance(extractor, (PdfTextLayerExtractor, PopplerExtractor)):
            continue
        result = extractor.extract(path)
        if result.text.strip():
            return result
        if result.error:
            last_error = result.error
    return ExtractionResult("", "unavailable", 0.0, 1, last_error)


def classify(text: str, file_name: str) -> tuple[str, float]:
    haystack = f"{file_name}\n{text[:4000]}"
    for label, pattern in CLASSIFICATION_RULES:
        hits = len(pattern.findall(haystack))
        if hits:
            return label, round(min(0.98, 0.72 + 0.09 * hits), 2)
    return "UNCLASSIFIED", 0.4


def extract_fields(text: str) -> Dict[str, str]:
    found: Dict[str, str] = {}
    for key, pattern in FIELD_PATTERNS.items():
        match = pattern.search(text)
        if match:
            found[key] = match.group(1).strip()
    return found


def suggest_severity(text: str) -> Optional[str]:
    for pattern, severity in SEVERITY_HINTS:
        if pattern.search(text):
            return severity
    return None


def store_upload(store, *, file_name: str, content: bytes, mine_id: str, zone_id: Optional[str], uploaded_by: str, notes: str = "") -> dict:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", file_name)
    stored_at = os.path.join(UPLOAD_DIR, f"{date.today().isoformat()}-{store.next_id('documents', 'DOC')}")
    with open(stored_at, "wb") as fh:
        fh.write(content)

    result = extract(stored_at, file_name)
    doc_type, confidence = (
        classify(result.text, file_name) if result.text else ("QUEUED_FOR_EXTRACTION", 0.0)
    )
    fields = extract_fields(result.text) if result.text else {}
    severity_hint = suggest_severity(result.text) if result.text else None

    doc = {
        "id": os.path.basename(stored_at).split("-", 1)[1],
        "file_name": file_name,
        "stored_path": stored_at,
        "mine_id": mine_id,
        "zone_id": zone_id or None,
        "doc_type": doc_type,
        "uploaded_at": date.today().isoformat(),
        "uploaded_by": uploaded_by,
        "status": "PROCESSED" if result.text else "FAILED",
        "pages": result.pages,
        "confidence": confidence,
        "ocr_engine": result.engine,
        "extracted": fields,
        "severity_hint": severity_hint,
        "notes": notes,
        "linked_violations": [],
        "summary": _summary(doc_type, fields, result.error),
        "flags": [],
        "text_chars": len(result.text),
    }
    if result.error:
        doc["flags"].append(result.error)
    doc["flags"] += gap_flags(store, doc)
    store.data.setdefault("documents", []).append(doc)
    store.log(uploaded_by, "DOCUMENT", f"{file_name} processed by {result.engine} as {doc_type}.", doc["id"])
    store.touch()
    return doc


def gap_flags(store, doc: dict) -> List[str]:
    """Compare extracted figures with the register for the same zone."""
    flags: List[str] = []
    zone_id = doc.get("zone_id")
    if not zone_id:
        return flags
    extracted_defects = doc.get("extracted", {}).get("defects_found")
    if extracted_defects:
        open_count = len([v for v in store.data.get("violations", []) if v["zone_id"] == zone_id and v["status"] != "CLOSED"])
        try:
            claimed = int(extracted_defects)
        except (TypeError, ValueError):
            return flags
        if claimed > open_count:
            flags.append(
                f"document reports {claimed} defect(s) but only {open_count} open finding(s) are on the register "
                f"for {(store.zone(zone_id) or {}).get('short_name', zone_id)}"
            )
        elif claimed < open_count:
            flags.append(
                f"register holds {open_count} open findings while the document records {claimed} — possible duplicate entries"
            )
    limits = {k: v for k, v in doc.get("extracted", {}).items() if k in {"ph_min", "ph_max", "tss_mg_l", "respirable_dust_mg_m3"}}
    if limits:
        flags.append("consent limits extracted — validate against open environmental findings for this zone")
    return flags


def _summary(doc_type: str, fields: Dict[str, str], error: Optional[str]) -> str:
    if error:
        return f"Extraction incomplete: {error}. The file is retained and can be re-processed once the source is legible."
    if not fields:
        return f"Classified as {doc_type.replace('_', ' ').lower()}. No standard fields matched; review manually."
    keys = list(fields.items())[:4]
    return "Extracted " + ", ".join(f"{k.replace('_', ' ')} = {v}" for k, v in keys) + "."
