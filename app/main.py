from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import ValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .insights import transform_election_to_insights
from .models import ElectionRecord

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
BLANK_TEMPLATE_FILE = "template_election.json"


def resolve_logo_path() -> Path | None:
    """Prefer project-root Logo.png; fall back to static/logo.png (included in Docker COPY static)."""
    for candidate in (ROOT / "Logo.png", STATIC_DIR / "logo.png"):
        if candidate.is_file():
            return candidate
    return None

# Used if templates/ is missing in deployment (same schema as templates/template_election.json).
_FALLBACK_TEMPLATE_JSON = """{
  "election_id": "your-election-id",
  "title": "Your election title",
  "reported_at": null,
  "jurisdictions": [
    {
      "id": "jurisdiction-1",
      "name": "Example county or precinct",
      "registered_voters": 10000,
      "ballots_cast": 0,
      "contests": [
        {
          "office": "Example office (e.g. Mayor)",
          "candidates": [
            { "name": "Candidate name", "party": "", "votes": 0 }
          ]
        }
      ]
    }
  ]
}
"""

DEFAULT_SAMPLE_STEM = "sample_election"
SAMPLE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")

def _sample_stem_from_id(sample_id: str) -> str:
    sid = sample_id.strip()
    if not sid or not SAMPLE_ID_PATTERN.match(sid):
        raise HTTPException(status_code=400, detail="Invalid sample id")
    if sid.endswith(".json"):
        sid = sid[: -len(".json")]
    return sid


def list_sample_json_files() -> list[Path]:
    if not DATA_DIR.is_dir():
        return []
    return sorted(p for p in DATA_DIR.glob("*.json") if p.is_file())


def _resolved_json_under(root: Path, filename_stem: str, suffix: str = ".json") -> Path:
    """Resolve json path under root; reject path traversal."""
    base = root.resolve()
    path = (base / f"{filename_stem}{suffix}").resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        path.relative_to(base)
    except ValueError as e:
        raise HTTPException(status_code=404, detail="Invalid path") from e
    return path


def _attachment_json_bytes(data: bytes, download_filename: str) -> Response:
    safe_name = download_filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=data,
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Cache-Control": "no-store",
        },
    )


def _blank_template_body() -> bytes:
    path = TEMPLATES_DIR / BLANK_TEMPLATE_FILE
    if path.is_file():
        return path.read_bytes()
    return _FALLBACK_TEMPLATE_JSON.encode("utf-8")


def load_election_from_data_file(stem: str) -> ElectionRecord:
    path = _resolved_json_under(DATA_DIR, stem)
    raw = path.read_text(encoding="utf-8")
    return ElectionRecord.model_validate_json(raw)


def load_sample_election() -> ElectionRecord:
    """Default demo file (backward compatible with /api/election/sample)."""
    return load_election_from_data_file(DEFAULT_SAMPLE_STEM)


app = FastAPI(
    title="VoteLens",
    description="Bringing Election Data into Focus — transforms jurisdiction-level election results into KPIs, narratives, and monitoring signals.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/logo.png")
async def logo() -> FileResponse:
    path = resolve_logo_path()
    if path is None:
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path, media_type="image/png", filename="Logo.png")


@app.get("/")
async def index() -> FileResponse:
    index_path = STATIC_DIR / "index.html"
    if not index_path.is_file():
        raise HTTPException(status_code=404, detail="Dashboard not built (missing static/index.html)")
    return FileResponse(index_path)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/election/sample")
async def get_sample_insights() -> dict:
    election = load_sample_election()
    return transform_election_to_insights(election)


@app.get("/api/election/samples")
async def list_election_samples() -> dict:
    """All *.json files in data/ with basic metadata for the dashboard grid."""
    items: list[dict[str, str | int]] = []
    for path in list_sample_json_files():
        stem = path.stem
        try:
            election = load_election_from_data_file(stem)
        except (HTTPException, ValidationError, ValueError, json.JSONDecodeError):
            continue
        items.append(
            {
                "id": stem,
                "filename": path.name,
                "title": election.title,
                "election_id": election.election_id,
                "jurisdiction_count": len(election.jurisdictions),
            }
        )
    return {"samples": items, "default_id": DEFAULT_SAMPLE_STEM}


@app.get("/api/election/template/download")
async def download_blank_template() -> Response:
    """Blank VoteLens election JSON template for editing offline."""
    body = _blank_template_body()
    return _attachment_json_bytes(body, "vote_lens_template.json")


@app.get("/api/election/samples/{sample_id}/insights")
async def get_sample_insights_by_id(sample_id: str) -> dict:
    stem = _sample_stem_from_id(sample_id)
    election = load_election_from_data_file(stem)
    return transform_election_to_insights(election)


@app.get("/api/election/samples/{sample_id}/download")
async def download_sample_json(sample_id: str) -> Response:
    """Download raw JSON for any valid sample file in data/."""
    stem = _sample_stem_from_id(sample_id)
    path = _resolved_json_under(DATA_DIR, stem)
    return _attachment_json_bytes(path.read_bytes(), path.name)


@app.post("/api/election/insights")
async def post_insights(body: ElectionRecord) -> dict:
    return transform_election_to_insights(body)


@app.post("/api/election/upload")
async def upload_json(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Upload a .json file matching the election schema.")
    raw = await file.read()
    try:
        data = json.loads(raw.decode("utf-8"))
        election = ElectionRecord.model_validate(data)
    except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON or schema: {e}") from e
    return transform_election_to_insights(election)


if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
