# VoteLens

**Bringing Election Data into Focus**

VoteLens is a small web app that turns structured election JSON (jurisdictions, contests, candidates, votes, optional turnout fields) into KPIs, charts, plain-language bullets, and simple monitoring signals.

## Requirements

- Python 3.12+ (3.11+ usually works)

## Run locally

```bash
cd IPl2_Plan 2   # or your clone directory
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Open **http://127.0.0.1:8765/** (do not open `index.html` as a `file://` URL—the API must be reachable).

## Project layout

| Path | Purpose |
|------|---------|
| `app/` | FastAPI app, Pydantic models, insight engine |
| `data/` | Sample `*.json` election files |
| `static/` | Dashboard (`index.html`, `app.js`, `styles.css`, `logo.png`) |
| `templates/` | Blank JSON template for downloads |
| `Dockerfile` | Container image for Cloud Run |
| `cloudbuild.yaml` | Google Cloud Build → Artifact Registry → Cloud Run |

## API (examples)

- `GET /api/health` — liveness
- `GET /api/election/samples` — list sample files
- `GET /api/election/samples/{id}/insights` — insights for one sample
- `POST /api/election/upload` — upload JSON (`multipart/form-data`, field `file`)
- `GET /api/election/template/download` — blank template file

## Deploy to Google Cloud

See **[DEPLOY_GCP.md](DEPLOY_GCP.md)** and **[CLOUD_SHELL_DEPLOY.md](CLOUD_SHELL_DEPLOY.md)** for Cloud Run and Cloud Shell step-by-step instructions.

## Logo

- **`static/logo.png`** is used by the UI (`/static/logo.png`) and is included in Docker builds.
- Optional **`Logo.png`** at the repo root is used by `/logo.png` when present.

## License

Use and modify for your own projects as needed.
