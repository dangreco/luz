import { strToU8, zipSync } from 'fflate';
import type { PartMesh } from '../geometry/build';
import type { Vec3 } from '../geometry/mesh';

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const BED_GAP = 10; // mm between laid-out parts

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Round to 1 µm and avoid "-0" in the XML. */
function num(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * One object per part in print orientation (180° X flip when `printFlip`, min z = 0), laid out
 * left → right along X with 10 mm gaps and never overlapping. Unit millimetre, 3MF core spec.
 */
export function to3mf(parts: PartMesh[]): Uint8Array {
  const objects: string[] = [];
  const items: string[] = [];
  let cursorX = 0;

  parts.forEach((part, index) => {
    const id = index + 1;
    const mesh = part.mesh;
    const flip = part.printFlip;
    const verts: string[] = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = flip ? -mesh.positions[i + 1] : mesh.positions[i + 1];
      const z = (flip ? -mesh.positions[i + 2] : mesh.positions[i + 2]);
      verts.push(`<vertex x="${num(x)}" y="${num(y)}" z="${num(z)}"/>`);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
    }
    const dz = -minZ;
    const ty = -minY;
    const tx = cursorX - minX;
    cursorX = cursorX + (maxX - minX) + BED_GAP;

    const tris: string[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      tris.push(`<triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"/>`);
    }
    objects.push(
      `  <object id="${id}" type="model" name="${xmlEscape(part.label)}">` +
        `<mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh>` +
        `</object>`,
    );
    const t: Vec3 = [tx, ty, dz];
    items.push(
      `   <item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(t[0])} ${num(t[1])} ${num(t[2])}"/>`,
    );
  });

  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">\n` +
    ` <metadata name="Application">Luz parametric table lamp</metadata>\n` +
    ` <resources>\n${objects.join('\n')}\n </resources>\n` +
    ` <build>\n${items.join('\n')}\n </build>\n` +
    `</model>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-3dmodel" ` +
    `Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(model),
    },
    { level: 6 },
  );
}
