# Luz — parametric table-lamp generator

> [!WARNING]
> **This repo is 100% certified AI slop.** Every line of code, every test, every doc and every
> safety check was written by an AI model. Nobody has reviewed it with any rigour. Treat its UL 153
> numbers, its stability maths and its geometry with suspicion, and **never** rely on it for anything
> that touches mains electricity.

Browser-only tool for designing 3D-printable table lamps around an off-the-shelf
cUL/CSA-listed E26 or E12 cord set. Every dimension, shape and surface treatment is a
parameter; the design is checked live against UL 153 / CSA C22.2 No. 12 lamp-to-shade
rules, and every printed part exports as STL (zip) or a single 3MF.

**Randomize** (header) generates a new form — base, stem, cup, shade, legs, surface — for the
socket, bulb and materials you have set. Each candidate is built in a worker and must pass every
safety check (warnings allowed, failures never); the shade is enlarged and the support widened as
needed until it does.

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

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, tests and build on every
push and pull request.

## Safety

The checks are engineering guidance, not a certification. Never print electrical
parts; use a listed cord set and socket, and an LED bulb under a printed shade.
