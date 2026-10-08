import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LatheGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PointLight,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartId } from '../geometry/build';
import type { LampParams } from '../model/params';
import type { LampView } from '../worker/messages';
import { PART_COLORS, PART_ORDER } from './partColors';
import { ulEnvelope } from './ulEnvelope';

export interface ViewOptions {
  exploded: boolean;
  sectionCut: boolean;
  shadeTranslucent: boolean;
  showHardware: boolean;
  showUl: boolean;
  /** per-part visibility */
  visible: Record<PartId, boolean>;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  exploded: false,
  sectionCut: false,
  shadeTranslucent: true,
  showHardware: true,
  showUl: false,
  visible: { base: true, stem: true, cup: true, shade: true, fitter: true },
};

/** Z gap between neighbouring parts in the exploded view, mm. */
const EXPLODE_GAP = 45;
const CREASE_ANGLE = (40 * Math.PI) / 180;
const GRID_EXTENT = 1000;
const LABEL_STEP = 100;
const LABEL_COUNT = 4;

function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    if (o instanceof Mesh || o instanceof Line) {
      o.geometry.dispose();
      const mat: Material | Material[] = o.material;
      for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
    }
  });
}

function makeLabel(text: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 56;
  const g = canvas.getContext('2d');
  if (g) {
    g.font = '600 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#9aa3b2';
    g.fillText(text, 80, 28);
  }
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }));
  sprite.scale.set(36, 12.6, 1);
  return sprite;
}

/** Cylinder along Z from z0 to z1, centred on (x, y). */
function zCylinder(radius: number, z0: number, z1: number, x: number, y: number, radialSegments = 48): BufferGeometry {
  const g = new CylinderGeometry(radius, radius, Math.abs(z1 - z0), radialSegments, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

/** Hollow ring (annulus swept 360°) between radii ri..ro and heights z0..z1 about the vertical axis at (x, y). */
function zRing(ri: number, ro: number, z0: number, z1: number, x: number, y: number): BufferGeometry {
  const pts = [new Vector2(ri, z0), new Vector2(ro, z0), new Vector2(ro, z1), new Vector2(ri, z1), new Vector2(ri, z0)];
  const g = new LatheGeometry(pts, 64);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

/**
 * three.js preview of a built lamp. Renders on demand (controls change, new build, option change, resize).
 * World frame matches the model: Z up, table at z = 0.
 */
export class LampViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(35, 1, 1, 10000);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly clipPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly staticObjects: Object3D[] = [];
  private content: Group | null = null;
  private partMeshes = new Map<PartId, Mesh>();
  private hardware: Group | null = null;
  private ul: Group | null = null;
  private shadeMaterials: MeshStandardMaterial[] = [];
  private options: ViewOptions = DEFAULT_VIEW_OPTIONS;
  private framed = false;
  private height = 300;
  private axis = new Vector3();
  private frame = 0;
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'viewer-canvas';

    this.scene.background = new Color(0x1a1c21);
    this.camera.up.set(0, 0, 1);

    this.addLights();
    this.addGround();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.maxPolarAngle = Math.PI * 0.98;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.resetView();
  }

  private addLights(): void {
    const hemi = new HemisphereLight(0xffffff, 0x3a3d46, 1.1);
    hemi.position.set(0, 0, 1);
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(250, -400, 500);
    const fill = new DirectionalLight(0xb4c4ff, 0.5);
    fill.position.set(-300, 200, 150);
    this.scene.add(hemi, key, fill, new AmbientLight(0xffffff, 0.15));
  }

  /** Ground grid (10 mm minor, 100 mm major lines) in the XY plane plus mm labels along +X and +Y. */
  private addGround(): void {
    const minor = new GridHelper(GRID_EXTENT, GRID_EXTENT / 10, 0x2c2f37, 0x2c2f37);
    const major = new GridHelper(GRID_EXTENT, GRID_EXTENT / 100, 0x4a4f5c, 0x4a4f5c);
    for (const grid of [minor, major]) {
      grid.rotation.x = Math.PI / 2;
      this.scene.add(grid);
      this.staticObjects.push(grid);
    }
    minor.position.z = -0.2;
    major.position.z = -0.1;

    const axisMat = (c: number) => new LineBasicMaterial({ color: c });
    const axes: Array<[Vector3, number]> = [
      [new Vector3(LABEL_STEP * LABEL_COUNT, 0, 0), 0xb04a4a],
      [new Vector3(0, LABEL_STEP * LABEL_COUNT, 0), 0x4ab06a],
    ];
    for (const [end, color] of axes) {
      const line = new Line(new BufferGeometry().setFromPoints([new Vector3(0, 0, 0), end]), axisMat(color));
      line.position.z = 0.05;
      this.scene.add(line);
      this.staticObjects.push(line);
    }
    for (let i = 1; i <= LABEL_COUNT; i++) {
      const d = i * LABEL_STEP;
      const lx = makeLabel(`${d} mm`);
      lx.position.set(d, -14, 1);
      const ly = makeLabel(`${d} mm`);
      ly.position.set(-22, d, 1);
      this.scene.add(lx, ly);
      this.staticObjects.push(lx, ly);
    }
  }

  setOptions(options: ViewOptions): void {
    this.options = options;
    this.applyOptions();
    this.requestRender();
  }

  /** Replace the displayed lamp. `params` must be the parameters `build` was generated from. */
  setBuild(build: LampView | null, params: LampParams | null): void {
    if (this.content) {
      this.scene.remove(this.content);
      disposeTree(this.content);
      this.content = null;
    }
    this.partMeshes = new Map();
    this.shadeMaterials = [];
    this.hardware = null;
    this.ul = null;
    if (build && params) {
      this.content = new Group();
      this.buildParts(build);
      this.buildHardware(build, params);
      this.buildUl(build, params);
      this.scene.add(this.content);
      this.axis.set(build.layout.axisX, build.layout.axisY, 0);
      this.clipPlane.constant = -build.layout.axisY;
      this.height = build.layout.totalHeight;
      if (!this.framed) {
        this.resetView();
        this.framed = true;
      }
    }
    this.applyOptions();
    this.requestRender();
  }

  resetView(): void {
    const dist = Math.max(this.height * 2.1, 260);
    this.controls.target.set(this.axis.x, this.axis.y, this.height * 0.42);
    this.camera.position.set(this.axis.x + dist * 0.45, this.axis.y - dist * 0.9, this.height * 0.42 + dist * 0.35);
    this.controls.update();
    this.requestRender();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.content) disposeTree(this.content);
    for (const o of this.staticObjects) {
      disposeTree(o);
      if (o instanceof Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private buildParts(build: LampView): void {
    for (const part of build.parts) {
      if (part.mesh.indices.length === 0) continue;
      const raw = new BufferGeometry();
      raw.setAttribute('position', new BufferAttribute(part.mesh.positions, 3));
      raw.setIndex(new BufferAttribute(part.mesh.indices, 1));
      const geometry = toCreasedNormals(raw, CREASE_ANGLE);
      raw.dispose();
      const material = new MeshStandardMaterial({
        color: PART_COLORS[part.id],
        roughness: 0.62,
        metalness: 0.05,
        clippingPlanes: [],
      });
      if (part.id === 'shade' || part.id === 'fitter') this.shadeMaterials.push(material);
      const mesh = new Mesh(geometry, material);
      mesh.name = part.id;
      this.partMeshes.set(part.id, mesh);
      this.content?.add(mesh);
    }
  }

  /** Socket body, shade ring, glowing bulb and its point light — drawn from layout and socket values. */
  private buildHardware(build: LampView, params: LampParams): void {
    const L = build.layout;
    const sock = params.hardware.socket;
    const group = new Group();
    const grey = new MeshStandardMaterial({ color: 0x6b7078, roughness: 0.45, metalness: 0.6, clippingPlanes: [], side: DoubleSide });

    group.add(new Mesh(zCylinder(sock.bodyDiameter / 2, L.socketBottom, L.socketTop - 1, L.axisX, L.axisY), grey));
    if (params.hardware.socketMount === 'ring' && Number.isFinite(L.ringBottom)) {
      const ringMat = new MeshStandardMaterial({ color: 0x8b9099, roughness: 0.4, metalness: 0.7, clippingPlanes: [], side: DoubleSide });
      group.add(
        new Mesh(
          zRing(sock.skirtDiameter / 2, sock.ringDiameter / 2, L.ringBottom, L.ringBottom + sock.ringThickness, L.axisX, L.axisY),
          ringMat,
        ),
      );
    } else {
      group.add(new Mesh(zCylinder(params.hardware.nippleDiameter / 2, L.cupTop - params.cup.plateThickness, L.socketBottom + 1, L.axisX, L.axisY, 24), grey));
    }

    const profile = L.bulbProfile.map(([z, r]) => new Vector2(r, z));
    const bulbGeo = new LatheGeometry(profile, 48);
    bulbGeo.rotateX(Math.PI / 2);
    bulbGeo.translate(L.axisX, L.axisY, 0);
    const bulbMat = new MeshStandardMaterial({
      color: 0xfff1cf,
      emissive: 0xffd48a,
      emissiveIntensity: 1.1,
      roughness: 0.3,
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      clippingPlanes: [],
    });
    group.add(new Mesh(bulbGeo, bulbMat));

    let widest = L.bulbProfile[0];
    for (const pt of L.bulbProfile) if (pt[1] > widest[1]) widest = pt;
    const light = new PointLight(0xffdca0, 2.2, 0, 0);
    light.position.set(L.axisX, L.axisY, widest[0]);
    group.add(light);

    this.hardware = group;
    this.content?.add(group);
  }

  /** UL 153 centerline (line) and minimum-spacing envelope (translucent capsule) at the bulb axis. */
  private buildUl(build: LampView, params: LampParams): void {
    const L = build.layout;
    const env = ulEnvelope(params, L);
    const group = new Group();
    const capsule = new CapsuleGeometry(env.spacing, env.centerline, 12, 48);
    capsule.rotateX(Math.PI / 2);
    capsule.translate(L.axisX, L.axisY, L.contactZ + env.centerline / 2);
    group.add(
      new Mesh(
        capsule,
        new MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.16, depthWrite: false, side: BackSide, clippingPlanes: [] }),
      ),
    );
    const line = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(L.axisX, L.axisY, L.contactZ),
        new Vector3(L.axisX, L.axisY, L.contactZ + env.centerline),
      ]),
      new LineBasicMaterial({ color: 0xff3d3d, depthTest: false }),
    );
    line.renderOrder = 10;
    group.add(line);
    this.ul = group;
    this.content?.add(group);
  }

  private applyOptions(): void {
    const o = this.options;
    const planes = o.sectionCut ? [this.clipPlane] : [];
    const explodeOf = (id: PartId) => (o.exploded ? PART_ORDER.indexOf(id) * EXPLODE_GAP : 0);

    for (const [id, mesh] of this.partMeshes) {
      mesh.visible = o.visible[id];
      mesh.position.z = explodeOf(id);
      const mat = mesh.material as MeshStandardMaterial;
      const translucent = o.shadeTranslucent && id === 'shade';
      mat.transparent = translucent;
      mat.opacity = translucent ? 0.45 : 1;
      mat.depthWrite = !translucent;
      mat.side = o.sectionCut || translucent ? DoubleSide : FrontSide;
      mat.clippingPlanes = planes;
      mat.needsUpdate = true;
    }

    for (const group of [this.hardware, this.ul]) {
      if (!group) continue;
      group.position.z = explodeOf('cup');
      group.traverse((child) => {
        if (child instanceof Mesh || child instanceof Line) {
          for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
            m.clippingPlanes = planes;
            m.needsUpdate = true;
          }
        }
      });
    }
    if (this.hardware) this.hardware.visible = o.showHardware;
    if (this.ul) this.ul.visible = o.showUl;
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender(): void {
    if (this.disposed || this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }
}
