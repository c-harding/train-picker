import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parse, type Font } from 'opentype.js';
import jostUrl from '@fontsource/jost/files/jost-latin-500-normal.woff?url';
import { parseLabel } from './sign';

// Raised lettering for the station walls: each capital is a solid 3D letter
// standing proud of the brick, built from Jost's glyph outlines (an
// open-licence Futura revival).

let fontPromise: Promise<Font> | null = null;

export function loadLetterFont(): Promise<Font> {
  fontPromise ??= fetch(jostUrl)
    .then((r) => r.arrayBuffer())
    .then((buf) => parse(buf));
  return fontPromise;
}

export interface LetterOptions {
  /** Height of the capitals in world units. */
  capHeight: number;
  /** How far the letters stand out from the wall. */
  depth: number;
  /** Extra space between letters, as a fraction of the cap height. */
  tracking: number;
  /** Squeeze the whole word to fit this width if necessary. */
  maxWidth: number;
}

/**
 * Geometry for the station name in raised capitals: baseline at y = 0, centred
 * on x = 0, extruded from z = 0 (the wall) towards +z.
 */
export function letterGeometry(font: Font, raw: string, o: LetterOptions): THREE.BufferGeometry | null {
  const text = parseLabel(raw).title.toLocaleUpperCase();
  const capUnits = font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7;
  const size = (o.capHeight * font.unitsPerEm) / capUnits; // font size giving that cap height
  const scale = size / font.unitsPerEm;
  const spacing = o.tracking * o.capHeight;

  const parts: THREE.BufferGeometry[] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    // opentype's paths are y-down; flip to y-up as we copy them into a ShapePath.
    const path = glyph.getPath(x, 0, size);
    const sp = new THREE.ShapePath();
    for (const c of path.commands) {
      if (c.type === 'M') sp.moveTo(c.x, -c.y);
      else if (c.type === 'L') sp.lineTo(c.x, -c.y);
      else if (c.type === 'Q') sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    const shapes = sp.toShapes(); // works out solids vs holes (the counters in O, A, R...) from winding
    if (shapes.length) parts.push(new THREE.ExtrudeGeometry(shapes, { depth: o.depth, bevelEnabled: false, curveSegments: 6 }));
    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.6) * scale + spacing;
  }
  if (!parts.length) return null;

  const geo = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(-(box.min.x + box.max.x) / 2, 0, 0);
  const width = box.max.x - box.min.x;
  if (width > o.maxWidth) geo.scale(o.maxWidth / width, o.maxWidth / width, 1);
  return geo;
}
