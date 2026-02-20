# FluxAPI — Publish & Deploy Guide

Everything you need to go from this folder to a live product.

---

## Prerequisites

```bash
# You need these installed
node --version    # >= 18
npm --version     # >= 9
git --version     # any
```

---

## Step 1: Extract & Verify (2 min)

```bash
# Extract the tarball
tar xzf fluxapi-complete.tar.gz
cd fluxapi

# Install dependencies
cd packages/scan
npm install

# Verify everything works
npm test          # Should show: 127 passed
npm run lint      # Should show: 0 errors
npm run build     # Should produce dist/ folder

# Go back to root
cd ../..
```

---

## Step 2: Create GitHub Repo (5 min)

```bash
# Initialize git
git init
git add .
git commit -m "feat: FluxAPI v0.1.0 — Lighthouse for API calls"

# Create repo on GitHub: https://github.com/new
# Name it: fluxapi
# Make it PUBLIC
# Don't add README/license (we already have them)

# Then push:
git remote add origin https://github.com/aswinsasi/fluxapi
git branch -M main
git push -u origin main
```

**After pushing:** Go to the repo → Settings → check "Discussions" and "Issues" are enabled.

---

## Step 3: Publish @fluxiapi/scan to npm (5 min)

```bash
# Login to npm (one-time)
npm login
# Enter your npm username, password, email, and OTP if 2FA is enabled

# Publish the core library
cd packages/scan
npm publish --access public
```

**Verify:** Go to https://www.npmjs.com/package/@fluxiapi/scan — it should appear within 1-2 minutes.

**Test it works:**
```bash
mkdir /tmp/test-fluxapi && cd /tmp/test-fluxapi
npm init -y
npm install @fluxiapi/scan
node -e "const f = require('@fluxiapi/scan'); console.log('✅ FluxAnalyzer:', typeof f.FluxAnalyzer)"
```

---

## Step 4: Publish @fluxiapi/cli to npm (5 min)

```bash
cd packages/cli

# Install dependencies (needs the published @fluxiapi/scan)
npm install

# Build
npm run build

# Publish
npm publish --access public
```

**Test it works:**
```bash
npx @fluxiapi/cli --help
# or
npx flux-scan --help
```

> **Note:** `npx flux-scan` will work because the `bin` field in package.json maps `flux-scan` → `dist/cli.mjs`.

---

## Step 5: Deploy Landing Page (3 min)

### Option A: Vercel (recommended — free)

1. Go to https://vercel.com/new
2. Click "Import Git Repository"
3. Select your `fluxapi` repo
4. **Framework Preset:** Other
5. **Root Directory:** `packages/landing`
6. **Build Command:** (leave empty)
7. **Output Directory:** `.`
8. Click Deploy

Your landing page will be live at `fluxapi.vercel.app` (or custom domain).

### Option B: Netlify (also free)

1. Go to https://app.netlify.com/drop
2. Drag the `packages/landing/` folder into the browser
3. Done — you get a URL instantly

### Option C: GitHub Pages

```bash
# From repo root
git subtree push --prefix packages/landing origin gh-pages
```
Then go to repo → Settings → Pages → Source: `gh-pages` branch.

### Custom Domain (optional)

If you own `fluxapi.dev`:
1. In Vercel/Netlify, add `fluxapi.dev` as custom domain
2. In your DNS provider, add:
   - `A` record → Vercel's IP (76.76.21.21)
   - OR `CNAME` record → `cname.vercel-dns.com`

---

## Step 6: GitHub Action Setup (5 min)

Create a **separate repo** for the action (GitHub requires it):

```bash
mkdir @fluxiapi/scan-action && cd @fluxiapi/scan-action
git init

# Copy the action file
cp /path/to/fluxapi/packages/github-action/action.yml .

# Create a minimal README
cat > README.md << 'EOF'
# FluxAPI Scan Action

Lighthouse for your API calls. Scans your web app and fails CI if API health score drops below threshold.

## Usage

```yaml
- uses: aswinsasi/@fluxiapi/scan-action@v1
  with:
    url: https://staging.your-app.com
    threshold: 70
    network: jio-4g
```

See [FluxAPI](https://github.com/aswinsasi/fluxapi) for full docs.
EOF

git add .
git commit -m "feat: FluxAPI scan GitHub Action v1"
```

Push to GitHub as `aswinsasi/@fluxiapi/scan-action`, then tag it:

```bash
git remote add origin https://github.com/aswinsasi/@fluxiapi/scan-action.git
git push -u origin main
git tag -a v1 -m "v1.0.0"
git push origin v1
```

Now anyone can use: `uses: aswinsasi/@fluxiapi/scan-action@v1`

---

## Step 7: Chrome Extension (later — after traction)

For now, the extension works as "Load Unpacked" for development. To publish on Chrome Web Store:

1. Create a developer account: https://chrome.google.com/webstore/devconsole ($5 one-time fee)
2. Zip the extension:
   ```bash
   cd packages/extension
   zip -r fluxapi-extension.zip . -x "*.DS_Store"
   ```
3. Upload at https://chrome.google.com/webstore/devconsole
4. Fill in listing details, screenshots, description
5. Submit for review (takes 1-3 days)

**Skip this for now** — focus on npm + landing page first.

---

## Step 8: Announce (30 min)

### Twitter/X Post

```
⚡ I built FluxAPI — Lighthouse for your API calls

One command scans your React app and finds:
→ Request waterfalls
→ Duplicate fetches across components
→ N+1 query patterns
→ Missing cache headers

Generates copy-pasteable TanStack Query fixes.

npx flux-scan https://your-app.com

https://fluxapi.dev
```

Attach a screenshot of the HTML report (the sample report file).

### Reddit

Post to r/reactjs, r/webdev, r/javascript:
- Title: "I built an open-source Lighthouse for API calls — finds waterfalls, duplicate fetches, N+1 patterns in your React app"
- Include: problem → solution → demo → GitHub link

### LinkedIn

Same content as Twitter but longer form. Mention the India network scoring angle (Jio 4G vs WiFi).

### Hacker News

- Title: "Show HN: FluxAPI – Lighthouse for API calls"
- Link: GitHub repo
- Post a comment explaining the motivation

---

## Quick Reference: Important URLs

After setup, these will be your links:

| What | URL |
|------|-----|
| GitHub Repo | https://github.com/aswinsasi/fluxapi |
| npm: @fluxiapi/scan | https://www.npmjs.com/package/@fluxiapi/scan |
| npm: @fluxiapi/cli | https://www.npmjs.com/package/@fluxiapi/cli |
| Landing Page | https://fluxapi.vercel.app (or fluxapi.dev) |
| GitHub Action | https://github.com/aswinsasi/@fluxiapi/scan-action |

---

## Checklist

- [ ] Extract & verify (npm test passes)
- [ ] Push to GitHub
- [ ] Publish @fluxiapi/scan to npm
- [ ] Publish @fluxiapi/cli to npm
- [ ] Test `npx flux-scan --help` works
- [ ] Deploy landing page
- [ ] Create GitHub Action repo + tag v1
- [ ] Tweet / post announcement
- [ ] Test on a real app and screenshot the report
- [ ] (Later) Chrome Web Store
- [ ] (Later) Custom domain fluxapi.dev

---

## Troubleshooting

**"npm publish" fails with 403**
→ You need to be logged in: `npm login`
→ Scoped packages need `--access public` flag

**"npx flux-scan" doesn't find the command**
→ Make sure @fluxiapi/cli is published, and the `bin` field is correct
→ Try: `npx @fluxiapi/cli --help`

**Landing page links don't work**
→ Update GitHub URLs in `packages/landing/index.html` to match your actual repo name

**Tests fail after extracting**
→ Make sure you ran `npm install` in `packages/scan/`
→ Check Node version: `node --version` (needs >= 18)

**Build fails with type errors**
→ Run `npx tsc --noEmit` in `packages/scan/` to see specific errors
→ Should show 0 errors on a clean extract
