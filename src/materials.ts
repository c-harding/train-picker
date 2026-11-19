import * as THREE from 'three';

// Procedural textures for the station buildings: red brick and slate roof tiles.

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic pseudo-random sequence so textures look the same on every load. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** One tile of the brick texture covers this much wall (8 bricks × 8 courses). */
const BRICK_TILE = { w: 3.28, h: 1.23 };

/** Brick texture resolution: pixels per brick (it was 32 × 16, blurry close up). */
const BRICK_PX = { w: 128, h: 64 };

const brickBase = canvasTexture(BRICK_PX.w * 8, BRICK_PX.h * 8, (ctx) => {
  const rand = seeded(7);
  const colors = ['#9c4a32', '#a8553a', '#8f4430', '#b0603f', '#94472f', '#a24f36'];
  const { w: bw, h: bh } = BRICK_PX;
  const joint = bw * 0.047; // half the mortar joint, in proportion as before
  ctx.fillStyle = '#cfc6b8'; // mortar
  ctx.fillRect(0, 0, bw * 8, bh * 8);
  for (let row = 0; row < 8; row++) {
    const offset = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 9; col++) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.fillRect(col * bw + offset + joint, row * bh + joint, bw - 2 * joint, bh - 2 * joint);
    }
  }
});

/** One tile of the roof texture covers this much roof. */
const TILE_TILE = { w: 1.64, h: 1.64 };

const tileBase = canvasTexture(256, 256, (ctx) => {
  const rand = seeded(11);
  const colors = ['#3d4248', '#464b52', '#353a40', '#41464d', '#4b5057'];
  const tw = 32;
  const th = 32;
  for (let row = 0; row < 8; row++) {
    const offset = row % 2 ? tw / 2 : 0;
    for (let col = -1; col < 9; col++) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.fillRect(col * tw + offset, row * th, tw - 2, th);
    }
    // Shadow under each course where it overlaps the one below
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, row * th + th - 4, 256, 4);
  }
});

function repeated(base: THREE.Texture, tile: { w: number; h: number }, w: number, h: number): THREE.Texture {
  const t = base.clone();
  t.repeat.set(w / tile.w, h / tile.h);
  t.needsUpdate = true;
  return t;
}

/** Brick for a face of the given size (for geometry with 0–1 UVs, like boxes). */
export const brick = (w: number, h: number) =>
  new THREE.MeshStandardMaterial({ map: repeated(brickBase, BRICK_TILE, w, h), roughness: 0.95 });

/** Brick for geometry whose UVs are in world units (e.g. ExtrudeGeometry). */
export const brickWorld = () =>
  new THREE.MeshStandardMaterial({ map: repeated(brickBase, BRICK_TILE, 1, 1), roughness: 0.95 });

/** Roof tiles for a roof plane of the given size (box UVs). */
export const tiles = (w: number, h: number) =>
  new THREE.MeshStandardMaterial({ map: repeated(tileBase, TILE_TILE, w, h), roughness: 0.8 });
