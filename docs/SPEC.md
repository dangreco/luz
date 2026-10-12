# Luz — parametric table-lamp generator (refined spec)

Reference: Tela table lamp (printables.com/model/745457) — a ribbed, fast-print shade on a simple base,
using an off-the-shelf cord set + socket. Luz generalises it: every dimension, shape and surface treatment
is a parameter, the design is checked against North-American lamp-construction rules, and every printed part
exports as STL (zip) or one multi-object 3MF — all client-side in the browser.

## Refined prompt

Build a static, browser-only (Vite + React + TypeScript) parametric table-lamp generator for FDM printing.

1. **Electrical hardware is bought, never printed.** Support only North-American Edison sockets sold in
   Canada: **E26 (medium)** and **E12 (candelabra)**, in cUL/CSA-listed cord sets or keyless sockets mounted
   on a **1/8 IPS** threaded nipple (0.405 in / 10.29 mm OD, 27 TPI), on a threaded skirt + shade ring, or
   **snap-in porcelain/phenolic sockets** held by two spring-clip wings in a round hole in the cup plate.
   Socket body, threaded-skirt, shade-ring and snap-in dimensions are editable presets because vendors
   differ — the user measures their socket.
2. **Parts** (each exported separately): base, stem, socket cup, shade, and an optional separate fitter
   (hub + spokes) for vase-mode shades. Shade mounting modes: integrated spider, separate fitter,
   or seated in a base groove. Legged (tripod) bases either print their legs, or carry angled sockets
   for bought wooden dowels / metal rods (measured diameter + diametral clearance, insertion depth,
   sleeve wall); the tool reports the dowel cut length and mitre angle and adds the rod weight to the
   stability check.
   Optional bought-part fittings: a **split wiring base** — a floor-down tray carrying sleeves for two 2-conductor
   WAGO splice connectors (levers up) under a top-face-down deck, joined with the socket cup by 4 screws from
   below — and a **screw-down cord clamp** (printed bar + two screws) on the tray floor or across the base cord
   channel.
   Optional **diffuser liner**: a translucent inner wall standing on the hub or base top inside the shade
   with an air gap, printed in translucent or white filament.
3. **Shapes**: base, stem, cup and shade cross-sections can be circle, regular polygon (3+ sides, so
   triangle/square/hex…) with corner rounding, or superellipse; with aspect ratio and rotation. The shade's
   top and bottom sections can differ and are morphed along the height.
4. **Shade**: height, top/bottom size, profile curve (editable spline + bulge), twist with easing, wall
   thickness, rim beads; surface style: smooth (vase-mode friendly), ribs/fins/pleats (count, depth,
   waveform, twist, corrugated vs solid fins), perforated (circles, hexes, slots, diamonds, Voronoi lattice,
   fine hex-packed mesh for a HomePod-style diffuse wall),
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

### Snap-in sockets

| Item | E26 porcelain | E12 phenolic | Source |
|---|---|---|---|
| Mounting hole | 1-17/32 in (38.9 mm) | 1 in (25.4 mm) | B&P 48107i; Paxton 2440 |
| Face / wing reach | 1-3/4 in (44.5 mm) | — (≈ 28 mm assumed) | B&P 48107i |
| Body behind panel | ≈ 1.68 in (42.7 mm) | ≈ 32 mm (assumed) | Etlin-Daniels IS212 |
| Panel the clips grip | 0.032–0.093 in (0.8–2.4 mm) | same (assumed) | Etlin-Daniels IS212 |
| Rating | 660 W / 250 V | 75 W / 125 V | B&P, Paxton |

The cup plate (plus the spider/fitter hub, which sits under the face) is the panel: the layout fails if its
thickness is outside the grip range. The cavity clears the body and the spread wings. **Wing slots**: four
full-height ribs (two rib pairs, `wingWidth` + 2·`wingTolerance` apart, default 8 + 0.8 mm) flank the spring
wings at world ±X and run from the cup top through the plate and down the cavity wall to the top of the straight
bore (45° lead-in on the upper 0.8 mm), so each wing rides in a slot and the socket can neither spin when a bulb
is screwed in nor tilt. The ribs intrude `(hole − body)/2 − 0.6` mm (0.4–1.6) past the hole wall.

### Splice connectors (WAGO, UL 486C)

| Model | W × H × D (mm) | Conductors | T-rating | Source |
|---|---|---|---|---|
| 221-412 lever-nut | 13.2 × 8.4 × 18.8 | solid, stranded, fine-stranded 24–12 AWG | T85 | WAGO data sheet 221-412 |
| 2273-202 push-wire | 10 × 5.8 × 16.7 | **solid** 18–14 AWG only | T60 | WAGO data sheet 2273-202 |

Cord-set and socket leads are stranded, so 221-412 is the default and the tool warns on 2273-202. Strip
11 mm.

**Split base** (tray + deck, replacing a solid base with an underside bay, which would need supports): the base is
printed as a bottom **tray** (3 mm floor, outer wall, connector sleeves and four screw pillars; prints floor-down)
and a top **deck** (≥ 4 mm slab carrying the shade lip/groove and the cup hole; prints top-face-down). There is no
separate cover part — the tray floor is the lamp's bottom (felt-pad recesses are on the tray rim). Two **slide-in
sleeves** stand on the floor either side of the cord line — U-channels with side walls, an end stop at the
lamp-centre end and two 0.5 mm crush ribs (grip = sleeve clearance − 0.25 mm per side) — open at the outer end
and open upward, so the levers are exposed with the deck off. Sleeves are spaced to clear the cup's enlarged
spigot by ≥ 1 mm. **Four M3 screws** (heat-set inserts in the cup spigot end face, or self-tapping pilots) are driven
from below through the floor and pillars and clamp tray, deck and socket cup into one stack. Assembly: wire the
connectors on the tray, feed the cord through the oval exit (hugging the deck underside) and the centre bore,
lower the cup + deck, drive the screws. Service: remove the 4 screws and lift the deck + cup off. With the cord
clamp enabled the bar lies on the tray floor pressing the cord down, screwed into floor pedestals. Needs a solid,
stem-less base with a spigot cup joint (the cup seats directly on the deck); no weight pocket. Layout issues
report a base too low (≥ connector height + tray floor + deck), a spigot too short for the screws, or a base too
small.

### Cord strain relief

A pull on the supply cord must never reach splices or terminal screws (UL 153 / CSA C22.2 No. 12 strain
relief; OSHA 29 CFR 1926.405(g)(2)(iv)). Option: a printed bar in a flush recess across the base cord
channel, ridges squeezing the jacket ≈ 0.8 mm, two self-tapping screws in Ø0.8·d pilots ≥ 2.5·d deep.
An Underwriters knot inside the socket is recommended either way.

### Diffuser liner

A translucent **inner wall** (liner), not a lid: a constant-radius open tube that stands on the spider/fitter
hub (two 2 mm locating rails on the hub top face; the hub grows to fit them) or in a groove in the base top
(base/lip mounts, placed before the shade is lowered over it), with a 3 mm foot stepped in by half a wall that
drops between the rails. Its outer radius is the narrowest shade inner wall between its seat and the rim minus
the air gap (default 5 mm), so it never wedges; height defaults to shade top − 10 mm. Print 0.8–1.6 mm,
1–2 perimeters, no infill, foot on the bed. Spider/fitter mounts need the open shade top (the liner drops in
from above).

UL 153: the liner **does not close any opening** — the designation is unchanged and the openings stay open.
Spacing is measured to the liner wall as well (the centerline clearance takes the nearest of liner, shade wall,
cap and hub plane), and the heat screening checks the liner foot — the part nearest the bulb — against its own
material's HDT.

### Light-ray overlay

Viewer toggle "Light rays": 96 golden-spiral rays from the bulb's luminous centroid, marched in 2 mm steps (last
step bisected) against the shade's nominal inner wall, the top cap (closed/vented tops), the base top and the
table, with a point at each landing. Rays that leave through an open top end at 800 mm. The liner and hub do
not stop rays. Use it to judge vertical bulb placement: even lighting ≈ landings spread evenly over the wall.

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
