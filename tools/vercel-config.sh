#!/usr/bin/env bash
# Generate frontend/vercel.json for the "Vercel hosts the UI, Render hosts the API"
# topology, so the UI and the API share ONE origin in the browser and the bundle
# needs no API base at all.
#
#   RENDER_URL=https://<your-service>.onrender.com bash tools/vercel-config.sh
#   git add frontend/vercel.json && git commit -m "chore: proxy /api to Render"
#   npx vercel deploy --prod --cwd frontend --token "$VERCEL_API_TOKEN"
#
# Without RENDER_URL it writes the same-origin variant (no /api rewrite), which is
# what the sandbox preview and the single-image Docker deploy need — so running this
# script with no arguments returns the file to its committed state.
set -euo pipefail

OUT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/frontend/vercel.json}"
API_ORIGIN="${RENDER_URL:-}"

if [ -n "$API_ORIGIN" ]; then
  # Accept "https://host", "https://host/" or "https://host/anything" and reduce it
  # to the origin. Reject anything that is not https with a dotted host: a typo here
  # silently turns every data call into a 404 served by Vercel's own router.
  case "$API_ORIGIN" in
    https://*) : ;;
    *) echo "RENDER_URL must start with https:// (got: '$API_ORIGIN')" >&2; exit 1 ;;
  esac
  host="${API_ORIGIN#https://}"
  host="${host%%/*}"
  case "$host" in
    *.*) : ;;
    *) echo "RENDER_URL has no dotted hostname (got: '$API_ORIGIN')" >&2; exit 1 ;;
  esac
  API_ORIGIN="https://$host"
  REWRITE_JSON="    { \"source\": \"/api/:path*\", \"destination\": \"$API_ORIGIN/api/:path*\" },
"
else
  REWRITE_JSON=""
fi

TMP="$(mktemp)"
cat > "$TMP" <<JSON
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm ci",
  "skewProtection": "max",
  "rewrites": [
$REWRITE_JSON    { "source": "/(.*)", "destination": "/index.html" }
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
JSON

# Order matters: Vercel evaluates rewrites top-down, so the /api rule must precede
# the SPA fallback, or every data call is answered with index.html and the UI shows
# its "Backend not reachable" screen on a 200 response full of HTML.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$TMP" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
srcs = [r["source"] for r in cfg["rewrites"]]
assert srcs[0] == "/api/:path*" or srcs[0] == "/(.*)", srcs
if "/api/:path*" in srcs:
    assert srcs.index("/api/:path*") < srcs.index("/(.*)"), "/api rewrite must come first"
    dest = cfg["rewrites"][0]["destination"]
    assert dest.endswith("/api/:path*") and "://" in dest, dest
    print(f"rewrite order ok: {srcs[0]} -> {dest}")
else:
    print("same-origin variant (no /api rewrite) — client uses relative /api")
print("rewrites:", srcs)
PY
fi

mkdir -p "$(dirname "$OUT")"
mv "$TMP" "$OUT"
echo "wrote $OUT"
