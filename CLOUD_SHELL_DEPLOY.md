# Deploy VoteLens using Google Cloud Shell (step by step)

Use the **browser terminal** in Google Cloud so you do not need Docker installed on your PC. Builds run in **Cloud Build**; the app runs on **Cloud Run**.

**Console:** open [Cloud Shell](https://shell.cloud.google.com/) while your project (**e.g. `bwai-495513`**) is selected in the top bar.

---

## Step 1 — Select project and region

In Cloud Shell:

```bash
gcloud config set project bwai-495513
gcloud config set run/region us-central1
```

Replace `bwai-495513` if you use another project ID.

---

## Step 2 — Enable required APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

Wait until the command finishes (no errors).

---

## Step 3 — Create Artifact Registry (Docker repository)

Do this **once per project** (skip if you already have repo `votelens` in `us-central1`):

```bash
gcloud artifacts repositories create votelens \
  --repository-format=docker \
  --location=us-central1 \
  --description="VoteLens containers"
```

If you see **already exists**, that is fine.

---

## Step 4 — Put the VoteLens code in Cloud Shell

Pick **one** method.

### Method A — Zip upload (good if the code is only on your laptop)

1. On your computer, zip the **whole** project folder (`IPl2_Plan 2`), including `Dockerfile`, `cloudbuild.yaml`, `app/`, `data/`, `static/`, `templates/`, `requirements.txt`.
2. In Cloud Shell, click the **⋮** (three dots) menu → **Upload** → choose the zip file.
3. Unzip and enter the folder (adjust the zip filename):

```bash
cd ~
unzip -q your-votelens-upload.zip -d votelens-src
cd ~/votelens-src
# If the zip contained a folder named "IPl2_Plan 2":
ls
cd "IPl2_Plan 2"
```

Confirm `Dockerfile` is here:

```bash
ls Dockerfile cloudbuild.yaml app requirements.txt
```

### Method B — Git clone (if the project is in GitHub/GitLab)

```bash
cd ~
git clone YOUR_REPOSITORY_URL votelens-src
cd votelens-src
# cd into the subfolder if your repo root is not the app root
```

---

## Step 5 — Allow Cloud Build to deploy Cloud Run

Run once per project (fixes common **Permission denied** on deploy).

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --project="$PROJECT_ID"
```

---

## Step 6 — Build and deploy

From the directory that contains **`Dockerfile`** and **`cloudbuild.yaml`**:

```bash
gcloud builds submit --config cloudbuild.yaml .
```

This can take **several minutes** the first time. You should see steps: build image → push → deploy Cloud Run.

---

## Step 7 — Open the live app

Get the URL:

```bash
gcloud run services describe votelens \
  --region=us-central1 \
  --format='value(status.url)'
```

Optional health check:

```bash
curl -sS "$(gcloud run services describe votelens --region=us-central1 --format='value(status.url)')/api/health"
```

Expected: `{"status":"ok"}`

Paste the URL into your browser to use VoteLens.

You can also open [Cloud Run](https://console.cloud.google.com/run?project=bwai-495513) and click the **`votelens`** service.

---

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| **403 Forbidden** (HTML page: “does not have permission to get URL”) | The Cloud Run service is **not** open to anonymous users. Fix: run **Allow public access** below. If your organization **blocks** `allUsers`, you must keep the service private and call it with a Google identity / IAP instead. |
| **Repository not found** (Artifact Registry) | Create the repo (Step 3) in the **same region** as `cloudbuild.yaml` (`us-central1`). |
| **Permission denied** deploying Cloud Run | Run Step 5 again; wait ~1 minute for IAM to propagate. |
| **Build fails** “file not found” | Run Step 4 from the folder that actually contains `Dockerfile` (`ls Dockerfile`). |
| **Wrong project** | `gcloud config get-value project` — fix with Step 1. |

### Allow public access (fix 403 on `/api/health`)

Replace region / service name if yours differ:

```bash
gcloud run services add-iam-policy-binding votelens \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

Or redeploy with the flag:

```bash
gcloud run deploy votelens \
  --region=us-central1 \
  --image=us-central1-docker.pkg.dev/$(gcloud config get-value project)/votelens/votelens:latest \
  --allow-unauthenticated
```

**Console:** Cloud Run → your service → **Security** → under **Authentication**, choose **Allow unauthenticated invocations** (wording may vary by UI version).

If the UI or `gcloud` says this is **blocked by organization policy**, your admin must allow public Cloud Run or you keep the service private and use **authenticated** requests only.

---

## Change region or service name

Edit **`cloudbuild.yaml`** substitutions at the top:

- `_REGION` — must match Artifact Registry location.
- `_AR_REPO` — must match the repo name from Step 3.
- `_SERVICE_NAME` — Cloud Run service name (default `votelens`).

---

## Logo on Cloud Run

Ensure **`static/logo.png`** is in the project you upload (it ships with the repo). Re-run Step 6 after replacing it. Root **`Logo.png`** is optional; **`/logo.png`** uses it when present.
