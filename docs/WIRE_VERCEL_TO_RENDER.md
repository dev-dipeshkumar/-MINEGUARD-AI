# Connect the Vercel site to the Render API (beginner path)

You have two working pieces that don't know about each other:

```
your browser
   └─ https://mineguardai.vercel.app   ← Vercel: serves the UI only
         /                → the React app          ✅ 200
         /api/bootstrap   → nothing lives here     ❌ "The page could not be found"
                                                   → app shows "Backend not reachable"
   └─ https://<yourservice>.onrender.com   ← Render: the FastAPI app, working fine
         /api/bootstrap   → real data              ✅
```

Fix = tell Vercel: *"every request that starts with `/api` — send it to my Render
service and hand the answer back."* Your UI code never changes, and the browser
still talks to one origin, so there is no CORS to configure.

---

## Step 0 — 60 seconds, makes the rest easier

1. Open the **Render dashboard** → click your service.
2. On the service's **Settings → Info** page find **Public URL**, e.g.
   `https://mineguard-ai.onrender.com`. Copy it.
3. Open a **new browser tab**, paste `<your Public URL>/api/health` and press Enter.

Read what comes back, because everything downstream depends on it:

| You see in that tab | Meaning | What to do |
| --- | --- | --- |
| `{"status":"ok","engine":{...}}` | The API is alive ✅ | Go to Step 1 |
| a page that says it is **starting / spinning up** | Free plan was idle for 15 min | Wait ~1 min, reload until you see the JSON, then Step 1 |
| **`This service has been suspended.`** | Render stopped the service (free hours/bandwidth used up, or the traffic threshold) | Dashboard → **Billing**. On the Free plan Render restores it by moving the service to a paid compute plan — wiring Vercel cannot fix this one |
| `404` from Render itself | The service is up but that path doesn't exist → you copied a different app's URL | Get the URL from Settings → Info again |

Do **not** continue while `/api/health` fails — you'd only be pointing Vercel at
something broken, and the UI would keep showing the same screen.

## Step 1 — create one file on GitHub

1. Go to `https://github.com/dev-dipeshkumar/-MINEGUARD-AI`
2. Click **Add file → Create new file**
3. In the filename box type exactly this (the folder part matters):

   ```
   frontend/vercel.json
   ```

4. Paste everything below, and **replace `RENDER_SERVICE_URL_HERE`** with the part of
   your Render URL *after* `https://` — nothing else. For
   `https://mineguard-ai.onrender.com` you would write `mineguard-ai.onrender.com`.
   Do not add `https://`, a `/`, or `/api` in that spot.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm ci",
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://RENDER_SERVICE_URL_HERE/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/index.html",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    }
  ]
}
```

Why each part is there — so you can trust it instead of hoping:

| Line | What it does for you |
| --- | --- |
| `/api/:path*` rule | The actual wiring. `:path*` keeps the rest of the path, so `/api/dashboard` → `https://your-service.onrender.com/api/dashboard` |
| `/(.*)` → `/index.html` | Fixes the second bug you have: `mineguardai.vercel.app/command-centre` currently 404s, so a judge can't open any link except the home page |
| **The order of those two** | Vercel tries rewrites top-down. Swap them and the first rule catches everything: your API calls get answered with HTML, the app can't parse it, and you're back at "Backend not reachable" |
| `framework` / `outputDirectory` / `npm ci` | Keeps your existing build working exactly as it does today (`frontend/` is your project's Root Directory — a repo-root build would have failed, since there is no `package.json` at the root) |
| the `headers` block | Only about speed: hashed files in `/assets` cache for a year, `index.html` never caches, so a new deploy shows up on first reload |

5. Scroll down → **Commit changes** → green **Commit changes** (stay on the default
   "Commit directly to the main branch").

## Step 2 — make Vercel build it again

If your Vercel project is connected to GitHub (the normal case), pushing to `main`
starts a deployment by itself:

1. `https://vercel.com/<your-team>/mineguardai` → **Deployments** → you should see a
   new one building.
2. Wait for **Ready** (about 1–2 minutes).

If nothing started, your project was created by the CLI/upload instead. Then
deploy from a terminal on your own computer, inside the `mineguard/frontend` folder:

```bash
npm install -g vercel      # once, if you don't have it
vercel --prod
```

## Step 3 — prove the wiring, in the browser

1. Reload `https://mineguardai.vercel.app` — the dashboard renders with real numbers
   (4 mines, compliance score, risk band) instead of the red panel.
2. Click a sidebar item that is not the home page (e.g. **Reports**) and hit **F5**.
   Still loads → the deep-link fix works.
3. Optional, terminal-free check: open
   `https://mineguardai.vercel.app/api/health` — you should now see the same JSON you
   saw in Step 0, but served from the **Vercel** domain. That single line is the proof.

## Step 4 — what "fine" will feel like in a demo room

Because Render's Free plan sleeps, expect this exact pattern:

* First visit after ≥15 idle minutes: the page sits on nothing for up to ~60 s, then
  may show the error once. **Refresh.** It renders in a fraction of a second after that.
* If Vercel gives a 503/timeout on that first call, it gave up while Render was still
  waking. Reload — the second request wins.
* Habit that removes 90 % of demo anxiety: leave a tab open on
  `https://<your-render-url>/api/health` and hit F5 once a minute or so while you set
  up. Keep Render warm, then start presenting.
* Anything you click (assign an action, reset the demo, upload a file) is stored in a
  file on Render's disk, which Render **wipes on restart/redeploy/spin-down**. The app
  then reseeds to the exact baseline the deck quotes. That is by design here — it means
  a judge poking at your app can't leave it in a broken state — but do not promise a
  "your data is saved" story about it.
* A keep-alive pinger every 5 minutes would keep it awake 24/7 — and 24/7 is ~744
  hours a month against Render's **750 free instance-hours per workspace**, so it
  works until it doesn't. Warm it by hand instead, or move to a $7/mo starter
  instance if you want a URL that never sleeps.
* Uploads over **4.5 MB** can be rejected by Vercel's edge before reaching Render,
  even though the app allows 12 MB. If a big PDF fails through the Vercel URL, open
  the Render URL for that one upload — the app itself is fine at `https://<your-render-url>/`.

## If it still shows "Backend not reachable"

Open DevTools (**F12**) → **Network** → reload → click the first `bootstrap` row.

| Status of `/api/bootstrap` | Cause | Fix |
| --- | --- | --- |
| `404` with body `The page could not be found` / `NOT_FOUND` | Vercel never picked up the file — wrong folder name (`vercel.json` at repo root instead of `frontend/`), or no new deployment actually ran | Check Vercel → Settings → **General → Root Directory** is `frontend`; re-check the file path on GitHub; redeploy |
| `502` / `503` | Render not answering (cold, or suspended) | Step 0 again |
| `200` but the UI still errors | Destination typo (e.g. `https://https://…` or a trailing `/api`) | Re-read the file on GitHub; only the bare hostname goes in that spot |
| `404` with FastAPI-style JSON `{"detail":"Not Found"}` | Wiring works! The path is wrong on the Render side | Tell me — that would mean your Render service is not this app |

One thing you can do that fixes 80 % of these: paste your Render URL in chat. I'll
probe it from here, hand you the finished file contents to paste, and tell you which
row of this table you're in.
