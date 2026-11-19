import * as THREE from 'three';

// Ground: flat around the ring, rising in an S-curve into a hill off to the
// left. The lead-in runs through a cutting in the slope and into a tunnel.

const HILL_HEIGHT = 15;
const HILL_RUN = 36; // horizontal distance over which the hill rises (a gentle slope)
/** Ground height at the tunnel mouth (above the arch, so the portal sits in the slope). */
const PORTAL_GROUND = 7.585;
const CUT_FLOOR_HALF = 3.28; // flat floor either side of the track centre line
const CUT_SLOPE = 1.4; // rise per unit across the cutting sides

/**
 * Straight sides of the arch before it curves. The arch is as wide as the
 * ballast (±1.74 m) and the train ±1.64 m wide, so the sides rise high enough that
 * at ±1.64 m the arch (4.41 + 0.6 = 5.0 m) still clears the cab roof (4.59 m).
 */
const ARCH_SPRING = 4.408;
const WALL_DEPTH = 2.05;

/**
 * Brightness inside the tunnel, by distance in from the portal's front face. Shadows only
 * block the sun, not the soft sky light, so the dark is painted on: it starts as
 * dim as the shaded archway and only gets darker going in, never lighter.
 */
export const tunnelShade = (depthFromPortal: number) => 0.06 + 0.5 * Math.max(0, 1 - depthFromPortal / 10.25);

export interface Terrain {
  /** Ground height at (x, z). */
  height: (x: number, z: number) => number;
  /** x of the tunnel portal's outer face. */
  portalX: number;
  /** x of the back of the portal wall, where the bore starts to curve. */
  curveStartX: number;
  group: THREE.Group;
}

/** Smootherstep: an S-curve from 0 to 1 with flat ends. */
const smoother = (u: number) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/**
 * @param trackZ z of the lead-in's centre line
 * @param slopeStart x where the ground starts to rise (the hill is to the left of it)
 */
export function makeTerrain(
  trackZ: number,
  slopeStart: number,
  material: THREE.Material,
  /** Tunnel opening half-width: the ballast's, so the bore is exactly as wide as the bed. */
  archHalfW: number,
  /**
   * Radius of the bore's curve. Behind the portal wall it bends 90° (towards +z,
   * left as you go in), so you can't see to the end from outside.
   */
  curveR: number,
  /**
   * Extra half-width for the bore on the curve, where long cars' ends swing out
   * (like real curved tunnels). Eased in just behind the portal.
   */
  curveWidening = 0,
  /** Width of the (square) ground; it grows with the layout so its edge stays in the fog. */
  groundSize = 656,
  /** Width the ground reaches out to, if more than groundSize (0: just that). */
  outerSize = 0,
): Terrain {
  const ARCH_HALF_W = archHalfW;
  const hill = (x: number) => (x >= slopeStart ? 0 : HILL_HEIGHT * smoother((slopeStart - x) / HILL_RUN));

  // Portal where the hillside reaches PORTAL_GROUND
  let lo = slopeStart - HILL_RUN;
  let hi = slopeStart;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (hill(mid) > PORTAL_GROUND) lo = mid;
    else hi = mid;
  }
  const portalX = (lo + hi) / 2;

  // The cutting runs through the whole thickness of the portal wall and ends just
  // behind it, where the ground steps up to the hillside: behind the wall (hidden by it,
  // and cut away where the bore passes).
  const cutEnd = portalX - WALL_DEPTH + 0.041;
  /** The old grid's cell size: the portal wall is sized to hide a step this far behind it. */
  const cell = 1.367;

  const height = (x: number, z: number) => {
    const h = hill(x);
    if (h === 0 || x < cutEnd) return h;
    const across = Math.abs(z - trackZ);
    return Math.min(h, Math.max(0, (across - CUT_FLOOR_HALF) * CUT_SLOPE));
  };

  const group = new THREE.Group();

  // Ground mesh: a grid whose lines are only where the shape needs them. The height
  // varies only along x (the hill's slope) except in the cutting, so: lines across the
  // whole width every 0.5 m over the slope and two at the step behind the portal, the
  // flat ground at the hill's foot and top a single span each; and lines along it only
  // across the cutting (every 0.5 m) and at the edges of the hole for the bore. A few
  // thousand vertices, however big the layout.
  const half = Math.max(outerSize, groundSize) / 2;
  const boreHalf = archHalfW + cell * 1.5;
  const xSet = new Set<number>([-half, half, cutEnd - 0.01, cutEnd]);
  for (let x = slopeStart - HILL_RUN; x <= slopeStart; x += 0.5) xSet.add(x);
  xSet.add(slopeStart);
  const cutHalf = CUT_FLOOR_HALF + HILL_HEIGHT / CUT_SLOPE + 1;
  const zSet = new Set<number>([-half, half, trackZ - boreHalf, trackZ + boreHalf]);
  for (let z = -cutHalf; z <= cutHalf; z += 0.5) zSet.add(trackZ + z);
  const xs = [...xSet].filter((x) => x >= -half && x <= half).sort((a, b) => a - b);
  const zs = [...zSet].filter((z) => z >= -half && z <= half).sort((a, b) => a - b);
  const NX = xs.length;
  const verts: number[] = [];
  for (const z of zs) for (const x of xs) verts.push(x, height(x, z), z);
  const kept: number[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      // (the hole where the bore meets the hillside: the step's row, across the bore)
      const inStep = xs[i] < cutEnd && xs[i + 1] >= cutEnd;
      const inBore = Math.abs(zs[j] - trackZ) <= boreHalf && Math.abs(zs[j + 1] - trackZ) <= boreHalf;
      if (inStep && inBore) continue;
      const a = j * NX + i;
      kept.push(a, a + NX, a + 1, a + NX, a + NX + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(kept);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, material);
  ground.receiveShadow = true;
  ground.castShadow = true; // so the hill darkens the inside of the tunnel
  group.add(ground);

  // Portal: a stone wall across the end of the cutting with an arched opening
  // High enough to hide the step to the hillside, which can sit up to a cell behind the wall
  const wallTop = hill(cutEnd - cell) + 0.82;
  const wallHalfW = CUT_FLOOR_HALF + wallTop / CUT_SLOPE + 0.82;

  /**
   * A band following the arch between half-widths w0 and w1, open at the bottom:
   * no floor face to fight with the ground or ballast.
   */
  const archBand = (w0: number, w1: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w1, 0);
    sh.lineTo(-w1, ARCH_SPRING);
    sh.absarc(0, ARCH_SPRING, w1, Math.PI, 0, true);
    sh.lineTo(w1, 0);
    sh.lineTo(w0, 0);
    sh.lineTo(w0, ARCH_SPRING);
    sh.absarc(0, ARCH_SPRING, w0, 0, Math.PI, false);
    sh.lineTo(-w0, 0);
    sh.closePath();
    return sh;
  };

  const wallShape = new THREE.Shape();
  wallShape.moveTo(-wallHalfW, 0);
  wallShape.lineTo(-ARCH_HALF_W, 0);
  wallShape.lineTo(-ARCH_HALF_W, ARCH_SPRING);
  wallShape.absarc(0, ARCH_SPRING, ARCH_HALF_W, Math.PI, 0, true);
  wallShape.lineTo(ARCH_HALF_W, 0);
  wallShape.lineTo(wallHalfW, 0);
  wallShape.lineTo(wallHalfW, wallTop);
  wallShape.lineTo(-wallHalfW, wallTop);
  wallShape.closePath();

  // Shape is drawn in (across, up); turn it so "across" runs along z and the
  // extrusion runs along -x, into the hill.
  // rotateY(-90°) maps (across, up, depth) to (-depth, up, across), so the
  // extrusion ends up spanning [x - depth, x].
  const toPortal = (g: THREE.BufferGeometry, x: number) => g.rotateY(-Math.PI / 2).translate(x, 0, trackZ);

  const stone = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.95 });
  const wallGeo = toPortal(new THREE.ExtrudeGeometry(wallShape, { depth: WALL_DEPTH, bevelEnabled: false }), portalX);
  const wall = new THREE.Mesh(wallGeo, stone);
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // A darker ring of arch stones standing slightly proud of the wall
  const ringGeo = toPortal(
    new THREE.ExtrudeGeometry(archBand(ARCH_HALF_W, ARCH_HALF_W + 0.718), { depth: 0.246, bevelEnabled: false }),
    portalX + 0.246,
  );
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x6f6b64, roughness: 0.9 }));
  ring.castShadow = true;
  group.add(ring);

  // Coping along the top of the wall
  const coping = new THREE.Mesh(
    new THREE.BoxGeometry(WALL_DEPTH + 0.513, 0.41, wallHalfW * 2 + 0.513),
    new THREE.MeshStandardMaterial({ color: 0x6f6b64, roughness: 0.9 }),
  );
  coping.position.set(portalX - WALL_DEPTH / 2, wallTop + 0.205, trackZ);
  coping.castShadow = true;
  group.add(coping);

  // The bore: a stone-lined arch that curves 90° behind the wall, swept along the
  // track's arc. Only the inside surface is built (the outside is buried in the
  // hill). It darkens with depth, and a black wall closes it off round the bend.
  const curveStartX = portalX - WALL_DEPTH;
  const cx = curveStartX;
  const cz = trackZ + curveR;
  // Very slightly inside the archway, so it covers the wall's own reveal faces:
  // everything you see through the arch is this unlit lining, with no sun on it.
  const ARC_STEPS = 16;
  // Closed profile: up one side, over the arch, down the other side and back across
  // the floor. The floor spans the whole bore (wider than the ballast on the curve),
  // just above ground level so it doesn't fight the cutting floor at the mouth.
  const FLOOR_Y = 0.021;
  const profileAt = (w: number): [number, number][] => {
    const pts: [number, number][] = [[-w, FLOOR_Y]];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = Math.PI - (i / ARC_STEPS) * Math.PI;
      pts.push([w * Math.cos(t), ARCH_SPRING + w * Math.sin(t)]);
    }
    pts.push([w, FLOOR_Y]);
    pts.push([-w, FLOOR_Y]); // floor
    return pts;
  };
  // Width as you go in: ballast-wide through the portal, then eased out on the curve.
  const widthAt = (d: number) =>
    ARCH_HALF_W - 0.021 + curveWidening * smoother((d - WALL_DEPTH) / 5.125);

  // Sections run from the portal's front face: straight through the wall, then round the curve.
  const arcLen = (Math.PI / 2) * curveR;
  const total = WALL_DEPTH + arcLen;
  const sections = Math.max(8, Math.ceil(total / 0.615));
  const positions: number[] = [];
  const colors: number[] = [];
  const boreIndex: number[] = [];
  for (let j = 0; j <= sections; j++) {
    const d = (j / sections) * total; // distance in from the portal face
    const light = tunnelShade(d);
    const phi = -Math.PI / 2 - (Math.max(0, d - WALL_DEPTH) / arcLen) * (Math.PI / 2);
    const ux = Math.cos(phi);
    const uz = Math.sin(phi);
    const ox = d < WALL_DEPTH ? WALL_DEPTH - d : 0; // still within the wall: shift back along the straight
    const profile = profileAt(widthAt(d));
    for (const [a, b] of profile) {
      positions.push(cx + ox + (curveR + a) * ux, b, cz + (curveR + a) * uz);
      colors.push(light, light, light);
    }
  }
  const P = ARC_STEPS + 4;
  for (let j = 0; j < sections; j++) {
    for (let i = 0; i < P - 1; i++) {
      const a = j * P + i;
      const b = a + 1;
      const c = a + P;
      const d = c + 1;
      boreIndex.push(a, c, b, b, c, d);
    }
  }
  const boreGeo = new THREE.BufferGeometry();
  boreGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  boreGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  boreGeo.setIndex(boreIndex);
  boreGeo.computeVertexNormals();
  // Unlit: the shading is entirely the depth fade, so no sunlight or shadow edges inside.
  const bore = new THREE.Mesh(
    boreGeo,
    new THREE.MeshBasicMaterial({ color: 0x6b6760, vertexColors: true, side: THREE.DoubleSide }),
  );
  group.add(bore);

  // Black end wall, square to the track at the end of the bend
  const endPhi = -Math.PI;
  const across = new THREE.Vector3(Math.cos(endPhi), 0, Math.sin(endPhi));
  const ahead = new THREE.Vector3(Math.sin(endPhi), 0, -Math.cos(endPhi));
  const endShape = new THREE.Shape(profileAt(widthAt(total)).map(([a, b]) => new THREE.Vector2(a, b)));
  const endGeo = new THREE.ShapeGeometry(endShape).applyMatrix4(
    new THREE.Matrix4()
      .makeBasis(across, new THREE.Vector3(0, 1, 0), ahead)
      .setPosition(cx + curveR * Math.cos(endPhi), 0, cz + curveR * Math.sin(endPhi)),
  );
  group.add(new THREE.Mesh(endGeo, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })));

  return { height, portalX, curveStartX, group };
}
