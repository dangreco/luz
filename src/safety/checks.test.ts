import { describe, expect, it } from 'vitest';
import type { LampBuild, PartId, PartMesh } from '../geometry/build';
import { massProps, toArrays } from '../geometry/mesh';
import type { Manifold } from '../geometry/wasm';
import { loadManifold } from '../geometry/wasm';
import { MATERIALS, SOCKET_PRESETS } from '../model/hardware';
import { computeLayout } from '../model/layout';
import { DEFAULT_PARAMS, type LampParams, type MaterialId } from '../model/params';
import { runChecks, type SafetyCheck } from './checks';

/**
 * Deterministic LampBuild fixture: layout from computeLayout, parts as simple manifold primitives at
 * the assembled positions. The safety checks only read layout + mass/centroid/bbox, so this is exact
 * for every check except part-mass realism (good enough: volumes track the real dimensions).
 */
async function fixtureBuild(p: LampParams): Promise<LampBuild> {
  const m = await loadManifold();
  const layout = computeLayout(p);
  const parts: PartMesh[] = [];
  const add = (id: PartId, label: string, solid: Manifold, material: MaterialId, printFlip: boolean) => {
    const mesh = toArrays(solid);
    const { volume, centroid } = massProps(mesh);
    const box = solid.boundingBox();
    parts.push({
      id,
      label,
      material,
      mesh,
      printFlip,
      volume,
      mass: (volume / 1000) * MATERIALS[material].density,
      centroid,
      bbox: {
        min: [box.min[0], box.min[1], box.min[2]],
        max: [box.max[0], box.max[1], box.max[2]],
      },
      notes: [],
    });
    solid.delete();
  };
  const seg = 96;
  const { axisX, axisY } = layout;
  add(
    'base',
    'Base',
    m.Manifold.cylinder(p.base.height, p.base.size / 2, (p.base.size / 2) * p.base.topScale, seg),
    p.materials.structure,
    false,
  );
  if (p.stem.height > 0) {
    add(
      'stem',
      'Stem',
      m.Manifold
        .cylinder(p.stem.height, p.stem.size / 2, (p.stem.size / 2) * p.stem.topScale, seg)
        .translate(axisX, axisY, layout.baseTop),
      p.materials.structure,
      false,
    );
  }
  add(
    'cup',
    'Socket cup',
    m.Manifold
      .cylinder(p.cup.height, p.cup.size / 2, (p.cup.size / 2) * p.cup.topScale, seg)
      .translate(axisX, axisY, layout.stemTop),
    p.materials.structure,
    true,
  );
  const shadeZ = layout.shadeBottom;
  const outer = m.Manifold
    .cylinder(p.shade.height, layout.shadeBottomSize / 2, layout.shadeTopSize / 2, seg)
    .translate(axisX, axisY, shadeZ);
  const inner = m.Manifold
    .cylinder(
      p.shade.height,
      Math.max(0.5, layout.shadeBottomSize / 2 - p.shade.wallThickness),
      Math.max(0.5, layout.shadeTopSize / 2 - p.shade.wallThickness),
      seg,
    )
    .translate(axisX, axisY, shadeZ);
  add('shade', 'Shade', outer.subtract(inner), p.materials.shade, false);
  return { layout, parts };
}

function byId(checks: SafetyCheck[], id: string): SafetyCheck {
  const c = checks.find((c) => c.id === id);
  if (!c) throw new Error(`check ${id} missing from ${checks.map((c) => c.id).join(', ')}`);
  return c;
}

/** Clone defaults so every test mutates its own copy. */
function lamp(): LampParams {
  return structuredClone(DEFAULT_PARAMS);
}

/** Shade params tuned so the bottom inner rim encloses ~areaCm2 (circle section, rim band included). */
function withBottomArea(p: LampParams, areaCm2: number, topSize: number): LampParams {
  const wallAtRim = p.shade.wallThickness + p.shade.rimThickening;
  const r = Math.sqrt((areaCm2 * 100) / Math.PI) + wallAtRim;
  p.shade.sizing = 'absolute';
  p.shade.bottomSize = 2 * r;
  p.shade.topSize = topSize;
  return p;
}

async function run(p: LampParams): Promise<SafetyCheck[]> {
  return runChecks(p, await fixtureBuild(p));
}

describe('socket / bulb', () => {
  it('passes for the default lamp', async () => {
    const checks = await run(lamp());
    expect(byId(checks, 'socket-bulb').status).toBe('pass');
  });

  it('fails when the bulb base does not match the socket', async () => {
    const p = lamp();
    p.hardware.socketBase = 'E12';
    p.hardware.socket = { ...SOCKET_PRESETS.E12 };
    const c = byId(await run(p), 'socket-bulb');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/A19 is an E26 bulb but the socket is E12/);
  });

  it('fails when watts exceed the socket rating or the marking', async () => {
    const overWatts = lamp();
    overWatts.bulb.watts = 100;
    expect(byId(await run(overWatts), 'socket-bulb').status).toBe('fail');

    const underMarked = lamp();
    underMarked.bulb.watts = 9;
    underMarked.bulb.markedWatts = 5;
    const c = byId(await run(underMarked), 'socket-bulb');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/marking must cover/);
  });
});

/** Open-bottom shade with a near-negligible obstruction: small spider hub on a 1/8 IPS nipple. */
function openBottom(p: LampParams): LampParams {
  p.hardware.socketMount = 'nipple';
  p.shade.mount = 'spider';
  p.shade.hubOuterDiameter = 16;
  p.shade.spokeWidth = 1;
  return p;
}

describe('shade designation (Table 47.1)', () => {
  const base = (): LampParams => {
    const p = openBottom(lamp());
    p.bulb.watts = 60;
    p.bulb.markedWatts = 75;
    p.shade.topClosure = 'open';
    return p;
  };

  it('75 W needs 65 cm² (×1.1 when obstructed): comfortably above is open/open', async () => {
    const p = withBottomArea(base(), 85, 200);
    const checks = await run(p);
    const c = byId(checks, 'shade-designation');
    expect(c.detail).toMatch(/1\.1 × 65 cm²/);
    expect(c.detail).toMatch(/Designation open\/open/);
    expect(c.status).toBe('pass');
    expect(byId(checks, 'shade-spacing').title).toMatch(/open\/open/);
  });

  it('a shade standing on the base (lip or groove) has a closed bottom → Table 47.3', async () => {
    for (const mount of ['lip', 'base'] as const) {
      const p = lamp();
      p.bulb.watts = 60;
      p.bulb.markedWatts = 60;
      p.shade.mount = mount;
      p.shade.sizing = 'absolute';
      p.shade.bottomSize = 140;
      p.shade.topSize = 140;
      p.base.size = 160;
      const checks = await run(p);
      expect(byId(checks, 'shade-designation').detail).toMatch(/stands on the base/);
      const spacing = byId(checks, 'shade-spacing');
      expect(spacing.title).toMatch(/open top \/ closed bottom/);
      expect(spacing.detail).toMatch(/76\.2 mm/); // Table 47.3, E26 60 W row
    }
  });

  it('just below the obstructed threshold flips the bottom to closed and applies Table 47.3', async () => {
    const p = withBottomArea(base(), 70, 200);
    const checks = await run(p);
    const c = byId(checks, 'shade-designation');
    expect(c.detail).toMatch(/Designation open\/closed/);
    expect(c.status).toBe('warn');
    const spacing = byId(checks, 'shade-spacing');
    expect(spacing.title).toMatch(/open top \/ closed bottom/);
    expect(spacing.detail).toMatch(/85\.7 mm/); // Table 47.3, E26 75 W row
  });

  it('spider hubs/spokes are obstructions: unobstructed area must reach 1.1× the table value', async () => {
    // rim ≈ 66 cm² ≥ 65, but the hub annulus + spokes obstruct → required is 71.5 cm²
    const p = withBottomArea(base(), 66.4, 200);
    const c = byId(await run(p), 'shade-designation');
    expect(c.detail).toMatch(/1\.1 × 65 cm²/);
    expect(c.detail).toMatch(/obstructions/);
    expect(c.detail).toMatch(/Designation open\/closed/);
  });

  it('closed/closed above 7 W fails', async () => {
    const p = withBottomArea(base(), 30, 200);
    p.shade.topClosure = 'closed';
    const checks = await run(p);
    const designation = byId(checks, 'shade-designation');
    expect(designation.status).toBe('fail');
    expect(designation.detail).toMatch(/Designation closed\/closed/);
    expect(designation.detail).toMatch(/7 W/);
    expect(byId(checks, 'shade-spacing').status).toBe('fail');
  });

  it('closed/closed at 7 W is judged against 25.4 mm from a 50.8 mm centerline', async () => {
    const p = withBottomArea(base(), 30, 200);
    p.shade.topClosure = 'closed';
    p.bulb.watts = 7;
    p.bulb.markedWatts = 7;
    const spacing = byId(await run(p), 'shade-spacing');
    expect(spacing.detail).toMatch(/25\.4 mm minimum from a 50\.8 mm centerline/);
  });
});

describe('lamp-to-shade spacing (§47.4)', () => {
  it('E26 60 W open/open looks up 63.5 mm from an 82.5 mm centerline', async () => {
    const p = openBottom(lamp());
    p.bulb.watts = 60;
    p.bulb.markedWatts = 60;
    p.shade.sizing = 'absolute';
    p.shade.bottomSize = 200;
    p.shade.topSize = 160;
    const checks = await run(p);
    const c = byId(checks, 'shade-spacing');
    expect(c.title).toMatch(/open\/open/);
    expect(c.detail).toMatch(/60 W row\): ≥ 63\.5 mm from any point of a 82\.5 mm centerline/);
    expect(byId(checks, 'bulb-clearance').status).toBe('info');
  });

  it('a wide lip-mounted shade passes as temperature-test-exempt construction', async () => {
    const p = lamp();
    p.bulb.watts = 9;
    p.bulb.markedWatts = 25;
    p.shade.mount = 'lip';
    p.shade.sizing = 'absolute';
    p.shade.bottomSize = 170;
    p.shade.topSize = 170;
    p.base.size = 180;
    const c = byId(await run(p), 'shade-spacing');
    expect(c.detail).toMatch(/Table 47\.3 \(E26, 25 W row\): ≥ 53\.9 mm/);
    expect(c.status).toBe('pass');
    expect(c.detail).toMatch(/temperature-test-exempt construction/);
  });

  it('fails with an explanation when the marking exceeds the table range', async () => {
    const p = lamp();
    p.hardware.socketBase = 'E12';
    p.hardware.socket = { ...SOCKET_PRESETS.E12 };
    p.bulb.shape = 'B11';
    p.bulb.watts = 60;
    p.bulb.markedWatts = 75;
    p.shade.mount = 'base';
    p.shade.sizing = 'absolute';
    p.shade.bottomSize = 140;
    p.shade.topSize = 140;
    const c = byId(await run(p), 'shade-spacing');
    expect(c.status).toBe('fail');
    expect(c.detail).toMatch(/exceeds the highest Table 47\.3 row for a E12 lampholder \(60 W\)/);
  });

  it('closed top / open bottom uses the Table 47.4 height/spacing trade', async () => {
    const p = openBottom(lamp());
    p.bulb.watts = 60;
    p.bulb.markedWatts = 60;
    p.shade.topClosure = 'closed';
    p.shade.sizing = 'absolute';
    p.shade.bottomSize = 240;
    p.shade.topSize = 200;
    const c = byId(await run(p), 'shade-spacing');
    expect(c.title).toMatch(/closed top \/ open bottom/);
    expect(c.detail).toMatch(/Table 47\.4/);
    expect(c.detail).toMatch(/h ≥ /);
  });

  it('reports the hub plane as shade surface for spider mounts', async () => {
    const p = lamp();
    p.bulb.watts = 25;
    p.bulb.markedWatts = 25;
    const c = byId(await run(p), 'shade-spacing');
    expect(c.detail).toMatch(/hub\/spoke plane counted as shade surface/);
  });
});

describe('thermal screening', () => {
  it('a 9 W LED in PETG passes and is labelled an estimate', async () => {
    const c = byId(await run(lamp()), 'thermal-shade');
    expect(c.status).toBe('pass');
    expect(c.detail).toMatch(/Screening estimate/);
    expect(c.detail).toMatch(/thermocouple/);
  });

  it('a 100 W incandescent under PLA fails', async () => {
    const p = lamp();
    p.bulb.tech = 'incandescent';
    p.bulb.watts = 100;
    p.bulb.markedWatts = 100;
    p.materials.shade = 'PLA';
    expect(byId(await run(p), 'thermal-shade').status).toBe('fail');
  });

  it('estimates the socket neighbourhood for LED vs incandescent', async () => {
    const pla = lamp();
    pla.materials.structure = 'PLA';
    const led = byId(await run(pla), 'thermal-socket');
    expect(led.status).toBe('warn'); // 25 + 25 = 50 °C vs PLA limit 45 °C (within 10 °C)
    expect(led.detail).toMatch(/50\.0 °C/);

    const hot = lamp();
    hot.bulb.tech = 'incandescent';
    hot.bulb.watts = 100;
    hot.materials.structure = 'PETG';
    const c = byId(await run(hot), 'thermal-socket');
    expect(c.detail).toMatch(/85\.0 °C/); // 25 + 0.6 × 100
  });
});

describe('stability (§132)', () => {
  it('the default lamp passes with margin', async () => {
    const c = byId(await run(lamp()), 'stability');
    expect(c.status).toBe('pass');
    expect(c.detail).toMatch(/° of incline/);
    expect(parseFloat(c.detail.match(/starts at ([0-9.]+) °/)![1])).toBeGreaterThan(12);
  });

  it('a tall narrow lamp fails the 8° requirement', async () => {
    const p = lamp();
    p.base.size = 70;
    p.base.height = 15;
    p.base.feetCount = 0;
    p.stem.height = 500;
    p.shade.sizing = 'absolute';
    p.shade.height = 150;
    p.shade.bottomSize = 90;
    p.shade.topSize = 80;
    const c = byId(await run(p), 'stability');
    expect(c.status).toBe('fail');
    expect(parseFloat(c.detail.match(/starts at ([0-9.]+) °/)![1])).toBeLessThan(8);
  });
});

describe('printability and structure', () => {
  it('flags thin vase-mode walls', async () => {
    const p = lamp();
    p.shade.vaseMode = true;
    p.shade.vaseLineWidth = 0.5;
    const c = byId(await run(p), 'print-wall');
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/0\.50 mm/);
  });

  it('warns when the profile flares more than 60° from vertical', async () => {
    const p = lamp();
    p.shade.mount = 'base';
    p.shade.profile = 'linear';
    p.shade.sizing = 'absolute';
    p.shade.height = 50;
    p.shade.bottomSize = 100;
    p.shade.topSize = 300;
    const c = byId(await run(p), 'print-overhang');
    expect(c.status).toBe('warn');
    expect(parseFloat(c.detail.match(/flare of the nominal profile is ([0-9.]+) °/)![1])).toBeGreaterThan(60);
  });

  it('flat spider spokes are bridging info, oversized parts are bed info', async () => {
    const flat = lamp();
    flat.shade.spokeRise = 0;
    const checks = await run(flat);
    expect(byId(checks, 'print-spokes').status).toBe('info');
    expect(byId(checks, 'print-spokes').detail).toMatch(/bridges/);
    expect(byId(checks, 'print-bed').status).toBe('pass');

    const huge = lamp();
    huge.shade.sizing = 'absolute';
    huge.shade.bottomSize = 300;
    huge.shade.topSize = 280;
    const bed = byId(await run(huge), 'print-bed');
    expect(bed.status).toBe('info');
    expect(bed.detail).toMatch(/Shade 300/);
  });

  it('warns when the base has no cord channel', async () => {
    const p = lamp();
    p.base.cordChannel = false;
    expect(byId(await run(p), 'print-cord').status).toBe('warn');
  });

  it('layout issues become fail checks and the disclaimer is always last', async () => {
    const p = lamp();
    p.shade.hubOuterDiameter = 40;
    const checks = await run(p);
    const issue = byId(checks, 'layout-1');
    expect(issue.status).toBe('fail');
    expect(issue.detail).toMatch(/hub outer diameter is too small/i);
    const last = checks[checks.length - 1];
    expect(last.id).toBe('disclaimer');
    expect(last.status).toBe('info');
    expect(last.detail).toMatch(/cUL\/CSA-listed/);
  });
});
