# Preview deployment

GitHub Pages serves n02 straight from the repo root of `main`, so a branch cannot be previewed
through Pages without touching production. Branch previews therefore come from a second, external
static host, wired to this repository by its Git integration.

## Contract

- **Production is untouched.** `npm run build` is the only script that runs
  `scripts/deploy-to-root.mjs`, i.e. the only one that rewrites the tracked root artifacts
  (`index.html`, `assets/`, `sw.js`, `workbox-*.js`, `manifest.webmanifest`, `registerSW.js`)
  that GitHub Pages publishes.
- **Preview never writes those files.** `npm run build:preview` runs the identical
  `tsc -b && vite build` and stops there, leaving the output in `web/dist/` — which is
  git-ignored. A preview build can never produce a diff.
- Both scripts compile the same sources with the same Vite config, so a preview is a faithful
  rendering of the commit it was built from.

## Service worker / cache isolation

`vite.config.ts` registers the PWA with `scope: './'` and `start_url: './'`, both relative. A
preview is served from its own origin (`*.vercel.app`), so its service worker registers under that
origin only. It shares no registration, no cache storage and no `localStorage` with
`chihirohashimotoac-coder.github.io`, and cannot serve stale assets to production or vice versa.
`cleanupOutdatedCaches` and `skipWaiting` keep each origin on its own newest build.

## Vercel setup (one-time, by the repository owner)

The build itself needs no secrets, so nothing is stored in the repository. Only the Git connection
has to be authorised, in the Vercel dashboard:

1. Sign in at <https://vercel.com/> with the GitHub account that owns this repository.
2. **Add New… → Project → Import** `chihirohashimotoac-coder/n02`.
3. Leave every build setting at its default — `vercel.json` in the repo root already pins
   framework `null`, install `npm ci`, build `npm run build:preview` and output `web/dist`.
4. Deploy. Vercel then builds every branch and every pull request automatically.

After that each pushed commit gets a deployment URL, and each branch keeps a stable alias that
always points at that branch's newest successful build.

`"github": { "silent": true }` keeps Vercel from commenting on pull requests; the deployment
URLs are still listed on the PR's checks and in the Vercel dashboard.
