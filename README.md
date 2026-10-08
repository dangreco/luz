# Luz — parametric table-lamp generator

Browser-only tool for designing 3D-printable table lamps around an off-the-shelf
cUL/CSA-listed E26 or E12 cord set. Every dimension, shape and surface treatment is a
parameter; the design is checked live against UL 153 / CSA C22.2 No. 12 lamp-to-shade
rules, and every printed part exports as STL (zip) or a single 3MF.

Stack: Vite + React + TypeScript, [manifold-3d](https://github.com/elalish/manifold)
(WASM) for solid modelling in a Web Worker, three.js for the preview. No backend.

See [`docs/SPEC.md`](docs/SPEC.md) for requirements and research sources.

## Develop

Requires Node ≥ 22.12.

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build      # static site in dist/
```

## Deploy (Vercel via GitHub)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repository. Settings come from
   `vercel.json` (framework Vite, `npm ci`, `npm run build`, output `dist`) and the
   Node version from `package.json` `engines`.
3. Every push to `main` deploys to production; pull requests get preview deployments.

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests and build on every
push and pull request.

## Safety

The checks are engineering guidance, not a certification. Never print electrical
parts; use a listed cord set and socket, and an LED bulb under a printed shade.
