# Deploy VoteLens to Google Cloud (Cloud Run)

This guide delivers a **production-style** deployment: container image on **Artifact Registry**, service on **Cloud Run**, HTTPS URL, auto scaling (including scale-to-zero).

## Architecture (recommended)

| Piece | Choice | Why |
|--------|--------|-----|
| Compute | **Cloud Run** | Managed HTTPS, scales to zero, fits FastAPI + static UI |
| Images | **Artifact Registry** | Native Docker registry in GCP |
| Build | **Cloud Build** | Reproducible builds from `Dockerfile` |
| Database | None (stateless) | Uploads are processed in memory; add Cloud Storage / Firestore later if you need persistence |

Optional later: **Cloud Load Balancing** + custom domain, **Secret Manager** for API keys, **Cloud CDN** for static assets.

## Prerequisites

1. Google Cloud account with **billing** enabled.
2. [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`) installed locally.
3. Docker (optional, for local image tests).

Set project (replace with your project ID):

```bash
gcloud config set project YOUR_PROJECT_ID
```

## One-time setup

### 1. Enable APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
```

### 2. Create Artifact Registry repository

```bash
export REGION=us-central1
export AR_REPO=votelens

gcloud artifacts repositories create $AR_REPO \
  --repository-format=docker \
  --location=$REGION \
  --description="VoteLens containers"
```

Grant Cloud Build permission to push (often already configured via default SA; if push fails, use IAM docs for `roles/artifactregistry.writer` on the Cloud Build service account).

### 3. Grant Cloud Run deploy to Cloud Build (if using Cloud Build deploy step)

Cloud Build’s service account needs permission to deploy to Cloud Run, for example:

```bash
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding \
  PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project=$(gcloud config get-value project)
```

Replace `PROJECT_NUMBER-compute@developer.gserviceaccount.com` with the **runtime service account** you attach to Cloud Run if different (default Compute SA is common).

## Deploy (automated)

From the **repository root** (`IPl2_Plan 2`):

```bash
gcloud builds submit --config cloudbuild.yaml .
```

Edit `cloudbuild.yaml` substitutions if you change region, repo name, or service name.

After success, get the URL:

```bash
gcloud run services describe votelens --region=us-central1 --format='value(status.url)'
```

Open that URL in a browser; you should see the VoteLens UI and working `/api/health`.

## Deploy (manual)

Build and push locally (authenticate Docker to Artifact Registry first):

```bash
export REGION=us-central1
export AR_REPO=votelens
export SERVICE=votelens
export PROJECT=$(gcloud config get-value project)

gcloud auth configure-docker ${REGION}-docker.pkg.dev

docker build -t ${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}:local .
docker push ${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}:local

gcloud run deploy $SERVICE \
  --image ${REGION}-docker.pkg.dev/${PROJECT}/${AR_REPO}/${SERVICE}:local \
  --region $REGION \
  --platform managed \
  --memory 512Mi \
  --allow-unauthenticated
```

## Logo in Cloud Run

The UI uses **`/static/logo.png`**, served from **`static/logo.png`** in the repo (included via `COPY static` in the `Dockerfile`). Rebuild and redeploy after changing that file. **`/logo.png`** also serves **`Logo.png`** at the project root when it exists.

## Operations notes

- **Cold start**: First request after idle may take a few seconds (`min-instances=0`). Set `--min-instances=1` to reduce cold starts (costs more).
- **Upload size**: Large JSON uploads may need `--timeout` and client limits; increase Cloud Run request size only if you change app limits.
- **Private service**: Omit `--allow-unauthenticated` and use IAM / Identity-Aware Proxy for internal-only dashboards.
- **Observability**: Use Cloud Logging / Cloud Monitoring on the Cloud Run service.

## Verify

```bash
curl -sS "$(gcloud run services describe votelens --region=us-central1 --format='value(status.url)')/api/health"
```

Expect: `{"status":"ok"}`.

### 403 Forbidden (HTML “does not have permission to get URL”)

That response comes from **Google Cloud**, not VoteLens: invocations are restricted to signed-in identities.

**Fix** — grant anonymous invoke on the service (public demo):

```bash
gcloud run services add-iam-policy-binding votelens \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Or in the console: **Cloud Run** → service → **Security** / **Permissions** → allow **unauthenticated invocations**.

If your **organization policy** forbids `allUsers`, you cannot make the URL public; use IAM-authenticated access or IAP instead.

### Cloud Build failed (docker step exited with status 1)

1. **Read the log** (replace the build id with yours):

   ```bash
   gcloud builds log BUILD_ID --project=$(gcloud config get-value project)
   ```

   Or: **Cloud Console → Cloud Build → History → click the build → open step logs.**

2. **Step “build-image” failed** — usually `docker build`. Typical causes: wrong directory (run `gcloud builds submit` from the folder that contains `Dockerfile`), missing `app/`, `requirements.txt` install error. Scroll to the red error in the log.

3. **Step “push-image-*” failed** — Artifact Registry permission or missing repo. Fix:

   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:${BUILD_SA}" \
     --role="roles/artifactregistry.writer"
   ```

   Confirm the repo exists in the **same region** as `_REGION` in `cloudbuild.yaml` (default `us-central1`, name `votelens`).
