# Deploying MINEGUARD AI to a live URL

Two supported shapes. Both are configured in this repo already — nothing here is a
plan, it is the config the platforms read.

| Shape | What you get | Files that do it |
| --- | --- | --- |
| **A. Render only** | One URL serving SPA **+** `/api` from one origin. Zero app changes. Free plan: sleeps after 15 min idle. | `Dockerfile`, `.dockerignore`, `render.yaml` |
| **B. Vercel (UI) + Render (API)** | The SPA on Vercel's edge (never sleeps, fast first paint) with the API still on Render's free web service. | `frontend/vercel.json`, `VITE_API_BASE_URL` |

**Recommendation: A first, then B on top if the cold start bothers you.** A is the
honest minimum — one build, one origin, one thing that can go wrong in front of a
judge. B costs one env var and buys a UI that never wakes up slowly; the API call
still pays Render's ~1 min spin-up once, but the shell, CSS and charts are instant.

C — Vercel alone — is deliberately **not** configured: the write path
(`api/store.py`, `DATA_PATH = <repo>/data/store.json`, atomic replace) is a
mutable file, and a serverless runtime gives you a read-only filesystem and no
shared state across invocations. Making Vercel the API host means implementing the
Postgres repository behind the existing seam first (`docs/DATA_MODEL.md` §1/§10
names it as the swap point). That is the right move for production, not for a
demo weekend.

---

## 1. Prerequisites

```bash
# Render CLI (Linux/macOS; NOT Homebrew in a sandbox — use the install script)
curl -fsSL https://raw.githubusercontent.com/render-oss/cli/refs/heads/main/bin/install.sh | sh
export PATH="$PATH:$HOME/.local/bin"      # the script installs here, not on PATH
render --version                           # v2.x  (the flag is --version, not `version`)

# Vercel CLI — no global install needed
npx --yes vercel --version
```

Auth, in the order of least friction for an agent-driven deploy:

* **Render** — `render login` opens a browser to authorise a CLI token. In a
  headless sandbox there is no browser, so export an API key instead:
  `export RENDER_API_KEY=...` (Dashboard → Account Settings → API Keys → Create Key).
  Confirm the CLI resolved credentials with `render workspaces` (it 401s if you are not authenticated).
* **Vercel** — `export VERCEL_API_TOKEN=...` (Account → Settings → Tokens → Full
  Access). The CLI picks it up automatically; no interactive login.
* **GitHub** — only Shape A needs it, because `render.yaml` is Git-driven and
  Render clones your repo: `git push origin main` first.

Validate the blueprint offline against Render's published schema (no account needed):

```bash
curl -sL https://render.com/schema/render.yaml.json -o /tmp/render_schema.json
python3 - <<'PY'
import json, yaml, jsonschema
d = yaml.safe_load(open('render.yaml')); s = json.load(open('/tmp/render_schema.json'))
errs = list(jsonschema.Draft7Validator(s).iter_errors(d))
print('valid' if not errs else '\n'.join('/'.join(map(str,e.path))+': '+e.message for e in errs))
PY
```

(`render blueprints validate ./render.yaml` does the same *plus* checks that your
`branch` exists on GitHub — that one needs a workspace, so it fails with
`no workspace specified` until you are authenticated.)

## 2. Shape A — Render only

```bash
git push origin main                     # Render builds from the repo, not from here
render services create ./render.yaml     # non-interactive; reads Dockerfile + plan: free
render deploys list --service mineguard-ai
render logs mineguard-ai --tail           # watch the build: npm ci → vite build → pip install
curl -s https://mineguard-ai.onrender.com/api/health   # {"status":"ok",...}
```

That URL *is* the product: `/` returns the SPA, `/api/*` the engine, deep links
like `/command-centre` are served by the SPA catch-all in `api/main.py`.
`healthCheckPath: /api/health` makes Render hold traffic until the app answers.

If you would rather click: Dashboard → New → **Blueprint** → pick the repo; it
reads the same `render.yaml`.

## 3. Shape B — Vercel for the UI, Render for the API

```bash
npx vercel link  --cwd frontend --yes     # first time only; creates the project
npx vercel env add VITE_API_BASE_URL production --cwd frontend
#   value:  https://mineguard-ai.onrender.com      (no trailing slash — it is stripped anyway)
npx vercel deploy --prod --cwd frontend --token "$VERCEL_API_TOKEN"
```

`frontend/vercel.json` sets `framework: vite`, `installCommand: npm ci`,
`outputDirectory: dist`, an SPA fallback rewrite, and long immutable caching for
hashed `/assets/*`. `frontend/package.json` already builds with
`tsc --noEmit && vite build`, so a type error fails the deploy rather than
shipping a broken bundle.

`VITE_API_BASE_URL` is read in exactly one place — `apiUrl()` in
`frontend/src/lib/api.ts` — which every request now goes through, including the
four call sites outside the client (`/api/alerts` badge, `/api/health` ping,
demo reset, report download) and the upload helper. Unset, the base is `''` and
behaviour is byte-for-byte what it was, which is why the same build still works in
the sandbox preview and in Docker. Cross-origin works because the API sends
`access-control-allow-origin: *` and allows the `X-User-Id` header.

Prefer one origin with no env var? `frontend/vercel.proxy.example.json` is the
same config with `/api/:path*` rewritten to Render. Copy it over
`frontend/vercel.json`, paste your Render origin, deploy — the browser then only
ever talks to Vercel.

## 4. State, persistence, and what "it reset" means

`api/store.py` keeps everything in `data/store.json` (plus uploaded originals in
`data/uploads/`). `data/` is gitignored — the repo ships no demo state — and
`Store.load()` seeds the deterministic baseline when the file is absent.

On Render's **Free** plan the filesystem is ephemeral, and idle services spin down,
so: uploads and scenario edits survive while the instance is warm, and disappear on
redeploy / restart / spin-down. The container then comes back at the documented
baseline (4 mines, 20 zones, 77 inspections, 78 violations, 76 actions, 66 evidence
items, 4 documents) — the same state `POST /api/admin/reset` produces. For a
judged demo that is a feature, not a bug: nothing you click can leave the deck's
numbers wrong.

To keep state across restarts you must pay Render for a disk (free services cannot
have one) — the store needs it mounted **exactly** at the path it computes, and
`DATA_PATH` has no env override:

```yaml
# render.yaml → services[0], with plan: starter or above
    disk:
      name: mineguard-data
      mountPath: /opt/data
      sizeGB: 1
# and run the app with /app/data symlinked onto it, e.g. in a pre-deploy step or
# a CMD that does:  ln -sfn /opt/data /app/data
```

The cleaner long-term step is the one the code is already shaped for: point the
repository seam at Postgres (`runtime: python` + `databases:` in the blueprint, or a
free Supabase instance) — then even Vercel-only becomes viable and a Render free
Postgres is at least restart-safe for 30 days.

## 5. Demo hygiene before you send a link

Writes are **unauthenticated**: any visitor can assign actions, upload documents
and call `POST /api/admin/reset` (the role switcher is an authorisation demo, not
a security boundary — `X-User-Id` is a header you can set in devtools). Fine for a
hackathon walkthrough, not fine for a link on a public README. Two cheap options:

* keep it open and accept that a visitor may reset the scenario (the deck's figures
  are baseline figures, so a reset is harmless); or
* add a shared-secret middleware for non-`GET` requests in `api/main.py`, and gate
  `/api/admin/*` entirely.

Also note `robots.txt`: while a Render free service is spun down, Render itself
answers `/robots.txt` with a disallow-all, which is exactly what you want for a
demo that should not be indexed.

## 6. Known platform limits, stated plainly

* `npm run build` in `frontend` and `pip install -r requirements.txt` are the same
  commands the image runs; there is no Docker daemon in the dev sandbox, so the
  platform build is the first real test of the `Dockerfile`.
* Vite's root is `frontend/` and there is no root `package.json`; every command in
  this file uses `--cwd frontend` or `cd frontend` for that reason.
* Free tier: 750 instance-hours/workspace/month, ~512 MB RAM, 1 CPU, single
  instance, no SSH, no one-off jobs, no scaling. A p90 of a few hundred ms on the
  compute-heavy endpoints is expected there; the timing middleware
  (`X-Mineguard-Compute-Ms`) is how you tell a cold instance from a slow query.

---

## 7. "Backend not reachable" on a live URL — read the response, not the message

The shell rendering *that specific screen* is good news: it means the SPA bundle
loaded and only its data call failed. The UI (`src/App.tsx`) shows it whenever
`/api/bootstrap` does not return JSON. Five causes, each with a one-line check —
run them in order and you will land on yours:

| # | What `curl -i` shows | Meaning | Fix |
| --- | --- | --- | --- |
| 1 | Vercel/CDN origin: `200` + body `The page could not be found` / `NOT_FOUND` / `<region>::<req-id>` | There is **no API on that origin at all** — the body is the platform's own 404 page, not FastAPI's JSON. A static Vite deploy hosts files only. | §8 |
| 2 | `503` with header `x-render-routing: suspend` and body `This service has been suspended.` | Render **suspended** the service: free instance-hours used up (750/workspace/month), outbound bandwidth exceeded with no payment method, or the service-initiated-traffic threshold. | Dashboard → Billing. On the Free plan only a paid compute plan restores it. |
| 3 | `200`/`503` HTML "loading" page from Render | Idle spin-down; Render answers while it wakes | Wait ~60 s, then retry. Keep `/api/health` open in a tab during a demo |
| 4 | `200 {"status":"ok","engine":...}` | API healthy → the *client* is not pointing at it | §8, and note 5 below |
| 5 | Deep links (`/command-centre`) `404` but `/` works | No SPA fallback rewrite on the static host | deploy with `frontend/vercel.json` |

**5. `VITE_API_BASE_URL` is baked at build time.** It is read by Vite while
building, not at request time — adding the env var and *not* redeploying changes
nothing, and a bundle built from a commit that predates `apiUrl()` in
`frontend/src/lib/api.ts` has no hook at all (the deployed JS simply contains
relative `/api` strings). Confirm which build you are serving:

```bash
JS=$(curl -s https://mineguardai.vercel.app/ | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -1)
curl -s "https://mineguardai.vercel.app$JS" | grep -c "onrender"   # 0 => base hook absent or unset
```

## 8. Making a Vercel-hosted UI talk to a Render-hosted API

Two ways; both live in this repo. Pick by whether the deployed bundle has the hook.

**A. Edge proxy (works with ANY bundle, including one built before the hook).**
Vercel forwards `/api/*` to Render, so the browser stays same-origin:

```bash
RENDER_URL=https://<your-service>.onrender.com bash tools/vercel-config.sh
# writes frontend/vercel.json, validates the JSON and asserts the /api rule sits
# above the SPA fallback — get that order wrong and every data call comes back as
# a 200 full of HTML, which renders exactly the screen in §7.
git add frontend/vercel.json && git commit -m "chore(vercel): proxy /api to Render" && git push
npx vercel deploy --prod --cwd frontend --token "$VERCEL_API_TOKEN"
```

Check it from the outside: `curl -i https://mineguardai.vercel.app/api/health` must
return the JSON from table row 4, now served by the Vercel origin.

**B. Client-side base (no proxy hop, browser talks to Render directly).** Needs a
build that contains `apiUrl()`: set `VITE_API_BASE_URL=https://<service>.onrender.com`
in Vercel → Settings → Environment Variables → **Production**, then redeploy (a
redeploy is a rebuild; that is what matters). CORS is already open
(`allow_origins=["*"]`, `allow_credentials=False`, `allow_headers=["*"]` in
`api/main.py`), so no server change is needed, and uploads keep working
cross-origin because the client sends no cookies.

Do **not** try to host the API on Vercel for this app: the persistence layer is a
mutable file (`api/store.py` `DATA_PATH`), which serverless cannot give you. That is
the whole reason §8 has a Render half.

