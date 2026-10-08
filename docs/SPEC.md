# Luz — parametric table-lamp generator (refined spec)

Reference: Tela table lamp (printables.com/model/745457) — a ribbed, fast-print shade on a simple base,
using an off-the-shelf cord set + socket. Luz generalises it: every dimension, shape and surface treatment
is a parameter, the design is checked against North-American lamp-construction rules, and every printed part
exports as STL (zip) or one multi-object 3MF — all client-side in the browser.

## Refined prompt

Build a static, browser-only (Vite + React + TypeScript) parametric table-lamp generator for FDM printing.

1. **Electrical hardware is bought, never printed.** Support only North-American Edison sockets sold in
   Canada: **E26 (medium)** and **E12 (candelabra)**, in cUL/CSA-listed cord sets or keyless sockets mounted
   on a **1/8 IPS** threaded nipple (0.405 in / 10.29 mm OD, 27 TPI). Socket body, threaded-skirt and
   shade-ring dimensions are editable presets because vendors differ — the user measures their socket.
2. **Parts** (each exported separately): base, stem, socket cup, shade, and an optional separate fitter
   (hub + spokes) for vase-mode shades. Shade mounting modes: integrated spider, separate fitter,
   or seated in a base groove. Legged (tripod) bases either print their legs, or carry angled sockets
   for bought wooden dowels / metal rods (measured diameter + diametral clearance, insertion depth,
   sleeve wall); the tool reports the dowel cut length and mitre angle and adds the rod weight to the
   stability check.
3. **Shapes**: base, stem, cup and shade cross-sections can be circle, regular polygon (3+ sides, so
   triangle/square/hex…) with corner rounding, or superellipse; with aspect ratio and rotation. The shade's
   top and bottom sections can differ and are morphed along the height.
4. **Shade**: height, top/bottom size, profile curve (editable spline + bulge), twist with easing, wall
   thickness, rim beads; surface style: smooth (vase-mode friendly), ribs/fins/pleats (count, depth,
   waveform, twist, corrugated vs solid fins), perforated (circles, hexes, slots, diamonds, Voronoi lattice),
   woven texture (surface relief) and true woven basket (interlaced helical strands, over/under).
5. **Bulb–shade distance** is a first-class parameter: either set absolute shade size, or auto-size the
   shade so the closest point of its inner wall is a chosen distance from the bulb envelope.
6. **Safety checks** (live, explained, with sources) — see below. The tool never claims certification.
7. **Export**: binary STL per part in a zip, one 3MF with all parts (mm units), vase-mode solid export of
   the shade; parameter presets as JSON files and a shareable compressed URL.

## Research findings

### Sockets / hardware (Canada)

| Item | E26 (medium) | E12 (candelabra) | Source |
|---|---|---|---|
| Thread major dia (bulb) | 26 mm | 12 mm | ANSI C81.61/63 naming |
| Typical keyless socket body | Ø 1-9/16 in (39.7 mm) × 2-3/8 in (60 mm); 1/8 IPS cap | Ø 3/4 in (19 mm) × 1-5/8 in (41 mm); 1/8 IPS | Grand Brass SOE26TP81W, SO10038 |
| Shade ring | 57 mm OD ring on threaded skirt; aftermarket rings 34–39 mm ID | ring on threaded skirt | Grand Brass; vendor listings |
| Socket rating | 660 W / 250 V (phenolic); thermoplastic 75 W / 125 V, 150 °C | 75 W / 125 V | Nostalgicbulbs BD30-40, Grand Brass |
| Mount | 1/8 IPS nipple (10.29 mm OD) + hex nut | same | industry standard |

Thread diameters and ring sizes vary by vendor → **all socket dimensions are editable**, defaults above.

### Lamp-to-shade spacing — UL 153 / CSA C22.2 No. 12 (bi-national "Portable Luminaires")

UL 153 §47 lets a portable luminaire skip the temperature test if the shade meets fixed spacings, in which
case (§16.2) *the shade may be of any material*. The tool implements those tables:

* **Designation** (§47.3, Table 47.1): an opening is "open" if its area ≥ (25 W: 45 cm², 75 W: 65, 100 W: 84,
  150 W: 103, 200 W: 129, 250 W: 155, 300 W: 187). Obstructions (spokes, hubs) are deducted; lampholder,
  ≤1/2 in nipple and simple harp are not obstructions. Closed/closed shades: max 7 W, 1 in spacing.
* **Spacing** (§47.4): minimum distance from any point of the lamp centerline (axis starting at the socket's
  centre contact, length per table) to the shade.
  * Open/open (Table 47.2), Medium: 25 W → 41.2 mm over 69.8 mm; 40 W → 50.8; 60 W → 63.5; 75 W → 73;
    100 W → 88.9; 150 W → 120.6 (82.5 mm centerline) … Candelabra 25 W → 41.2, 40 W → 50.8, 60 W → 63.5
    (50.8 mm centerline).
  * Open-top/closed-bottom (Table 47.3) and closed-top/open-bottom (Table 47.4, spacing traded against
    shade height above the lamp) also implemented.
* **Stability** (§132): the complete lamp must not tip on an 8° incline.
* **Shade dimensional stability** (§16.3): the shade must keep its dimensions — relevant for heat creep.

### Printable materials (heat deflection temperature, ISO 75 @ 0.45 MPa, Prusament TDS)

| Material | HDT °C | Density g/cm³ |
|---|---|---|
| PLA | 55 | 1.24 |
| PETG | 68 | 1.27 |
| ASA | 93 | 1.07 |
| ABS | ≈ 88 (typical) | 1.04 |
| PC Blend | 113 | 1.22 |

Service limit = HDT − safety margin (default 10 °C, editable).

### Bulb heat (configurable profiles)

Heat fraction and radiant fraction per technology (LED ≈ 70 % heat, mostly conducted to the heat sink and
convected; incandescent ≈ 95 %+ heat, mostly infrared). The tool estimates shade-wall temperature with a
documented engineering model: point-source radiation (`q = P·f_rad / 4πd²`, ΔT = q / h) plus a Heskestad
plume term above the bulb. It is **an estimate for choosing materials**, not a substitute for testing.

### Library choice: `manifold-3d` (WASM) + three.js

* Manifold: guaranteed-manifold mesh booleans, fast enough for interactive CSG with hundreds of
  perforations, `warp` for conforming patterns to curved walls, `ofMesh` for custom lofts/sweeps,
  volume/bbox for stability, ~1 MB WASM. Apache-2.0.
* Rejected: Replicad/OpenCascade (true fillets, but ~10 MB and slow booleans on lattice patterns);
  JSCAD (slow CSG, weak robustness on dense patterns).
* three.js for preview, STL/3MF writers implemented locally (3MF = zip of XML via `fflate`).

## Non-goals

No electrical part is printed; no certification claim; no slicer integration.
