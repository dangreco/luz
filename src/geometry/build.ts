import type { LampParams, MaterialId } from '../model/params';
import { computeLayout, type Layout } from '../model/layout';
import { MATERIALS } from '../model/hardware';
import { massProps, shellProps, toArrays, type MeshArrays, type Vec3 } from './mesh';
import { buildStructure } from './structure';
import { buildShadeParts } from './shade';
import type { Manifold, ManifoldToplevel } from './wasm';

export type PartId = 'base' | 'stem' | 'cup' | 'shade' | 'fitter';

/** A solid as produced by a geometry module, in assembled world coordinates. */
export interface SolidPart {
  id: PartId;
  label: string;
  solid: Manifold;
  /** rotate 180° about X before printing (e.g. cup prints plate-down) */
  printFlip: boolean;
  /** set when the solid is sliced as a single wall (vase mode): mass = surface area × this thickness */
  printedShell?: number;
  notes: string[];
}

/** A finished part, serialisable across the worker boundary. */
export interface PartMesh {
  id: PartId;
  label: string;
  material: MaterialId;
  /** assembled world position (preview) */
  mesh: MeshArrays;
  printFlip: boolean;
  volume: number;
  /** grams, solid-model estimate (slicer infill will differ) */
  mass: number;
  centroid: Vec3;
  bbox: { min: Vec3; max: Vec3 };
  notes: string[];
}

export interface LampBuild {
  layout: Layout;
  parts: PartMesh[];
}

export function buildLamp(m: ManifoldToplevel, p: LampParams): LampBuild {
  const layout = computeLayout(p);
  const solids = [...buildStructure(m, p, layout), ...buildShadeParts(m, p, layout)];
  const parts = solids.map((s): PartMesh => {
    const mesh = toArrays(s.solid);
    const { volume, centroid } = s.printedShell ? shellProps(mesh, s.printedShell) : massProps(mesh);
    const box = s.solid.boundingBox();
    const material = s.id === 'shade' || s.id === 'fitter' ? p.materials.shade : p.materials.structure;
    s.solid.delete();
    return {
      id: s.id,
      label: s.label,
      material,
      mesh,
      printFlip: s.printFlip,
      volume,
      mass: (volume / 1000) * MATERIALS[material].density,
      centroid,
      bbox: { min: [box.min[0], box.min[1], box.min[2]], max: [box.max[0], box.max[1], box.max[2]] },
      notes: s.notes,
    };
  });
  return { layout, parts };
}
