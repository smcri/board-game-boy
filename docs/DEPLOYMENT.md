# Deployment Runbook

This document is the operator's guide for getting the MVP running locally and
on Hugging Face Spaces + GitHub Pages, with a clear migration path to
DigitalOcean App Platform.

See also: [`docs/design/01-overview-and-architecture.md`](./design/01-overview-and-architecture.md).

---

## 1. Local quickstart

Prereqs: **Node ≥ 20**, **pnpm 9**, and (optional) **Ollama** for free LLM.

```bash
# 1. Install once
pnpm install

# 2. Type-check + test everything
pnpm typecheck
pnpm test

# 3. Run backend + UI together
pnpm dev
# Backend: http://localhost:8787
# UI:      http://localhost:5173
```

Open the UI, paste an LLM key (or pick Ollama for free), pick a search provider, and click **Build**.

To run a fully scripted build end-to-end without the UI:

```bash
pnpm smoke \
  --backend http://localhost:8787 \
  --llm ollama --model llama3.1:8b \
  --prompt "Tic-Tac-Toe" --mode known_game
```

---

## 2. GitHub Actions setup (one-time)

In your GitHub repo, set the following **repo variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Value | Used by |
|---|---|---|
| `VITE_BACKEND_URL` | `https://<your-hf-user>-<space-name>.hf.space` | `pages.yml` |
| `HF_SPACE_ID` | `<your-hf-user>/<space-name>` | `backend-deploy-hf.yml` |
| `ENABLE_DO_DEPLOY` | `false` (flip to `true` after migration) | `backend-deploy-do.yml` |

And these **secrets**:

| Secret | Value | Used by |
|---|---|---|
| `HF_TOKEN` | Hugging Face write token | `backend-deploy-hf.yml` |
| `DIGITALOCEAN_ACCESS_TOKEN` | DO API token (later) | `backend-deploy-do.yml` |
| `DO_APP_ID` | DO App Platform app ID (later) | `backend-deploy-do.yml` |

GitHub Pages: Settings → Pages → "Build and deployment" → Source = **GitHub Actions**.

---

## 3. Hugging Face Space (one-time)

1. Create a new Space:
   - Name: anything (must match the `HF_SPACE_ID` variable above).
   - SDK: **Docker**.
   - Hardware: free CPU is fine.
2. Set Space secrets if you ever bake provider keys server-side (not required — keys come per-request from the UI).
3. First deploy: push to `main`. The `backend-deploy-hf.yml` workflow extracts `apps/backend/` and pushes it as the Space's repo. HF builds the Dockerfile and serves it on port `7860`.
4. Persistent storage:
   - HF Spaces' Docker SDK exposes `/data` (≈50 GB on free tier).
   - `apps/backend` reads `DATA_DIR` (default `/data` in the container) and stores `bgb.sqlite` there.

---

## 4. GitHub Pages (UI + published bundles)

The `pages.yml` workflow builds `apps/ui` with `VITE_BACKEND_URL=<vars.VITE_BACKEND_URL>` and `VITE_BASE_PATH=/<repo-name>/`, then publishes `apps/ui/dist` to the `github-pages` artifact.

Published bundles live on a separate `gh-pages` branch and are served at
`https://<user>.github.io/<repo>/bundles/<bundle_id>/`. To publish one:

```bash
# Once: create the orphan branch
git checkout --orphan gh-pages
git rm -rf .
git commit --allow-empty -m "init gh-pages"
git push origin gh-pages
git checkout main

# Then for any built bundle:
pnpm publish-bundle <bundle_id>
git push origin gh-pages
```

The publisher script never pushes for you — you push the gh-pages branch yourself.

---

## 5. DigitalOcean migration (later)

The `backend-deploy-do.yml` workflow is shipped but guarded by `ENABLE_DO_DEPLOY=true`. To migrate from HF to DO:

1. Create a DO App from `apps/backend/Dockerfile`. Attach a `/var/data` persistent volume.
2. Note the app ID and create an API token; save them as `DO_APP_ID` and `DIGITALOCEAN_ACCESS_TOKEN` repo secrets.
3. In the UI repo, change `VITE_BACKEND_URL` to the DO app URL.
4. Flip `ENABLE_DO_DEPLOY=true`.
5. Push to `main`. The DO workflow deploys the same image; HF can be torn down later.

The backend code does not change between HF and DO — only the deploy target and the `VITE_BACKEND_URL` the UI talks to.

---

## 6. Smoke tests

After deploy, run the smoke test against the deployed backend:

```bash
pnpm smoke \
  --backend https://<your-hf-user>-<space-name>.hf.space \
  --llm openai --model gpt-4o-mini --llm-key sk-... \
  --search tavily --search-key tvly-... \
  --prompt "Chess" --mode known_game
```

A successful run prints SSE events ending in `{ type: "done", bundle_id, bundle_url }` and exits 0.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Backend not reachable` from smoke | Backend not running or wrong port | `pnpm dev:backend`; check `PORT` |
| SSE stream closes immediately | Browser blocked by CSP | Confirm `connect-src` includes the backend URL in `apps/ui/index.html` |
| HF Space builds but won't start | App not listening on `7860` | `apps/backend/src/config.ts` defaults `PORT=8787` locally; the Dockerfile sets `PORT=7860`. Verify the env survives in the deployed image |
| Bundle plays a blank board | `bundle.json` `dsl_version` mismatch | Rebuild with the current backend; engine refuses old `dsl_version` |
| Build hangs at `rules_agent` | Search provider key missing or rate-limited | Confirm key in Settings; check provider quotas |
| `interrupt` on every build | Many `core_mechanic` conflicts | Resolve in the UI's conflict modal; result is recorded in `bundle.json` |

---

## 8. Security notes (recap)

- API keys are stored in **browser `localStorage`** and sent **per request** as `X-LLM-API-Key` / `X-SEARCH-API-Key`. Never persisted server-side.
- Backend logs scrub `*api_key`, `*token`, and the two custom headers.
- UI ships a strict CSP (`default-src 'self'`; no `unsafe-eval`); only `'unsafe-inline'` for Tailwind-injected styles.
- Provided "Forget keys" button clears all `bgb.keys.*` entries.
- The bundle artifact never contains keys (the assembler validates this at write time).
