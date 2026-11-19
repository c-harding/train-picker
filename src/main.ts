import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { langPicker, t, translatePage, type MessageKey } from './i18n';
import { assignPillColors, drawSignCanvas, loadSignFonts, parseLabel, type SignMode } from './sign';
import { letterGeometry, loadLetterFont } from './wallLetters';
import { brick, brickWorld, tiles } from './materials';
import { makeTerrain, tunnelShade, type Terrain } from './terrain';
import './style.css';

// ---------------------------------------------------------------------------
// Config & state
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const STORAGE_KEY = 'train-picker:names';
const DEFAULT_NAMES = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie'];
/**
 * Home station on the lead-in, behind where the train starts. Never picked.
 * Set in the People panel (saved in the browser) or with ?me=Name.
 */
const ME_KEY = 'train-picker:me';
function loadMyName(): string {
  const fromUrl = new URLSearchParams(location.search).get('me')?.trim();
  if (fromUrl) return fromUrl;
  try {
    return localStorage.getItem(ME_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}
let myName = loadMyName();
const homeName = () => myName || t('people.homeName');
const HOME_COLOR = 0x8e44ad;
const STATION_COLORS =[0xe74c3c, 0x3498db, 0x27ae60, 0x9b59b6, 0xf39c12, 0x16a085, 0xd35400, 0x2c3e50];
const WHEEL_RADIUS = 0.574;
/** The track's gauge, in metres (the distance between the rails): standard, or metre gauge for the RhB's Allegra (set by deriveStock). */
const STANDARD_GAUGE = 1.435;
let TRACK_GAUGE = STANDARD_GAUGE;
let RAIL_HALF_GAUGE = TRACK_GAUGE / 2;
/** Height of the rails' centre line above the ground, and the rails' height (their top is where the wheels run). */
const RAIL_Y = 0.349;
const RAIL_H = 0.185;
/** Top of the rails, where the wheels run (real heights like platforms are measured from here). */
const RAIL_TOP = RAIL_Y + RAIL_H / 2;

/**
 * Locomotive dimensions (metres; x along the loco, + forwards; heights above the
 * ground). Two versions: the default compact one, and with ?train=full a
 * full-size DB class 64 (12.4 m over buffers, 1.5 m driving wheels).
 */
interface LocoSpec {
  half: number; // half the running board's length
  width: number;
  deckBottom: number; // running board
  deckTop: number;
  frameY: number; // red frames between the wheels
  frameH: number;
  beamBottom: number; // buffer beams
  beamTop: number;
  boilerR: number;
  boilerY: number;
  boilerBack: number; // x range of the boiler (it runs back into the cab)
  boilerFront: number;
  smokeboxLen: number;
  saddle: boolean; // a support under the boiler, when it sits clear of the running board
  domeXs: number[];
  domeR: number;
  chimneyX: number;
  chimneyR: number;
  panelFront: number; // side tanks / panels run from here back to the rear
  panelTop: number;
  emblemX: number;
  cabX: number;
  cabL: number;
  cabShoulder: number; // where the cab sides start curving into the roof
  cabTop: number;
  cabWindowW: number;
  driverR: number;
  driverXs: number[];
  mainAxle: number; // the driving axle the connecting rods work on
  crank: number;
  conRod: number;
  carryingR: number;
  carryingXs: number[];
  cylLen: number;
  cylR: number;
}

const COMPACT_LOCO: LocoSpec = {
  half: 3.25, width: 3.05,
  deckBottom: 1.394, deckTop: 1.722, frameY: 1.179, frameH: 0.39, beamBottom: 1.271, beamTop: 1.845, // frames' top 2 cm below the deck (no z-fighting)
  boilerR: 1.23, boilerY: 1.722 + 1.23, boilerBack: -0.922, boilerFront: 3.178, smokeboxLen: 0.738, saddle: false,
  domeXs: [0.615, 1.743], domeR: 0.41, chimneyX: 2.706, chimneyR: 0.308,
  panelFront: 2.357, panelTop: 3.075, emblemX: 0.923,
  cabX: -1.538, cabL: 1.64, cabShoulder: 3.895, cabTop: 4.592, cabWindowW: 0.615,
  driverR: 0.574, driverXs: [1.538, 0.205, -1.128], mainAxle: 0.205, crank: 0.287, conRod: 1.476,
  carryingR: 0.349, carryingXs: [2.829, -2.46], cylLen: 0.861, cylR: 0.246,
};

/**
 * After the real class 64, measured from a side-on photo scaled to its 12.4 m over
 * buffers: 1.5 m driving and 0.85 m carrying wheels, the drivers set back from
 * the middle, side tanks from the cab to just behind the smokebox, a ~2.15 m cab
 * and only a ~1 m coal bunker at the rear.
 */
const FULL_LOCO: LocoSpec = {
  half: 5.8, width: 3.05,
  deckBottom: RAIL_TOP + 1.59, deckTop: RAIL_TOP + 1.67, frameY: 1.5, frameH: 1.0, beamBottom: 1.271, beamTop: RAIL_TOP + 1.85,
  boilerR: 0.8, boilerY: RAIL_TOP + 3.05, boilerBack: -3.0, boilerFront: 5.0, smokeboxLen: 1.25, saddle: true,
  domeXs: [-0.4, 0.9, 2.05], domeR: 0.45, chimneyX: 3.3, chimneyR: 0.34,
  panelFront: 3.14, panelTop: RAIL_TOP + 2.7, emblemX: 0.2,
  cabX: -3.785, cabL: 2.15, cabShoulder: RAIL_TOP + 3.9, cabTop: RAIL_TOP + 4.2, cabWindowW: 0.75,
  driverR: 0.75, driverXs: [1.36, -0.42, -2.11], mainAxle: -0.42, crank: 0.33, conRod: 2.3,
  carryingR: 0.425, carryingXs: [4.12, -4.55], cylLen: 0.9, cylR: 0.32,
};

type LocoKind = 'compact' | 'full' | 'taurus' | 'railjet' | 's423' | 'flirt' | 'lint' | 'desiro' | 'kiss' | 'rjkiss' | 'allegra';
/** Rolling stock: which locomotive, how many carriages, and how long they are. */
interface RollingStock {
  loco: LocoKind;
  carriages: number;
  /** Carriage length in metres, or null for the loco type's default (stockLength()). */
  length: number | null;
  /** Text in the locomotive / driving trailer emblem (default from .env). */
  emblem: string;
  /** Lettering along the carriages' sides (default from .env). */
  lettering: string;
}
/** Shortest carriage length allowed, for any train. */
const MIN_LENGTH = 8;
const DEFAULT_EMBLEM = import.meta.env.VITE_LOCO_EMBLEM ?? '';
const DEFAULT_LETTERING = import.meta.env.VITE_CARRIAGE_LETTERING ?? '';
/** Rolling stock from URL parameters (?train= &carriages= &length= &logo= &lettering=), with defaults. */
function parseStock(search: string): RollingStock {
  const q = new URLSearchParams(search);
  const v = q.get('train');
  return {
    loco: v === 'full' || v === 'taurus' || v === 'railjet' || v === 's423' || v === 'flirt' || v === 'lint' || v === 'desiro' || v === 'kiss' || v === 'rjkiss' || v === 'allegra' ? v : 'compact',
    carriages: THREE.MathUtils.clamp(Math.round(Number(q.get('carriages')) || 1), 1, 12),
    length: Number(q.get('length')) ? THREE.MathUtils.clamp(Number(q.get('length')), MIN_LENGTH, 30) : null,
    emblem: (q.get('logo') ?? DEFAULT_EMBLEM).trim(),
    lettering: (q.get('lettering') ?? DEFAULT_LETTERING).trim(),
  };
}
/**
 * Carriage length when none is given: the real length, except for the compact
 * toy-like train (full size: the four-axle Umbauwagen a class 64 pulled).
 */
const DEFAULT_LENGTH: Record<LocoKind, number> = { compact: 9, full: 19.46, taurus: 26.4, railjet: 26.5, s423: 15.46, flirt: 16.5, lint: 23.79, desiro: 24.4, kiss: 26.1, rjkiss: 26.1, allegra: 15.3 };
const stockLength = (s: RollingStock) => s.length ?? DEFAULT_LENGTH[s.loco];
let stock = parseStock(location.search);

// Everything below derived from the rolling stock is set by deriveStock() (and
// recalculated whenever the rolling stock changes, without a reload).
let LOCO_KIND: LocoKind = 'compact';
/** The steam locomotive's dimensions (used when a steam loco is chosen). */
let LOCO: LocoSpec = COMPACT_LOCO;

/**
 * Siemens ES64U2 "Taurus" (DB class 182), real dimensions: 19.58 m over buffers,
 * 3.0 m wide, two two-axle bogies with 1.15 m wheels, bogie centres 9.9 m apart
 * and a 2.9 m bogie wheelbase.
 */
const TAURUS = {
  half: 19.58 / 2 - 0.41, // running length; the buffers add the rest, like the other locos
  width: 3.0,
  bogieX: 4.95,
  bogieWheelbase: 2.9,
  solebarBottom: RAIL_TOP + 0.95, // dark grey band along the bottom of the body
  bodyBottom: RAIL_TOP + 1.55, // the red starts here
  // Roof the same shape as the coaches': eaves at the same height, the same rise
  roofEdge: 4.018, // = CARRIAGE_EAVES
  roofRise: 0.574, // = the coaches' roof rise
  noseLen: 2.7, // how far back from the front the nose meets the roof line (it leans back all the way up)
  cabRoofLen: 1.6, // red roof over each cab; dark grey between
};
/** DB traffic red: used for the Taurus and the EC coaches alike. */
const DB_RED = 0xec0016;
/** Contact wire height: the standard 5.5 m above the rails. */
const CONTACT_WIRE_Y = RAIL_TOP + 5.5;
/** Width and pivot half-distance of whichever locomotive is in use. */
/** Electric: the Taurus, or the same locomotive in Railjet livery (with Railjet coaches). */
let ELECTRIC = false;
let RAILJET = false;
/**
 * An articulated multiple unit with a cab at each end and no loco: the S-Bahn
 * class 423, or (FLIRT) the BRB's Stadler FLIRT 3, built on the same running gear.
 */
let S423 = false;
let FLIRT = false;
/** The BRB's Alstom Coradia LINT 54: a diesel unit of two cars (or one), same running gear. */
let LINT = false;
/** ÖBB's Siemens Desiro ML (class 4746, "Cityjet") in VMOBIL livery: each car on its own two bogies; also set for the KISS, built the same way. */
let DESIRO = false;
/** The RhB's Stadler Allegra (ABe 8/12): a metre-gauge articulated EMU, built with the Desiro ML's car and nose code. */
let ALLEGRA = false;
/** The Desiro ML's car and nose code (the Desiro ML, the KISSes and the Allegra). */
let DESIRO_LOOK = false;
/** ÖBB's Stadler KISS double-decker ("Cityjet"): DESIRO is set too. */
let KISS = false;
/**
 * The 423's cars, front to back: length (joint to joint, or to the cab's face), and
 * whether there's a cab at the front (+x) / rear (−x). Set by deriveStock.
 */
let S423_CARS: S423Car[] = [];
/** One 423 car: length, offset from the front car's centre, cabs, and its pantographs. */
type Panto = 'raised' | 'folded' | null;
interface S423Car {
  len: number;
  offset: number;
  cabFront: boolean;
  cabRear: boolean;
  /** Pantograph at the front / rear end of the body, if any. */
  pantoFront: Panto;
  pantoRear: Panto;
  /** A car of the multiple unit (the default), or (RhB) a loco-hauled coach or a driving trailer behind it. */
  kind?: 'emu' | 'coach' | 'cabCar';
}
/** Gap between the cab faces of two coupled units (each automatic coupler sticks out 0.35 m). */
const S423_UNIT_GAP = 0.7;
/** The multiple units' wheel radius (850 mm wheels). */
const S423_WHEEL_R = 0.425; // 850 mm wheels

/**
 * How `n` FLIRT cars are formed into units (front first). Up to 6 cars: one unit.
 * Beyond that, units of 3–6 cars, judged by their worst unit first: lengths rank
 * 6, 3, 4, 5 (best to worst; another ranking can be given, as the KISS's), so the formation whose worst unit ranks best wins, then
 * the one whose next-worst does, and so on (then the fewest units); longer units in front.
 */
function flirtUnits(n: number, RANK: Record<number, number> = { 6: 0, 3: 1, 4: 2, 5: 3 }): number[] {
  if (n <= 6) return [n];
  return rankedUnits(n, RANK);
}

/**
 * `n` cars formed into units of the sizes RANK lists (rank 0 best), judged by their
 * worst unit first, then the next-worst and so on (then the fewest units); longer units in front.
 */
function rankedUnits(n: number, RANK: Record<number, number>): number[] {
  const sizes = Object.keys(RANK).map(Number).sort((a, b) => b - a);
  const worstFirst = (u: number[]) => u.map((x) => RANK[x]).sort((a, b) => b - a);
  const better = (a: number[], b: number[]) => {
    const ra = worstFirst(a);
    const rb = worstFirst(b);
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i] < rb[i];
    return ra.length < rb.length;
  };
  let best: number[] | null = null;
  const search = (left: number, max: number, acc: number[]) => {
    if (left === 0) {
      if (!best || better(acc, best)) best = [...acc];
      return;
    }
    for (const len of sizes) if (len <= max && len <= left) search(left - len, len, [...acc, len]);
  };
  search(n, sizes[0], []);
  return best ?? [n];
}

/** How the Allegra's units rank, best first: 3 cars (as built), then 4, 2, 1. */
/** (Allegra) Where the roof's grey starts, above the rails (the arch below it is red). */
const ALLEGRA_GREY_FROM = 3.15;
const ALLEGRA_UNIT_RANK: Record<number, number> = { 3: 0, 4: 1, 2: 2, 1: 3 };

/**
 * How `n` cars are formed into units (front first; the S-Bahn and the Desiro ML). Up to 5 cars: one unit. From 6:
 * ceil(n / 4) units of 4 or 3 cars (as many 4s as needed, as equal as possible),
 * longer units in front.
 */
function s423Units(n: number): number[] {
  if (n <= 5) return [n];
  const k = Math.ceil(n / 4);
  const fours = n - 3 * k;
  return Array.from({ length: k }, (_, i) => (i < fours ? 4 : 3));
}
/**
 * Per type: the body (heights, nose length, gap at the joints, width), how much
 * longer an end car is than a middle car to fit the cab (423: 18.24 vs 15.46 m),
 * and the cab-end bogie centre, in from the car's front face.
 */
const EMU_SPECS = {
  // (423: body bottom 0.76 m above the rails, level with the platforms, as on the drawing)
  s423: { dim: { bodyBottom: RAIL_TOP + 0.76, eaves: RAIL_TOP + 3.45, roofRise: 0.35, nose: 1.5, jointGap: 0.6, width: 3.0 }, cabExtra: 2.78, endBogie: 3.1 },
  // (the FLIRT's nose: the 423's shape and gradient, scaled to its lower side)
  flirt: { dim: { bodyBottom: RAIL_TOP + 1.0, eaves: RAIL_TOP + 3.55, roofRise: 0.6, nose: (1.5 * 2.3) / 2.45, jointGap: 0.6, width: 2.88 }, cabExtra: 4.1, endBogie: 3.6 },
  // (the BRB's LINT 54: each car has a cab; with the default length a two-car set is
  // 54.27 m over the couplers, as the real one)
  lint: { dim: { bodyBottom: RAIL_TOP + 1.0, eaves: RAIL_TOP + 3.4, roofRise: 0.4, nose: (1.5 * 2.4) / 2.45, jointGap: 0.6, width: 2.93 }, cabExtra: 3.0, endBogie: 3.3 },
  // (the Desiro ML, from a side view scaled to its 4.24 m height at the cab, whose roof
  // stands DESIRO_L.cabRaise above the flat roof: body bottom 1.0 m over the bogies (low
  // floor between them, down to DESIRO_L.skirt), flat roof 3.79 m;
  // with the default length a three-car unit is about 75 m, as the real class 4746)
  desiro: { dim: { bodyBottom: RAIL_TOP + 1.0, eaves: RAIL_TOP + 3.44, roofRise: 0.35, nose: 2.0, jointGap: 0.7, width: 2.82 }, cabExtra: 1.45, endBogie: 4.1 },
  // (the Allegra, from a side view: roof 3.65 m, 2.65 m wide; with the default length a
  // three-car unit is about 49 m, as the real ABe 8/12)
  // (the roof's arch from level with the driver's door top (2.83 m), just above the windows, red up to 3.15 m and grey above
  // to the 3.65 m top, as on the drawing: ALLEGRA_GREY_FROM)
  allegra: { dim: { bodyBottom: RAIL_TOP + 0.84, eaves: RAIL_TOP + 2.83, roofRise: 0.82, planRound: 0 /* (its nose rounds in plan by its own semi-ellipse) */, nose: 1.37 /* (the flat side starts here; the driver's door's front handle 6.5 cm behind it) */, jointGap: 0.6, width: 2.65 }, cabExtra: 1.6, endBogie: 3.0 },
  // (the KISS: the upper deck's roof about a semicircle from the upper windows' bottom
  // (3.25 m) up to 4.6 m, as is the nose; the single-deck ends' flat roof at 4.2 m; body
  // bottom 0.85 m over the bogies)
  kiss: { dim: { bodyBottom: RAIL_TOP + 0.85, eaves: RAIL_TOP + 3.25, roofRise: 1.35, planRound: 0.45, nose: 2.4, jointGap: 0.7, width: 2.8 }, cabExtra: 1.2, endBogie: 5.0 },
};
/**
 * How far a nose's corners are rounded back in plan: as much as the roof's rise, except
 * where the roof is far more arched than the front is rounded (the KISS: planRound).
 */
const noseRound = () => (S423_DIM as { planRound?: number }).planRound ?? S423_DIM.roofRise;
/** The current type's values (set by deriveStock). */
let S423_DIM = EMU_SPECS.s423.dim;
let S423_CAB_EXTRA = EMU_SPECS.s423.cabExtra;
let S423_END_BOGIE = EMU_SPECS.s423.endBogie;
/** Length of body behind each nose that belongs to the cab (where the driver's door is). */
let S423_CAB_BODY = S423_CAB_EXTRA - S423_DIM.nose;
/** The 423's lower side stripes (above the body bottom): dark grey skirt, then a narrow silver band. */
// (423 heights above the body bottom, as measured off the drawing)
const S423_STRIPES = { dark: 0.27, silver: 0.46, colorDark: 0x4a4f55 };
/** Half-width (as a fraction) of the 423's dark grey roof stripe: as wide as the front panel. */
const S423_ROOF_STRIPE_U = 0.8;
/** The 423's thin grey stripe above the windows (top edge level with the doors' tops, above the body bottom). */
const S423_TOP_STRIPE = { top: 2.44, h: 0.11 };
/** The 423's passenger doors: total width (two leaves) and each leaf's window width. */
const S423_DOOR = { w: 1.56, paneW: 0.42 };
/** The 423's pillar between the two windows of a bay, and the cab door's centre and bottom (from the nose tip / body bottom). */
const S423_LAYOUT = { pillar: 0.8, cabDoorX: 1.8, cabDoorBottom: 0.65 };
/** The 423's passenger windows: height, and centre above the body bottom. */
const S423_WIN = { h: 1.03, centre: 1.57 };
/** BRB FLIRT livery: light grey body, blue window band and roof curves, yellow doors. */
const BRB = { grey: 0xc3c8cc, blue: 0x1f4e9c, yellow: 0xf2cf1d };
/** The driver's door: its width, and (FLIRT) its gap from where the nose begins. */
const FLIRT_DRIVER_DOOR = { w: 0.65, centre: 2.56 }; // (centre: from the nose tip, as on the drawing) // (as wide as one leaf of its passenger doors)
/** The FLIRT's blue band (above the body bottom): from just below to just above the windows. */
const FLIRT_BAND = { bottom: 0.5, top: 1.85 }; // (from the lowest windows' bottoms to the highest's tops)
/** Where the blue begins across the FLIRT's nose front, above the body bottom (higher than the band, leaving grey for the lights). */
const FLIRT_NOSE_BLUE = 0.8;
/** Bottom of the FLIRT's passenger doors, above the rails (in the low-floor part, below the body bottom). */
const FLIRT_DOOR_BOTTOM = 0.7;
/** FLIRT passenger doors (from the drawing): width, and each leaf's window (width, centre from the door's middle, bottom and top above the rails). */
const FLIRT_DOOR = { w: 1.45, paneW: 0.38, paneX: 0.4, pane: [1.6, 2.85] };
/**
 * FLIRT side windows (from the drawing): width, pillar between, the gaps to the doors and to the body's end at a gangway, and heights above the
 * rails: low-floor, raised-floor (between a cab and its door) and the driver's door's window.
 */
const FLIRT_WIN = { w: 1.4, pillar: 0.46, doorGap: 0.43, jointEnd: 0.64, low: [1.5, 2.6], high: [1.85, 2.85], driver: [2.3, 3.05] };
/** The FLIRT's low-floor middle: its side skirt comes down to this height above the rails between the bogies. */
const FLIRT_SKIRT = RAIL_TOP + 0.6;
/** Bottom of the FLIRT's black nose skirt, above the rails. */
const FLIRT_NOSE_SKIRT = 0.5;
/** How far the FLIRT's black nose panel reaches above the coupler (which is level with the body bottom). */
const FLIRT_BLACK_ABOVE = 0.43;
/** Top of the blue line along the bottom of the FLIRT's low-floor skirt, above the rails. */
const FLIRT_SKIRT_LINE = 0.86;
/** Height above the rails of the FLIRT skirt's flat shelf over a shared bogie's centre. */
const FLIRT_SKIRT_SHELF = 0.9;
/** BRB LINT livery: white sides, blue along the top and a blue skirt, red doors (heights above the body bottom). */
// (heights measured off a photo of the BRB's LINT 54, scaled to this body)
// (the lower blue is all in the skirts, below the body: none of it shows above the wheels)
const LINT_LIVERY = { white: 0xffffff, red: 0xd2232a, topStripe: 2.28 };
/** Bottom of the LINT's side windows (outside the doors), above the body bottom. */
const LINT_WIN_BOTTOM = 1.08;
/** The LINT's passenger doors' width (including the red frame, as measured off the photo). */
const LINT_DOOR_W = 1.65;
/** The LINT's roof stripe: the dark grey of the 423's skirt. */
const LINT_ROOF_GREY = S423_STRIPES.colorDark;
/**
 * The LINT's front: the dividing line's height round the front (above the body bottom;
 * on the flanks it rises diagonally to the cab window's back corner), and the half-width
 * (as a fraction) of the black panel under the windscreen and of the white panel above
 * the line, up to the windscreen.
 */
const LINT_FRONT = { line: 0.68, screenBottom: LINT_WIN_BOTTOM, screenU: 0.72, blackU: 0.72, whiteU: 0.72 }; // (all as wide as the windscreen)

/** Railjet colours: Pantone 1807 C for the dark reds, Pantone 186 C for the bright red. */
const RJ = { red: 0xa4343a, bright: 0xc8102e, anthracite: 0x2b2d30, silver: 0xbfc3c7, lettering: 0xd9dcdf };

/**
 * ÖBB Desiro ML (VMOBIL) livery and layout, measured off a side view. Heights above the
 * rails; lengths along a car as measured (the picture is stretched lengthways, so they're
 * scaled by a car's length).
 */
const DESIRO_ML = {
  white: 0xe6e5df, red: 0xe53b36, orange: 0xec5638, black: 0x1b1b1c, roof: 0xc5c7c9, lettering: 0x4b4d50, logo: 0xe2231a,
  /** Side bands: red, then orange-red, then red, then black down to the body's bottom. */
  redTop: 2.59, orangeTop: 2.05, orangeBottom: 1.43, blackTop: 1.16,
  /** Windows towards the car ends, and the lower strip between the doors. */
  win: [1.88, 2.99], strip: [1.52, 2.62], winW: 1.84, pillar: 0.43, endGap: 0.76, doorGap: 0.84, stripGap: 0.68,
  /** Doors: width, top, each leaf's window (width, centre from the door's middle, bottom and top). */
  door: { w: 1.4, top: 3.29, paneW: 0.44, paneX: 0.36, pane: [1.8, 3.06] },
  /** Door centres in from each body end, as a fraction of a middle car's body. */
  doorInset: 0.271,
  /** Closest two doors may be (centre to centre): a door's width plus room for one window between. */
  minDoorPitch: 4.0,
  /** Bogie centres in from a car's end (at a gangway), and their wheelbase. */
  bogieIn: 3.5, wheelbase: 2.2,
  /** Nose: the windscreen's bottom. */
  screenBottom: 2.32,
  /** The driver's side window: from / to (in from the nose tip), bottom / top. */
  driverWin: { x: [2.2, 2.8], y: [2.54, 3.22] },
  coupler: 1.1, lamps: 1.74,
  /** Low floor: the side comes down to this between the bogies (black, diagonal at its ends). */
  skirt: 0.71,
  /** Bottom of the black nose skirt. */
  noseSkirt: 0.4,
  /** The cab's arched roof: its eaves this much above the arch-less body's (its top 0.45 m above the flat roof), over the nose and `hump` behind it, then dropping straight down. */
  cabRaise: 0.45, hump: 1.0,
  /** Cap height of the lettering between the doors, and how far above the strip it sits. */
  letterCap: 0.6, letterGap: 0.06,
  /** Double-deckers (the KISS): the upper deck's window strip (bottom, top), from door centre to door centre. */
  upperStrip: null as number[] | null,
  /** Double-deckers: the single-deck ends' flat roof height, and how far the deck's arched roof (as high as the nose) reaches beyond the doors' outer edges at a gangway end, where it drops straight down. */
  deck: null as { endTop: number; beyondDoor: number } | null,
  /** An air-conditioning box in the middle of the roof. */
  roofBox: true,
  /** An arched roof all along, matching the nose's top (rather than a flat one). */
  archedRoof: false,
  /** Doors of a single leaf (one window, centred) rather than a pair. */
  singleLeaf: false,
  /** The doors in a black border like the side windows' (their tops level with them). */
  doorBorder: false,
  /** The doors' colour (null: the livery's black). */
  doorColor: null as number | null,
  /** (Allegra) A big cab side window and a driver's door behind it: centre in from the nose tip, width, bottom / top; and the window's bottom / top. */
  cabDoor: null as { centre: number; w: number; y: number[]; win: number[] } | null,
  /** The skirt in the body's lowest colour, with a grey band this deep along its bottom (the doors stop on it); null: all black. */
  skirtBand: null as { h: number; color: number } | null,
  /** Doors in the body's colours (its bands carried across them), outlined in white, rather than plain black. */
  outlinedDoors: false,
};

/**
 * ÖBB Cityjet KISS (Stadler double-decker), from a side view scaled to its 4.6 m height:
 * the Desiro ML's layout and livery (cars on their own bogies, two doors a quarter of
 * the way in, a low floor between the bogies), with an upper deck between the doors:
 * a raised roof and a second window strip; single-deck ends over the bogies.
 */
const KISS_L: typeof DESIRO_ML = {
  ...DESIRO_ML,
  lettering: 0xa9adb1,
  // (no black band at the body's bottom (0.85 m): the red runs on down the skirt to its grey band)
  redTop: 2.19, orangeTop: 1.83, orangeBottom: 1.19, blackTop: 0.85,
  win: [2.04, 2.88], strip: [1.13, 2.0], winW: 1.2, pillar: 0.45, endGap: 0.9, doorGap: 0.6, stripGap: 0.68,
  door: { w: 1.5, top: 2.77, paneW: 0.45, paneX: 0.38, pane: [1.15, 2.6] },
  bogieIn: 3.3, wheelbase: 2.6,
  screenBottom: 2.5,
  driverWin: { x: [2.3, 3.9], y: [2.2, 3.0] },
  coupler: 1.05, lamps: 1.5,
  skirt: 0.3, noseSkirt: 0.35,
  cabRaise: 0, hump: 0,
  letterCap: 0.5, letterGap: 0.15,
  upperStrip: [3.25, 4.0],
  skirtBand: { h: 0.35, color: 0x565857 },
  deck: { endTop: 4.2, beyondDoor: 3.0 },
  roofBox: false,
};
/**
 * ÖBB's Railjet KISS: the Cityjet KISS in Railjet colours: dark red above, a bright
 * red stripe along the bottom of the upper body, anthracite below it and on the roof
 * and doors, the lettering in bright red.
 */
const KISS_RJ_L: typeof DESIRO_ML = {
  ...KISS_L,
  white: RJ.red, red: RJ.bright, orange: RJ.anthracite, black: RJ.anthracite, roof: RJ.anthracite,
  // (the lettering white, so it shows up against the dark red; the logo bright red)
  lettering: 0xffffff, logo: RJ.bright,
  orangeBottom: KISS_L.blackTop, // (no lower red band: anthracite all the way down)
  singleLeaf: true,
  outlinedDoors: true,
  // (its window measured off a photo of the leaf: 43% of its width, centred, from 16%
  // below the door's top to 37% above its bottom)
  door: (() => {
    const d = KISS_L.door;
    const bottom = KISS_L.skirt + (KISS_L.skirtBand?.h ?? 0);
    const h = d.top - bottom;
    return { ...d, paneW: 0.43 * d.w, paneX: 0, pane: [bottom + 0.37 * h, d.top - 0.16 * h] };
  })(),
};

/**
 * The RhB's Allegra: red all over with a thin light line along the bottom, a light grey
 * roof, dark grey skirts, light grey single-leaf doors (a window high in the middle).
 */
const ALLEGRA_L: typeof DESIRO_ML = {
  ...DESIRO_ML,
  white: 0xd71f2b, red: 0xd71f2b, orange: 0xd9dadb, black: 0x4a4e52, roof: 0xb9bcbe, lettering: 0xffffff, logo: 0xffffff,
  // (measured off a side view: the light line 0.97–1.03 m; the red down to 0.84 m over the
  // bogies, 0.47 m between them, a dark skirt below to 0.25 m)
  redTop: 2.8, orangeTop: 1.03, orangeBottom: 0.97, blackTop: 0.84,
  win: [1.65, 2.8], strip: [1.65, 2.8], winW: 1.4, pillar: 0.15, endGap: 0.7, doorGap: 0.6, stripGap: 0.6,
  door: { w: 1.0, top: 2.95, paneW: 0.45, paneX: 0, pane: [1.85, 2.7] },
  doorBorder: true,
  wheelbase: 2.2,
  screenBottom: 1.9,
  // (driverWin: where the passenger windows may start, behind the driver's door)
  driverWin: { x: [2.9, 3.6], y: [2.0, 2.8] },
  // (level with the RhB coaches' couplers, which it couples to)
  coupler: 0.61, lamps: 1.25,
  skirt: 0.25, noseSkirt: 0.25,
  skirtBand: { h: 0.22, color: 0x4a4e52 },
  cabRaise: 0, hump: 0,
  letterCap: 0.22, letterGap: 0.06,
  singleLeaf: true,
  doorColor: 0xa9adb0,
  // (the driver's door: 1.37–2.05 m from the nose tip, 1.06–2.83 m up, its window 1.65–2.76 m,
  // from the side drawing)
  cabDoor: { centre: 1.855 /* (its front handle centred between where the nose's curve starts and the door's border: 6.5 cm from each) */, w: 0.68, y: [1.06, 2.83], win: [1.65, 2.76] },
  roofBox: false,
  archedRoof: true,
};

/**
 * The RhB's loco-hauled stock behind a long Allegra: EW II coaches and an ABt
 * (1701–1704) driving trailer. Heights above the rails; lengths along a car. Red, a
 * light grey band under the windows, a silver arched roof, silver doors near the ends.
 */
const RHB = {
  red: 0xd71f2b, band: 0xd5d8da, roof: 0xc4c7ca, door: 0xb9bdc0, under: 0x3a3d41,
  // (from a side photo: the body comes down to just over the wheels, which are small)
  bodyBottom: 0.5, eaves: 3.2, roofRise: 0.33, width: 2.65, wheelR: 0.29,
  band0: 1.6, band1: 1.68, win: [1.8, 2.8], winW: 1.05, pillar: 0.55,
  /** Doors: centre in from the coach's end (the driving trailer's behind its cab), width, top. */
  doorIn: 0.8, cabDoorIn: 2.3, doorW: 0.95, doorTop: 2.95,
  /** How far the doors are set back into the body. */
  doorIndent: 0.25,
  /** Bogie centres in from the ends, and their wheelbase. */
  bogieIn: 2.6, wheelbase: 1.9,
  /** Coupler height (its centre): its bottom level with the body's bottom (it's 0.22 m deep). */
  coupler: 0.61,
  /** Bottom of the gangways between coaches: just above the couplers. */
  gangwayBottom: 0.8,
};
/** An EW II coach's length (18.5 m), scaled with the chosen car length (the Allegra's 15.3 m by default). */
const rhbCoachLength = (L: number) => (L * 18.5) / 15.3;

/** How the KISS's units rank, best first, for flirtUnits: as the FLIRT's, but 4 before 3. */
const KISS_UNIT_RANK: Record<number, number> = { 6: 0, 4: 1, 3: 2, 5: 3 };
/** The current type's (Desiro ML or KISS; set by deriveStock). */
let DESIRO_L = DESIRO_ML;

/** Gap between a Desiro ML wheel and the top of the low-floor skirt's diagonal end. */
const DESIRO_SKIRT_CLEAR = 0.35;

/** How `n` LINT cars are formed into sets (front first): two-car sets, and a single car if odd. */
function lintUnits(n: number): number[] {
  return [...Array(Math.floor(n / 2)).fill(2), ...(n % 2 ? [1] : [])];
}

/**
 * The Railjet's bright red stripe runs along the whole train at one height: centred
 * on the bottom edge of the coaches' black window surround (window bottoms at floor
 * 1.722 m + 1.07 m, surround 0.06 m below), and carried on along the locomotive.
 */
const RJ_WINDOW_MARGIN = 0.06;
const RJ_STRIPE_Y = 1.722 + 1.07 - RJ_WINDOW_MARGIN;
const RJ_STRIPE_H = 0.3;
let ACTIVE_LOCO_WIDTH = 0;
let ACTIVE_LOCO_PIVOT = 0;
/** Electric locos don't make steam. */
let HAS_STEAM = true;
/** Half-width of the ballast bed under the track (the tunnel bore matches it). */
/**
 * Half-width of the gravel bed, which is also where the platform edges are (and the
 * tunnel bore's half-width). Set by buildWorld for the active ring: half the widest
 * vehicle, plus how far its body is pulled in towards the inside of the curve,
 * plus a little clearance.
 */
let BALLAST_HALF = 1.743;

interface Station {
  name: string;
  angle: number;
  group: THREE.Group;
  figure: THREE.Group;
  accentMat: THREE.MeshStandardMaterial;
  sign: THREE.Sprite;
  /** Station name painted on the front wall. */
  wallLabel: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** The same on both end walls (one shared geometry, narrower to fit). */
  sideLabels: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  /** Name the wall lettering was last built for. */
  wallLabelName?: string;
  /** DB name boards on posts behind the platform, one either side of the building (rear first: local −x, then +x). */
  boards: THREE.Group[];
  color: number;
  mode: SignMode | null;
}

interface Run {
  from: number;
  delta: number;
  duration: number;
  t: number;
  /** null for the opening run out of the tunnel to the home station. */
  winner: Station | null;
  /** 'trip': pull away, cruise, brake. 'brake': already moving, just brakes to a stop. */
  profile: 'trip' | 'brake';
  /** Whether the camera has gone down to the platform for the arrival (see platformView). */
  platformShown?: boolean;
}

/** Set by buildWorld: the train's resting spot at the home station, and the tunnel mouth. */
let homeStartS = 0;
let tunnelMouthX = -Infinity;
/** x where the lead-in leaves the straight and curves 90° (radius R) inside the tunnel. */
let tunnelCurveX = -Infinity;

interface Car {
  obj: THREE.Group;
  /** The car's extent in its own frame (for keeping the camera out of it). */
  localBox?: THREE.Box3;
  offset: number; // distance behind the locomotive centre, along the track
  wheels: THREE.Object3D[];
  rods: Rod[];
  /** Locomotive only: piston, crosshead and connecting rod on each side. */
  drive?: Drive[];
  /**
   * Half the distance between the points that carry the body on the track: its
   * bogie centres (for the locomotive, the ends of its fixed driving wheelbase).
   * The body spans between them, so on a curve its middle sits inside the track.
   */
  pivot: number;
  /** Optional asymmetric pivots (front / back of centre), e.g. the 423's end cars. */
  pivotFront?: number;
  pivotBack?: number;
  /** Carriage only: its front buffers, which compress against the locomotive's. */
  buffers?: SprungBuffer[];
}

interface SprungBuffer {
  z: number;
  shaft: THREE.Object3D; // unit-length along x, scaled to the plunger's length
  head: THREE.Object3D;
}

interface Drive {
  side: number;
  phase: number; // crank angle offset of this side (matches its coupling rod)
  axleX: number; // the driving axle the connecting rod works on
  axleY: number;
  radius: number; // driving wheel radius (sets how fast the cranks turn)
  crank: number;
  conRod: number;
  cylinderBack: number;
  crosshead: THREE.Object3D;
  pistonRod: THREE.Object3D;
  conRodMesh: THREE.Object3D;
}

interface Rod {
  mesh: THREE.Mesh;
  phase: number; // crank angle offset for this side
  midX: number;
  z: number;
  y: number; // axle height
  radius: number; // wheel radius
  crank: number;
}

const state = {
  names: loadNames(),
  picked: new Set<string>(),
  removeAfterPick: false,
  radius: 20.5,
  /**
   * Locomotive position as distance along the track. Negative values are on the
   * straight lead-in, which joins the ring at s = 0 (the far point, z = -R);
   * from there the train runs anticlockwise round the ring.
   */
  s: 0,
  /**
   * Where the train is, independent of its length and the layout's size (s is
   * derived from this whenever the layout is built). Measured at the train's
   * midpoint: on the ring as degrees from the points in the direction of travel; on
   * the branch between landmarks (−2 end of the tunnel, −1 tunnel mouth, 0 at the home
   * station, 1 the points), evenly by distance between them.
   */
  pos: { on: 'branch', b: 0 } as TrainPos,
  run: null as Run | null,
  winner: null as Station | null,
};

const circumference = () => TAU * state.radius;

type TrainPos = { on: 'ring'; deg: number } | { on: 'branch'; b: number };
/** Branch landmarks as track distances of the train's midpoint, for b = −2, −1, 0, 1 (set by buildWorld). */
let branchMarks = [-60, -40, -20, 0];

/** Track distance of the locomotive's centre for a position. */
function posToS(p: TrainPos): number {
  let mid: number;
  if (p.on === 'ring') mid = (mod(p.deg, 360) / 180) * Math.PI * state.radius;
  else {
    const m = branchMarks;
    const k = THREE.MathUtils.clamp(Math.floor(p.b) + 2, 0, 2); // which landmark span (extrapolates past the ends)
    mid = m[k] + (m[k + 1] - m[k]) * (p.b - (k - 2));
  }
  return mid + LOCO_AHEAD;
}

/** Position for a track distance of the locomotive's centre. */
function sToPos(s: number): TrainPos {
  const mid = s - LOCO_AHEAD;
  if (mid >= 0) return { on: 'ring', deg: mod((mid / state.radius) * (180 / Math.PI), 360) };
  const m = branchMarks;
  let k = 0;
  while (k < 2 && mid > m[k + 1]) k++;
  return { on: 'branch', b: k - 2 + (mid - m[k]) / (m[k + 1] - m[k]) };
}

/** A station's position on the ring, in degrees from the points. */
const stationDeg = (st: Station) => mod(((st.angle - JOIN_ANGLE) * 180) / Math.PI, 360);
/**
 * Where the train waits on the lead-in before its first run: alongside the home
 * station. The station sits at least a full train length (ramp foot to first
 * junction sleeper) back from the points, and also far enough left that it
 * doesn't overlap, from the camera's view, the ring stations at the back.
 */
function startS(R: number, stationS: number[]): number {
  let rightFoot = junctionStart(R) - SLEEPER_PITCH - TRAIN_LENGTH;
  for (const sc of stationS) {
    const a = JOIN_ANGLE + sc / R;
    if (Math.sin(a) > -0.7) continue; // only stations on the back of the ring
    const minX = Math.min(R * Math.cos(a - STATION_HALF() / R), R * Math.cos(a + STATION_HALF() / R));
    rightFoot = Math.min(rightFoot, minX - 3.075);
  }
  return rightFoot - STATION_HALF() + LOCO_AHEAD;
}
/** Ring angle of the junction with the lead-in (the point furthest from the camera). */
const JOIN_ANGLE = -Math.PI / 2;
/** Track distance (on the ring) of a given ring angle. */
const ringS = (angle: number) => mod(state.radius * (angle - JOIN_ANGLE), circumference());

/** Replaces the layout's track (the fleet page lays its trains on a straight line). */
let trackOverride: ((s: number) => { x: number; z: number; yaw: number }) | null = null;

/** Position and heading of a point at distance s along the track. */
function trackPose(s: number): { x: number; z: number; yaw: number } {
  if (trackOverride) return trackOverride(s);
  const R = state.radius;
  if (s < tunnelCurveX) {
    // Curve inside the tunnel, centred on (tunnelCurveX, 0): bends round to the
    // +z side going in, so coming out the train swings round onto the straight.
    const phi = -Math.PI / 2 + (s - tunnelCurveX) / R;
    return { x: tunnelCurveX + R * Math.cos(phi), z: R * Math.sin(phi), yaw: tangentYaw(phi) };
  }
  if (s < 0) return { x: s, z: -R, yaw: 0 }; // straight, heading +X
  const a = JOIN_ANGLE + s / R;
  return { x: R * Math.cos(a), z: R * Math.sin(a), yaw: tangentYaw(a) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadNames(): string[] {
  const fromUrl = new URLSearchParams(location.search).get('names');
  if (fromUrl) {
    const parsed = parseNames(fromUrl);
    if (parsed.length) return parsed;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseNames(stored);
      if (parsed.length) return parsed;
    }
  } catch {
    /* storage unavailable */
  }
  return [...DEFAULT_NAMES];
}

function saveNames(names: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, names.join('\n'));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Names from a list (one per line, or comma-separated), trimmed and without repeats. A
 * name typed with a space after it keeps one trailing space: that person has a station
 * but is never picked (see neverPicked).
 */
function parseNames(text: string): string[] {
  const seen = new Set<string>();
  return text
    .replace(/\r/g, '')
    .split(/[\n,]/)
    .map((s) => {
      const name = s.trim();
      return name && /[ \t]$/.test(s) ? `${name} ` : name;
    })
    .filter((s) => s && !seen.has(s.trim()) && (seen.add(s.trim()), true));
}

/** Whether a name was typed with a trailing space: a station, but never picked. */
const neverPicked = (name: string) => name.endsWith(' ');

/** Unbiased random integer in [0, n) using the crypto RNG. */
function randInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

/** Deterministic PRNG so scenery doesn't jump around on rebuild. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

function mat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

/** Cylinder whose axis runs along X. */
function cylX(r: number, len: number, material: THREE.Material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.CylinderGeometry(r, r, len, 24).rotateZ(Math.PI / 2), material, x, y, z);
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Sprite || o instanceof THREE.InstancedMesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}

/** Rotation that points an object's local +X along the track tangent at angle a. */
const tangentYaw = (a: number) => -a - Math.PI / 2;

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
/**
 * Draw at the display's pixel density (2× on Retina screens, 3× on most phones), and
 * follow it when the window moves to a screen with another density or the page is zoomed.
 */
function matchPixelRatio(): void {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 3));
  renderer.setSize(innerWidth, innerHeight);
  const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  query.addEventListener('change', matchPixelRatio, { once: true });
}
matchPixelRatio();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3ff);
scene.fog = new THREE.Fog(0xbfe3ff, 102.5, 266.5);

/** The camera's usual near plane. */
const CAMERA_NEAR = 1.025;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, CAMERA_NEAR, 820);
function setCameraNear(near: number): void {
  if (camera.near === near) return;
  camera.near = near;
  camera.updateProjectionMatrix();
}
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 10.25;
// Pan across the ground rather than in screen space, so panning never drags the
// view's focus point up or down into the ground.
controls.screenSpacePanning = false;

/** Ground height lookup for the current layout (set by buildWorld). */
let groundHeight: (x: number, z: number) => number = () => 0;
const CAMERA_CLEARANCE = 2.46;

/**
 * Keep the view out of the ground: the focus point stays at ground level and
 * within reach of the layout, and the camera stays above the terrain (including
 * the hill), however you pan, zoom or orbit.
 */
function clampCamera(): void {
  const t = controls.target;
  t.y = 0;
  const maxR = state.radius * 2 + 20.5;
  const r = Math.hypot(t.x, t.z);
  if (r > maxR) t.multiplyScalar(maxR / r).setY(0);
  const minY = groundHeight(camera.position.x, camera.position.z) + CAMERA_CLEARANCE;
  if (camera.position.y < minY) camera.position.y = minY;
  // Moving it yourself, it stays out of solid things too (not on automated moves:
  // flights, the platform's arrival shot, the driver's view)
  if (!flight && cameraView !== 'driver') keepCameraOutside();
}

/** Trees, as upright cylinders (set by makeForest): position, radius and top. */
type TreeCollider = { x: number; z: number; r: number; top: number };
/** The trees, bucketed by TREE_CELL-sized squares of ground (so a check looks at a handful, not thousands). */
let treeGrid = new Map<string, TreeCollider[]>();
const TREE_CELL = 10;
/**
 * How far the camera keeps from any solid thing: more than the near plane reaches out
 * to the corners of the view (else a wall just in front would be cut away and show
 * what's behind it), plus a little.
 */
function cameraGap(): number {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return camera.near * Math.sqrt(1 + t * t * (1 + camera.aspect * camera.aspect)) + 0.15;
}
const colliderPoint = new THREE.Vector3();

/**
 * Whether a point is inside (or within cameraGap() of) something solid: a train car or a
 * station building (boxes in their own frames) or a tree (a cylinder). Smoke, rain,
 * snow and confetti don't count.
 */
function insideSolid(p: THREE.Vector3): boolean {
  const g = cameraGap();
  // (trees: only those in the camera's grid cell and its neighbours)
  const cx = Math.floor(p.x / TREE_CELL);
  const cz = Math.floor(p.z / TREE_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const t of treeGrid.get(`${cx + i},${cz + j}`) ?? []) {
        if (p.y < t.top + g && (p.x - t.x) ** 2 + (p.z - t.z) ** 2 < (t.r + g) ** 2) return true;
      }
    }
  }
  for (const c of cars) {
    if (!c.localBox) continue;
    c.obj.worldToLocal(colliderPoint.copy(p));
    if (c.localBox.distanceToPoint(colliderPoint) < g) return true;
  }
  const { w, h, d, z } = BUILDING;
  for (const st of [...stations, ...(homeStation ? [homeStation] : [])]) {
    if (!st.group.visible) continue;
    st.group.worldToLocal(colliderPoint.copy(p));
    const q = colliderPoint;
    if (Math.abs(q.x) < w / 2 + 0.3 + g && q.y < h + d / 2 + 0.5 + g && Math.abs(q.z - z) < d / 2 + 0.3 + g) return true;
  }
  return false;
}

/**
 * If the camera has gone into something solid, back it straight out away from its
 * focus (as zooming out would) until it's clear.
 */
function keepCameraOutside(): void {
  const p = camera.position;
  if (!insideSolid(p)) return;
  const dir = p.clone().sub(controls.target);
  const dist = dir.length();
  if (dist < 1e-6) return;
  dir.divideScalar(dist);
  const probe = new THREE.Vector3();
  for (let step = 0.2; dist + step <= controls.maxDistance; step += 0.2) {
    probe.copy(controls.target).addScaledVector(dir, dist + step);
    if (!insideSolid(probe)) {
      p.copy(probe);
      return;
    }
  }
}
controls.addEventListener('change', clampCamera);
controls.maxDistance = 246;

const hemi = new THREE.HemisphereLight(0xffffff, 0x5a7d3a, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
sun.position.set(36.9, 61.5, 24.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.041;
scene.add(sun);

const groundMat = mat(0x7cc56b, { roughness: 1 });
/** Lying snow (roofs, tree caps). */
const snowWhite = mat(0xf4f7fa, { roughness: 0.9 });

// Weather (?weather=snow|rain, or the Environment radio buttons). Snow: white
// ground, snow on the trees and roofs, an overcast sky and snow falling round the
// camera. Rain: a dull grey sky, dark wet grass and rain streaks.
type Weather = 'clear' | 'snow' | 'rain';
const parseWeather = (v: string | null): Weather => (v === 'snow' || v === 'rain' ? v : 'clear');
let weather = parseWeather(new URLSearchParams(location.search).get('weather'));
const LOOK: Record<Weather, { sky: number; ground: number; hemiGround: number; hemi: number; sun: number }> = {
  clear: { sky: 0xbfe3ff, ground: 0x7cc56b, hemiGround: 0x5a7d3a, hemi: 1.4, sun: 2.4 },
  snow: { sky: 0xd5dce3, ground: 0xe9eef3, hemiGround: 0xc9d2da, hemi: 1.5, sun: 1.5 },
  rain: { sky: 0x9fa9b3, ground: 0x5a8f4e, hemiGround: 0x46603a, hemi: 1.25, sun: 0.9 },
};
const FROST = new THREE.Color(0xdfe7ec);

/** Shows the current weather: colours, lights, snow-only objects, what's falling. */
function showWeather(): void {
  const snowOn = weather === 'snow';
  const look = LOOK[weather];
  (scene.background as THREE.Color).setHex(look.sky);
  scene.fog!.color.setHex(look.sky);
  groundMat.color.setHex(look.ground);
  hemi.groundColor.setHex(look.hemiGround);
  hemi.intensity = look.hemi;
  sun.intensity = look.sun;
  scene.traverse((o) => {
    if (o.userData.snowOnly) o.visible = snowOn;
  });
  {
    const c = new THREE.Color();
    for (const t of forestLeafTiles) {
      t.colors.forEach((leaf, i) => t.mesh.setColorAt(i, snowOn ? c.copy(leaf).lerp(FROST, 0.3) : leaf));
      t.mesh.instanceColor!.needsUpdate = true;
    }
  }
  snowfall.visible = snowOn;
  rainfall.visible = weather === 'rain';
}

/** Falling snow: flakes in a box that moves with the camera, wrapping round its edges. */
const FLAKES = 14000;
const SNOW_BOX = { w: 60, h: 36 };
const flakeBase = new Float32Array(FLAKES * 3);
const flakePhase = new Float32Array(FLAKES);
for (let i = 0; i < FLAKES; i++) {
  flakeBase[i * 3] = Math.random() * SNOW_BOX.w;
  flakeBase[i * 3 + 1] = Math.random() * SNOW_BOX.h;
  flakeBase[i * 3 + 2] = Math.random() * SNOW_BOX.w;
  flakePhase[i] = Math.random() * TAU;
}
const snowfall = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLAKES * 3), 3)),
  new THREE.PointsMaterial({
    size: 0.32,
    map: (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })(),
    transparent: true,
    depthWrite: false,
  }),
);
snowfall.frustumCulled = false;
snowfall.renderOrder = 10;
scene.add(snowfall);
let snowTime = 0;

/** Rain: short streaks (line segments) falling fast and slightly slanted, in a box round the camera. */
const DROPS = 10000;
const RAIN_BOX = { w: 44, h: 26 };
const DROP_LEN = 0.8;
const dropBase = new Float32Array(DROPS * 3);
for (let i = 0; i < DROPS * 3; i++) dropBase[i] = Math.random() * (i % 3 === 1 ? RAIN_BOX.h : RAIN_BOX.w);
const rainfall = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 6), 3)),
  new THREE.LineBasicMaterial({ color: 0xd8e2ea, transparent: true, opacity: 0.35, depthWrite: false }),
);
rainfall.frustumCulled = false;
rainfall.renderOrder = 10;
scene.add(rainfall);
const RAIN_VEL = new THREE.Vector3(1.2, -11, 0.6); // m/s
const rainDir = RAIN_VEL.clone().normalize().multiplyScalar(DROP_LEN);

function updateRainfall(dt: number): void {
  if (weather !== 'rain') return;
  snowTime += dt;
  const arr = (rainfall.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const cam = camera.position;
  const { w, h } = RAIN_BOX;
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  for (let i = 0; i < DROPS; i++) {
    const x = cam.x - w / 2 + wrap(dropBase[i * 3] + RAIN_VEL.x * snowTime - cam.x, w);
    const y = cam.y - h / 2 + wrap(dropBase[i * 3 + 1] + RAIN_VEL.y * snowTime - cam.y, h);
    const z = cam.z - w / 2 + wrap(dropBase[i * 3 + 2] + RAIN_VEL.z * snowTime - cam.z, w);
    arr.set([x, y, z, x - rainDir.x, y - rainDir.y, z - rainDir.z], i * 6);
  }
  rainfall.geometry.getAttribute('position').needsUpdate = true;
}

function updateSnowfall(dt: number): void {
  if (weather !== 'snow') return;
  snowTime += dt;
  const pos = snowfall.geometry.getAttribute('position') as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const cam = camera.position;
  const { w, h } = SNOW_BOX;
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  const fall = snowTime * 1.1; // m/s
  const drift = snowTime * 0.4; // a light breeze
  for (let i = 0; i < FLAKES; i++) {
    const ph = flakePhase[i];
    const sway = Math.sin(snowTime * 0.9 + ph) * 0.6;
    arr[i * 3] = cam.x - w / 2 + wrap(flakeBase[i * 3] + drift + sway - cam.x, w);
    arr[i * 3 + 1] = cam.y - h / 2 + wrap(flakeBase[i * 3 + 1] - fall * (0.8 + 0.4 * ((ph * 7) % 1)) - cam.y, h);
    arr[i * 3 + 2] = cam.z - w / 2 + wrap(flakeBase[i * 3 + 2] + Math.cos(snowTime * 0.7 + ph) * 0.6 - cam.z, w);
  }
  pos.needsUpdate = true;
}

/** Points that must be on screen in the default view (set by buildWorld). */
let fitPoints: THREE.Vector3[] = [];
/**
 * Viewing direction for the default shot: about 33° above the ground, swung 20°
 * round to the right of straight-on, so the lead-in runs diagonally from the
 * tunnel at the back left and the junction sits towards the right.
 */
const VIEW_AZIMUTH = THREE.MathUtils.degToRad(20);
const VIEW_DIR = new THREE.Vector3(2.1 * Math.sin(VIEW_AZIMUTH), 1.35, 2.1 * Math.cos(VIEW_AZIMUTH)).normalize(); // a direction: unitless
let userMovedCamera = false;
controls.addEventListener('start', () => {
  userMovedCamera = true;
  flight = null; // grabbing the view cancels any camera flight
});

/**
 * Aim at the centre of the ring, and back off just far enough that every corner
 * of the layout's bounding box is on screen (with a small margin).
 */
/**
 * The screen's safe area (clear of notches and rounded corners), as insets in pixels.
 * The scene is drawn under the whole screen, but placed (setViewOffset, inSafeArea) to
 * fit within this part of it. Read from env(safe-area-inset-*) via a probe element.
 */
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.append(safeProbe);
function safeInsets(): { l: number; r: number; t: number; b: number } {
  const cs = getComputedStyle(safeProbe);
  return { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
}
/** Centre the camera's view on the safe area: its middle is where the camera looks. */
function centreOnSafeArea(): void {
  const { l, r, t, b } = safeInsets();
  const w = innerWidth;
  const h = innerHeight;
  if (!l && !r && !t && !b) camera.clearViewOffset();
  else camera.setViewOffset(w + Math.abs(l - r), h + Math.abs(t - b), r > l ? r - l : 0, b > t ? b - t : 0, w, h);
  camera.updateProjectionMatrix();
}
/** Whether a projected point (normalised device coordinates) lies in the safe area, within the given fraction of it. */
function inSafeArea(p: THREE.Vector3, margin: number): boolean {
  const { l, r, t, b } = safeInsets();
  const x0 = -1 + (2 * l) / innerWidth;
  const x1 = 1 - (2 * r) / innerWidth;
  const y0 = -1 + (2 * b) / innerHeight;
  const y1 = 1 - (2 * t) / innerHeight;
  const sx = ((x1 - x0) / 2) * (1 - margin);
  const sy = ((y1 - y0) / 2) * (1 - margin);
  return p.z < 1 && p.x >= x0 + sx && p.x <= x1 - sx && p.y >= y0 + sy && p.y <= y1 - sy;
}

function frameCamera(fly = false): void {
  centreOnSafeArea();
  const hi = overviewDistance();
  controls.maxDistance = Math.max(246, hi * 1.5);
  const pos = VIEW_DIR.clone().multiplyScalar(hi);
  const target = new THREE.Vector3(0, 0, 0);
  if (fly) return flyCamera(pos, target);
  controls.target.copy(target);
  camera.position.copy(pos);
  controls.update();
}

/** How far back the overview stands: just far enough that the whole layout fits (fitPoints). */
function overviewDistance(): number {
  const savedPos = camera.position.clone();
  const corners = fitPoints;
  const MARGIN = 0.97; // fraction of the screen the layout may fill
  const fits = (dist: number) => {
    camera.position.copy(VIEW_DIR).multiplyScalar(dist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const p = new THREE.Vector3();
    return corners.every((c) => {
      p.copy(c).project(camera);
      return inSafeArea(p, MARGIN);
    });
  };
  let lo = 2.05;
  let hi = 2.05;
  while (!fits(hi) && hi < 10250) hi *= 2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  // fits() moved the camera while searching; put it back
  camera.position.copy(savedPos);
  camera.lookAt(controls.target);
  camera.updateMatrixWorld();
  return hi;
}

// ---------------------------------------------------------------------------
// Camera flights
// ---------------------------------------------------------------------------

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}
let flight: Flight | null = null;
/** Called once when a camera flight lands (used by the recording). */
let onFlightLanded: (() => void) | null = null;
/** True while showing (or flying to) a station close-up; departure flies back out. */
let inStationView = false;

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

function flyCamera(toPos: THREE.Vector3, toTarget: THREE.Vector3, duration = 2): void {
  flight = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos,
    toTarget,
    t: 0,
    duration,
  };
}

/** A point in ring-centred cylindrical coordinates: angle round the ring centre, distance out from it, height. */
const toCyl = (v: THREE.Vector3, fallbackAngle: number) => ({
  angle: Math.hypot(v.x, v.z) < 1e-3 ? fallbackAngle : Math.atan2(v.z, v.x),
  dist: Math.hypot(v.x, v.z),
  y: v.y,
});

/**
 * Flights turn around the ring centre like a user orbiting the view: camera and
 * aim point rotate together about the centre (the short way round), while the
 * aim point slides out towards the station and the camera drops and closes in.
 */
function updateFlight(dt: number): void {
  if (!flight) return;
  flight.t += dt;
  if (skipRequested) flight.t = flight.duration;
  const k = easeInOut(Math.min(1, flight.t / flight.duration));
  const c0 = toCyl(flight.fromPos, 0);
  const c1 = toCyl(flight.toPos, 0);
  const t0 = toCyl(flight.fromTarget, c0.angle);
  const t1 = toCyl(flight.toTarget, c1.angle);
  const turn = (mod(c1.angle - c0.angle + Math.PI, TAU) - Math.PI) * k; // same rotation for both
  const place = (out: THREE.Vector3, a: { angle: number; dist: number; y: number }, b: { angle: number; dist: number; y: number }) => {
    // Each keeps its own offset from the camera's angle, blended from start to end offset
    const offset0 = mod(a.angle - c0.angle + Math.PI, TAU) - Math.PI;
    const offset1 = mod(b.angle - c1.angle + Math.PI, TAU) - Math.PI;
    const ang = c0.angle + turn + THREE.MathUtils.lerp(offset0, offset1, k);
    const d = THREE.MathUtils.lerp(a.dist, b.dist, k);
    out.set(d * Math.cos(ang), THREE.MathUtils.lerp(a.y, b.y, k), d * Math.sin(ang));
  };
  place(camera.position, c0, c1);
  place(controls.target, t0, t1);
  if (flight.t >= flight.duration) {
    flight = null;
    onFlightLanded?.();
  }
}

/**
 * Close-up of a station with the train standing at it: from outside the ring,
 * behind the train, looking across it at the station building (so the name on
 * the wall shows), zoomed in as far as possible with the whole train on screen.
 */
/** Height of the train's roof crest (the KISS's upper deck stands taller than the rest). */
const trainCrest = () => (KISS ? S423_DIM.eaves + S423_DIM.roofRise : 4.592);

function stationView(st: Station): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const R = state.radius;
  const a = st.angle;
  const u = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); // outwards from the ring centre
  const target = u.clone().multiplyScalar(R - 4.1); // ground level (the camera rules keep the aim point there), between train and building

  // Must be on screen: both ends of the train (outer and inner corners, wheels to
  // roof) and the top of the station's name board.
  const half = (TRAIN_LENGTH / 2 + 0.615) / R;
  const pts: THREE.Vector3[] = [];
  for (const da of [-half, half]) {
    for (const r of [R - TRAIN_WIDTH / 2, R + TRAIN_WIDTH / 2]) {
      for (const y of [0, Math.max(4.92, trainCrest() + 0.3)]) pts.push(new THREE.Vector3(r * Math.cos(a + da), y, r * Math.sin(a + da)));
    }
  }
  const signR = R - PLATFORM_INNER - BUILDING.d / 2;
  pts.push(new THREE.Vector3(signR * Math.cos(a), signCentreY() + signHeight() / 2 + 0.41, signR * Math.sin(a)));

  const cam = camera.clone();
  const MARGIN = 0.92;
  const p = new THREE.Vector3();
  /** Closest distance (from the aim point, along dir) at which everything fits. */
  const fitDistance = (dir: THREE.Vector3) => {
    const fits = (dist: number) => {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return pts.every((q) => {
        p.copy(q).project(cam);
        return inSafeArea(p, MARGIN);
      });
    };
    let lo = 4.1;
    let hi = 8.2;
    while (!fits(hi) && hi < 1025) hi *= 2;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  // The camera sits on the station's radial line, so whether the name on the wall
  // shows over the carriage is a 2D question in (distance from centre, height):
  // the sight line to the lettering's bottom edge must pass above the roof.
  const labelR = R - PLATFORM_INNER; // the building's front wall
  const labelBottom = PLATFORM_HEIGHT + WINDOW.sill + WINDOW.h + 0.103 + 0.205;
  // (a double-decker's arched roof, sampled across; the others' crest and inner edge)
  const roof = KISS
    ? Array.from({ length: 9 }, (_, i) => {
        const u = -i / 8; // (from the crest in towards the station)
        return { r: R + (u * S423_DIM.width) / 2, y: S423_DIM.eaves + S423_DIM.roofRise * Math.sqrt(1 - u * u) + 0.164 };
      })
    : [
        { r: R, y: 4.592 + 0.164 }, // roof crest
        { r: R - TRAIN_WIDTH / 2, y: 4.018 + 0.164 }, // roof's inner edge
      ];
  const nameShows = (camR: number, camY: number) =>
    roof.every(({ r, y }) => camY + ((labelBottom - camY) * (camR - r)) / (camR - labelR) >= y);

  // Lowest angle (most face-on to the building) from which the name clears the train
  for (let deg = 16; deg <= 60; deg += 1) {
    const e = THREE.MathUtils.degToRad(deg);
    const dir = u.clone().multiplyScalar(Math.cos(e)).setY(Math.sin(e));
    const dist = fitDistance(dir);
    const pos = target.clone().addScaledVector(dir, dist);
    if (nameShows(Math.hypot(pos.x, pos.z), pos.y) || deg === 60) return { pos, target };
  }
  return { pos: target.clone(), target }; // unreachable
}

/**
 * Arrival view from the platform, placed relative to the front name board so it stays
 * legible: standing on the platform near its edge, a little ahead of the board, at eye
 * height, looking back past the board (and the person waiting near it) up the track the
 * train comes in on.
 */
const PLATFORM_VIEW = { ahead: 4.5, fromEdge: 0.6, eye: 2.0, lookBack: 14, aimInside: 2.5, lead: 4, flight: 2.5 };

function platformView(st: Station): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const R = state.radius;
  const boardA = st.angle + (buildingHalfAngle(R) + TRAIN_LENGTH / 2 / R) / 2; // the front board (the train runs towards +angle)
  const at = (a: number, r: number, y: number) => new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
  const { ahead, fromEdge, eye, lookBack } = PLATFORM_VIEW;
  const pos = at(boardA + ahead / R, R - PLATFORM_OUTER - fromEdge, PLATFORM_HEIGHT + eye);
  // Aim some way back and in past the board's line, so the board sits right of centre (clear
  // of the settings panel at the top left) with the train coming in on the track beyond it.
  // The aim point is on the ground, as the camera rules keep it (clampCamera): anywhere
  // else it would jump there once the flight lands.
  const target = at(boardA - lookBack / R, R - PLATFORM_INNER - PLATFORM_VIEW.aimInside, 0);
  return { pos, target };
}

/** Where the driver leans out of the side window, along the front vehicle from its centre (forward positive). */
/**
 * The driver's view's geometry, in the front vehicle's frame (local +x forward, +z the
 * right as you face forward): the seated eye point, and the circle the head swings out
 * on, round a pivot inside the cab, to look out of the right-hand side window. Seated,
 * the camera is `r` ahead of the pivot looking straight forward; leant out, `r` to its
 * right, beside the body, looking out sideways.
 * - Steam: seated in the cab's right-hand front window, beside the boiler, through its
 *   outer top corner (the window is 0.49 m wide, 0.5 m in from the cab side, 0.41 m
 *   tall), swinging out to just beyond the cab side.
 * - Otherwise: seated half a metre in front of the nose; the pivot 1.4 m behind the
 *   nose tip, close enough that the swing clears the nose's rounded corners.
 */
function driverPose(): { x0: number; z0: number; r: number; eye: number } {
  const zOut = ACTIVE_LOCO_WIDTH / 2 + 0.35; // head out beside the body
  if (HAS_STEAM) {
    const z0 = LOCO.width / 2 - 0.5 + 0.22;
    return { x0: LOCO.cabX + LOCO.cabL / 2 + 0.05, z0, r: zOut - z0, eye: LOCO.cabShoulder - 0.164 + 0.15 };
  }
  const tip = S423 ? S423_CARS[0].len / 2 : LOCO_HALF;
  return { x0: tip - 1.4 + zOut, z0: 0, r: zOut, eye: RAIL_TOP + 2.7 };
}

/** Where the driver leans out of the side window, along the front vehicle from its centre (forward positive). */
function driverLeanX(): number {
  const { x0, r } = driverPose();
  return x0 - r; // (the pivot's x)
}

/**
 * How far the driver is leaning out of the side window: 0 seated, 1 head out. Eases
 * towards 1 while the train stands at a picked station, back to 0 when it moves.
 */
let driverLean = 0;
const DRIVER_LEAN_TIME = 3; // seconds to lean out or back in
/** A trip asked for while leaning out: it departs once the driver is facing forward again. */
let leanBackThen: (() => { winner: Station; laps: number } | null) | null = null;

/**
 * Driver's view: just in front of the front vehicle's nose at a driver's eye
 * height (on a steam loco, in the cab's right-hand front window), facing straight
 * ahead along it and a little down the track; at a picked station, leaning out of the
 * side window to look back along the platform.
 */

function driverView(dt: number): void {
  const front = cars[0];
  if (!front) return;
  const out = state.winner && !state.run && !leanBackThen;
  driverLean = THREE.MathUtils.clamp(driverLean + (out ? dt : -dt) / DRIVER_LEAN_TIME, 0, 1);
  if (leanBackThen && driverLean === 0) {
    const choose = leanBackThen;
    leanBackThen = null;
    dispatch(choose);
  }
  const k = easeInOut(driverLean);
  // (near plane: close in, so the boiler beside a steam cab's window and the train's
  // side beside a leaning head are drawn whole rather than sliced)
  setCameraNear(0.25);
  // Leaning out (the ring's platforms are on the train's right): first the head swings
  // out on its circle, turning with it to face sideways (so it goes round the cab's
  // corner rather than through its wall); then, out of the window, it turns on the spot
  // to look back along the train at the platform. The slight downward tilt blends
  // separately over the whole move, so it never swings or tips.
  const { x0, z0, r, eye } = driverPose();
  const swing = (Math.PI / 2) * Math.min(1, k / 0.5);
  const pos = new THREE.Vector3(x0 - r + r * Math.cos(swing), eye, z0 + r * Math.sin(swing));
  const yaw1 = Math.atan2(1.2 - 0.35, -25); // looking back, angled a little out over the platform
  const yaw = k <= 0.5 ? swing : THREE.MathUtils.lerp(Math.PI / 2, yaw1, (k - 0.5) / 0.5);
  const pitch = THREE.MathUtils.lerp(Math.atan2(-1.2, 30), Math.atan2(-1.0, 25), k);
  const look = pos.clone().add(new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)).multiplyScalar(10));
  camera.position.copy(pos).applyMatrix4(front.obj.matrixWorld);
  camera.lookAt(look.applyMatrix4(front.obj.matrixWorld));
}

/** The fog's distances for the current ring, before allowing for how far back the camera is. */
let fogBase = { near: 102.5, far: 266.5 };
/**
 * Fog measured from the camera, so it starts beyond the far side of the ring however far
 * back the camera is (on a narrow portrait screen the overview backs off a long way).
 */
function updateFog(): void {
  const fog = scene.fog as THREE.Fog;
  const back = camera.position.distanceTo(controls.target);
  fog.near = Math.max(fogBase.near, back + state.radius * 1.2);
  fog.far = Math.max(fogBase.far, fog.near + (fogBase.far - fogBase.near));
  // Draw at least as far as the fog reaches, so nothing is cut off before it's fogged out
  const far = Math.max(820, fog.far * 1.3);
  if (Math.abs(camera.far - far) > 1) {
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** Removes this module's window listeners when the dev server hot-swaps it. */
const moduleListeners = new AbortController();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  centreOnSafeArea();
  renderer.setSize(innerWidth, innerHeight);
  if (!userMovedCamera && !inStationView) frameCamera();
}, { signal: moduleListeners.signal });

// ---------------------------------------------------------------------------
// Station signs
// ---------------------------------------------------------------------------

/** World-space height of a name board; its width follows the text. */
const SIGN_HEIGHT = 1.64;
/**
 * Name boards grow with the layout so they stay readable in the overview (which
 * zooms out for big rings): unchanged up to a radius of ~51 m, in proportion beyond.
 * Set by buildWorld before the stations are made.
 */
let signScale = 1;
const signHeight = () => SIGN_HEIGHT * signScale;
/** Extra clearance between the roof and a board's bottom edge (grows with the board). */
const SIGN_GAP = 0.82;
/** Height of a board's centre: its bottom sits a little above the roof, however big it is. */
const signCentreY = () => SIGN_Y - SIGN_HEIGHT / 2 + SIGN_GAP * signScale + signHeight() / 2;

function drawSign(st: Station, mode: SignMode, force = false): void {
  if (st.mode === mode && !force) return;
  st.mode = mode;
  const canvas = drawSignCanvas(st.name, mode);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Canvas size changes with the text, so use a fresh texture rather than resizing one.
  st.sign.material.map?.dispose();
  st.sign.material.map = tex;
  st.sign.material.needsUpdate = true;
  const h = signHeight();
  st.sign.scale.set((h * canvas.width) / canvas.height, h, 1);
  st.sign.position.y = signCentreY();
  // (the platform boards never get the winner's yellow frame: that's for the floating board)
  if (st.boards.length) {
    const plain = mode === 'winner' ? drawSignCanvas(st.name, 'normal') : canvas;
    const plainTex = plain === canvas ? tex : new THREE.CanvasTexture(plain);
    plainTex.colorSpace = THREE.SRGBColorSpace;
    plainTex.anisotropy = 4;
    for (const b of st.boards) fillBoard(b, plain, plainTex);
  }
  drawWallLabel(st);
}

/**
 * Platform name boards: the same artwork as the floating board, on a board between two
 * grey metal posts standing on the ground just behind the platform's back edge (local
 * z = 0), facing the track (+z) and readable from behind too.
 */
const BOARD = { h: 0.5, bottom: 2.1, post: 0.08, behind: 0.08 };

function fillBoard(b: THREE.Group, canvas: HTMLCanvasElement, tex: THREE.Texture): void {
  for (const c of [...b.children]) {
    b.remove(c);
    (c as THREE.Mesh).geometry?.dispose();
  }
  const { h, post } = BOARD;
  const w = (h * canvas.width) / canvas.height;
  const y = PLATFORM_HEIGHT + BOARD.bottom + h / 2;
  const face = mat(0xffffff, { map: tex, roughness: 0.5 });
  for (const side of [1, -1]) {
    const m = mesh(new THREE.PlaneGeometry(w, h), face, 0, y, side * 0.016);
    if (side < 0) m.rotation.y = Math.PI;
    b.add(m);
  }
  b.add(box(w, h, 0.03, mat(0x0c1a63, { roughness: 0.5 }), 0, y, 0)); // the board's edges
  const metal = mat(0x9aa0a6, { roughness: 0.4, metalness: 0.6 });
  const top = y + h / 2 + 0.05;
  for (const e of [-1, 1]) b.add(box(post, top, post, metal, e * (w / 2 + post / 2), top / 2, 0));
}

/** Raised wall lettering: capitals as tall as fit between the window tops and the eaves. */
const WALL_LETTERS = { capHeight: 0.533, depth: 0.01, tracking: 0.12 }; // (flat on the wall, like painted lettering: raised ones turned to slabs seen edge-on)

function drawWallLabel(st: Station): void {
  if (st.wallLabelName === st.name) return;
  const name = (st.wallLabelName = st.name);
  loadLetterFont()
    .then((font) => {
      if (st.wallLabelName !== name) return; // renamed meanwhile
      const geo = letterGeometry(font, name, { ...WALL_LETTERS, maxWidth: BUILDING.w - 0.41 });
      st.wallLabel.geometry.dispose();
      st.wallLabel.geometry = geo ?? new THREE.BufferGeometry();
      const sideGeo = letterGeometry(font, name, { ...WALL_LETTERS, maxWidth: BUILDING.d - 0.41 }) ?? new THREE.BufferGeometry();
      st.sideLabels[0].geometry.dispose();
      for (const m of st.sideLabels) m.geometry = sideGeo;
    })
    .catch((err) => console.warn('Wall lettering font failed to load', err));
}

// ---------------------------------------------------------------------------
// World: track, stations, trees
// ---------------------------------------------------------------------------

/** Rectangular window: bottom edge height above the platform, glass size. */
const WINDOW = { sill: 0.82, halfW: 0.533, h: 1.066 };

/** A rectangular sash window on the front face (z = front): white frame, glazing bars and sill. */
function rectWindow(x: number, y: number, front: number, glass: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const white = mat(0xf4f1ea);
  const { halfW, h } = WINDOW;
  // Four panes set back in a white frame: the frame's sides and the glazing bars between
  // the panes all stand proud of the glass (one piece, no bars laid over a single pane)
  const W2 = halfW * 2;
  const rim = 0.1025; // the frame's width round the outside
  const bar = 0.051; // glazing bars
  const depth = 0.082;
  const barY = h * 0.6;
  g.add(box(W2, h, 0.03, glass, 0, h / 2, 0.015)); // the glass, back in the frame
  g.add(box(W2 + 2 * rim, rim, depth, white, 0, h + rim / 2, depth / 2)); // top
  g.add(box(W2 + 2 * rim, rim, depth, white, 0, -rim / 2, depth / 2)); // bottom
  for (const e of [-1, 1]) g.add(box(rim, h, depth, white, e * (halfW + rim / 2), h / 2, depth / 2)); // sides
  g.add(box(bar, h, depth, white, 0, h / 2, depth / 2)); // vertical bar
  for (const e of [-1, 1]) g.add(box(halfW - bar / 2, bar, depth, white, (e * (halfW + bar / 2)) / 2, barY, depth / 2)); // horizontal bar, either side
  g.add(box(halfW * 2 + 0.369, 0.082, 0.185, white, 0, -0.144, 0.092)); // sill
  g.position.set(x, y, front);
  return g;
}

const BUILDING = { w: 5.74, h: 4.45, d: 5.74, base: 0, z: -2.87 }; // square, its front on the platform's back edge; h: leaves ~0.45 m of wall above the name
/** Height of the name board's centre, clear of the roof ridge and chimney. */
const SIGN_Y = BUILDING.h + BUILDING.d / 2 + 1.845;

/**
 * @param travelDir which way along the station's local x the train runs (+1 or -1);
 *   used to stand the waiting figure where the carriage's rear door stops
 */
function makeStation(name: string, color: number, travelDir: 1 | -1): Station {
  const g = new THREE.Group();
  const accentMat = mat(color); // door and the waiting figure
  const glassMat = mat(0x2c3e50, { roughness: 0.25, metalness: 0.2 });

  // Local frame: +X along the track, +Z towards the track, origin on the platform's back edge.
  // The platform itself is built separately (see addRingPlatform) so it can follow the curve.
  const { w, h, d, base, z } = BUILDING;
  const top = base + h;
  const front = z + d / 2;

  // Brick walls. Box faces: +x, -x, +y, -y, +z, -z
  const sideBrick = brick(d, h);
  const longBrick = brick(w, h);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    sideBrick,
    sideBrick,
    longBrick,
    longBrick,
    longBrick,
    longBrick,
  ]);
  walls.position.set(0, base + h / 2, z);
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // Brick gables: a 45° triangular prism along the building, under the roof
  const rise = d / 2;
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-d / 2, 0);
  gableShape.lineTo(d / 2, 0);
  gableShape.lineTo(0, rise);
  gableShape.closePath();
  const gable = new THREE.ExtrudeGeometry(gableShape, { depth: w, bevelEnabled: false })
    .rotateY(Math.PI / 2)
    .translate(-w / 2, top, z);
  g.add(mesh(gable, brickWorld()));

  // Slate-tiled roof: two slabs meeting at the ridge, overhanging the walls
  const overhang = 0.103;
  const roofLen = w + 0.205;
  const slope = (d / 2 + overhang) * Math.SQRT2 + 0.062;
  const roofMat = tiles(roofLen, slope);
  for (const side of [1, -1]) {
    const slab = box(roofLen, 0.123, slope, roofMat);
    slab.rotation.x = side * (Math.PI / 4);
    // Centre of the slope, nudged outwards by half the slab thickness
    const run = slope / 2 / Math.SQRT2;
    slab.position.set(0, top + rise - run + 0.062 * Math.SQRT1_2, z + side * (run + 0.062 * Math.SQRT1_2));
    g.add(slab);
    // Snow lying on it (snow mode only), just above the tiles
    const snowLayer = box(roofLen + 0.04, 0.1, slope + 0.02, snowWhite);
    snowLayer.rotation.x = slab.rotation.x;
    snowLayer.position.copy(slab.position).add(new THREE.Vector3(0, Math.SQRT1_2, side * Math.SQRT1_2).multiplyScalar(0.11));
    snowLayer.userData.snowOnly = true;
    g.add(snowLayer);
  }
  g.add(box(roofLen, 0.164, 0.287, mat(0x2b2f33), 0, top + rise + 0.082, z)); // ridge
  g.add(box(0.451, 1.128, 0.451, brick(0.451, 1.128), 1.23, top + rise - 0.103, z - 0.513)); // chimney

  // Arched door and windows, like an old brick station
  // Rectangular door in the person's colour, its top level with the window tops
  const doorH = WINDOW.sill + WINDOW.h;
  const white = mat(0xf4f1ea);
  g.add(box(1.107, doorH + 0.103, 0.062, white, 0, PLATFORM_HEIGHT + (doorH + 0.103) / 2, front + 0.031)); // frame
  g.add(box(0.902, doorH, 0.082, accentMat, 0, PLATFORM_HEIGHT + doorH / 2, front + 0.041)); // door
  for (const x of [-1.64, 1.64]) g.add(rectWindow(x, PLATFORM_HEIGHT + WINDOW.sill, front, glassMat));


  // The person waiting on the platform
  const figure = new THREE.Group();
  figure.add(mesh(new THREE.CylinderGeometry(0.287, 0.369, 1.025, 12), accentMat, 0, 0.513, 0));
  figure.add(mesh(new THREE.SphereGeometry(0.287, 16, 12), mat(0xf5cba7), 0, 1.312, 0));
  // Level with the first door at or behind the front name board when the train stops,
  // back towards the building (ring stations re-place it along the curve: see buildWorld)
  figure.position.set(travelDir * figureDoor((w / 2 + TRAIN_LENGTH / 2) / 2), PLATFORM_HEIGHT, front + FIGURE_FROM_BACK);
  g.add(figure);

  // Name board, always facing the camera
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
  sign.position.set(0, SIGN_Y, z);
  g.add(sign);

  // Station name in raised white capitals, centred in the band between the window tops and the eaves
  const wallLabel = new THREE.Mesh(
    new THREE.BufferGeometry(), // filled in by drawWallLabel once the font has loaded
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  );
  const windowTop = PLATFORM_HEIGHT + WINDOW.sill + WINDOW.h + 0.103;
  wallLabel.position.set(0, windowTop + 0.287, front); // just above the windows, plain wall above
  wallLabel.castShadow = true;
  g.add(wallLabel);

  // DB name boards on posts, halfway between each end of the building and the start
  // of the platform's ramp (ring stations re-place them along the curve: see buildWorld)
  const boardX = (w / 2 + TRAIN_LENGTH / 2) / 2;
  const boards = [-1, 1].map((e) => {
    const b = new THREE.Group();
    b.name = 'platformBoard';
    b.position.set(e * boardX, 0, -BOARD.behind);
    g.add(b);
    return b;
  });

  // ...and on both end walls, at the same height, centred across them
  const sideLabels = [-1, 1].map((e) => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), wallLabel.material);
    m.position.set((e * w) / 2, wallLabel.position.y, z);
    m.rotation.y = (e * Math.PI) / 2; // (local +z, the letters' front, facing out from the wall)
    m.castShadow = true;
    g.add(m);
    return m;
  });

  const st: Station = { name, angle: 0, group: g, figure, accentMat, sign, wallLabel, sideLabels, boards, color, mode: null };
  drawSign(st, 'normal');
  return st;
}

/**
 * Trees outside the track mustn't block a view of it: the camera never looks at its
 * focus from lower than this angle above the horizontal (controls.maxPolarAngle), so a
 * tree is allowed as long as it stays under the cone of this angle rising from every
 * point on the track.
 */
const VIEW_CONE_ANGLE = Math.PI / 2 - Math.PI * 0.47;
/** Clear strip just outside the track (trees off the ballast and out of the overhead line's masts). */
const OUTER_TRACK_CLEAR = 3.5;
/** A tree's top and its widest radius (before scaling). */
const TREE_TOP = 4.83;
const TREE_RADIUS = 1.538;
/** How much wider the ground and forest reach than they used to: 10× the area. */
const WORLD_SCALE = Math.sqrt(10);
/** Whether there's a forest at all (?trees=false: none). */
const SHOW_TREES = new URLSearchParams(location.search).get('trees') !== 'false';
/** Most trees there may be (beyond that the forest thins from its outside in). */
const TREE_MAX = 40000;
const TREE_DENSITY = 1 / 109; // trees per square metre of free ground (one per ~109 m²)
/** The forest's leaves and their summer colours (for tinting them in snow mode). */
/** The forest's leaves, tile by tile, with their summer colours (for tinting in snow mode). */
let forestLeafTiles: { mesh: THREE.InstancedMesh; colors: THREE.Color[] }[] = [];
const LEAF_COLORS = [0x2e8b57, 0x3c9d4e, 0x4caf50, 0x2f7d4a].map((c) => new THREE.Color(c));

/**
 * Trees scattered evenly (by area) over the whole visible map: inside the ring and
 * well beyond it, keeping clear of the track, stations and lead-in. Instanced so
 * hundreds of trees cost two draw calls.
 */
function makeForest(R: number, terrain: Terrain): THREE.Group {
  const rand = mulberry32(1234);
  // How far out it reaches: as far as can be seen through the fog from the overview
  // (fog measured from the camera: see updateFog), and never past the old 10×-area edge
  const back = overviewDistance();
  const fogNear = Math.max(fogBase.near, back + R * 1.2);
  const seen = back + fogNear + (fogBase.far - fogBase.near);
  const reach = Math.min((R * 2.5 + 61.5) * WORLD_SCALE, seen);
  // At most TREE_MAX trees: full density out to 70% of the edge, thinning to none at
  // the edge, the edge brought in (thinning from the far outside first) as needed
  const capEdge = (() => {
    // expected trees out to edge e, density falling linearly from 0.7e to e
    // (full density over 0.49 of the disc, the falloff ring worth another 0.24 of it)
    const count = (e: number) => TREE_DENSITY * Math.PI * e * e * 0.73;
    let lo = 0;
    let hi = reach;
    if (count(reach) <= TREE_MAX) return reach;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (count(m) > TREE_MAX) hi = m;
      else lo = m;
    }
    return lo;
  })();
  const maxR = capEdge;
  const thinFrom = reach === capEdge ? Infinity : 0.7 * maxR;
  // Distance to the nearest point on the track: the ring, or the lead-in's straight
  // (from the tunnel portal to the junction)
  const coneSlope = Math.tan(VIEW_CONE_ANGLE);
  // (the lead-in counts only alongside it: beyond the portal it's underground, so the
  // hill over the tunnel keeps its trees, rather than a round clearing about its mouth)
  const toTrack = (x: number, z: number) => {
    const ring = Math.abs(Math.hypot(x, z) - R);
    if (x < terrain.portalX) return ring;
    return Math.min(ring, Math.hypot(x - Math.min(x, 0), z + R));
  };
  const blocked = (x: number, z: number, top: number, radius: number) => {
    const r = Math.hypot(x, z);
    // Ring and inner stations, and a strip just outside the track
    if (r > R - PLATFORM_INNER - BUILDING.d - 3.075 && r < R + OUTER_TRACK_CLEAR) return true;
    // Outside the ring: no taller than the view cone rising from any point on the track
    // (measured to the tree's nearest edge)
    if (r >= R && top > coneSlope * Math.max(0, toTrack(x, z) - radius)) return true;
    // lead-in, home station and the cutting (wide near the portal, where the cutting is deepest)
    const halfW = x < terrain.portalX + 8.2 ? 10.25 : PLATFORM_INNER + BUILDING.d + 3.075;
    if (x < 4.1 && x > terrain.portalX - 4.1 && Math.abs(z + R) < halfW) return true;
    return false;
  };

  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  treeGrid = new Map();
  const colors: THREE.Color[] = [];
  const attempts = Math.round(Math.PI * maxR * maxR * TREE_DENSITY);
  for (let i = 0; i < attempts; i++) {
    const r = Math.sqrt(rand()) * maxR; // sqrt => uniform over the disc's area
    const a = rand() * TAU;
    const keep = rand(); // (for the thinning towards the edge)
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    const s = 0.6 + rand() * 0.9;
    const tall = 0.85 + rand() * 0.35;
    const spin = rand() * TAU;
    const color = LEAF_COLORS[Math.floor(rand() * LEAF_COLORS.length)];
    if (r > thinFrom && keep > (maxR - r) / (maxR - thinFrom)) continue;
    const base = terrain.height(x, z) - 0.103;
    // (the view cone compares the tree's own height, not counting the ground it stands on)
    if (blocked(x, z, TREE_TOP * s * tall, TREE_RADIUS * s)) continue;
    dummy.position.set(x, base, z);
    const key = `${Math.floor(x / TREE_CELL)},${Math.floor(z / TREE_CELL)}`;
    if (!treeGrid.has(key)) treeGrid.set(key, []);
    treeGrid.get(key)!.push({ x, z, r: TREE_RADIUS * s * 0.75, top: base + TREE_TOP * s * tall });
    dummy.rotation.set(0, spin, 0);
    dummy.scale.set(s, s * tall, s);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    colors.push(color);
  }

  // (the trunk carries on 2 m down into the ground, so on a slope it never stands clear
  // of the ground on its downhill side)
  const SUNK = 2;
  const trunkGeo = new THREE.CylinderGeometry(0.246, 0.328 + (0.082 * SUNK) / 1.64, 1.64 + SUNK, 8).translate(0, (1.64 - SUNK) / 2, 0);
  const leafGeo = mergeGeometries([
    new THREE.ConeGeometry(1.538, 2.665, 10).translate(0, 2.563, 0),
    new THREE.ConeGeometry(1.128, 2.05, 10).translate(0, 3.793, 0),
  ])!;
  const r1 = (y: number) => (1.538 * (3.8955 - y)) / 2.665; // lower tier's radius at height y
  const capGeo = mergeGeometries([
    new THREE.ConeGeometry(0.6, 1.09, 10).translate(0, 4.83 - 0.545, 0),
    new THREE.CylinderGeometry(r1(2.55) * 1.04, r1(1.75) * 1.04, 0.8, 10, 1, true).translate(0, 2.15, 0),
  ])!;
  const trunkMat = mat(0x7b5a3a);
  const leafMat = mat(0xffffff);

  // In square tiles, each its own set of instanced meshes, so three.js can skip the
  // tiles out of view rather than drawing every tree every frame. Tiles grow with the
  // forest, to keep their number (and draw calls) bounded.
  const tile = Math.max(150, (2 * maxR) / 12);
  const byTile = new Map<string, number[]>();
  const p = new THREE.Vector3();
  matrices.forEach((m, i) => {
    p.setFromMatrixPosition(m);
    const key = `${Math.floor(p.x / tile)},${Math.floor(p.z / tile)}`;
    if (!byTile.has(key)) byTile.set(key, []);
    byTile.get(key)!.push(i);
  });
  const forest = new THREE.Group();
  forestLeafTiles = [];
  for (const ids of byTile.values()) {
    // Snow (shown in snow mode): a white cap on the top tier and a white ring on the
    // lower tier's exposed skirt; the leaves themselves get a frosty tint
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, ids.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, ids.length);
    const caps = new THREE.InstancedMesh(capGeo, snowWhite, ids.length);
    ids.forEach((id, k) => {
      trunks.setMatrixAt(k, matrices[id]);
      leaves.setMatrixAt(k, matrices[id]);
      leaves.setColorAt(k, colors[id]);
      caps.setMatrixAt(k, matrices[id]);
    });
    caps.userData.snowOnly = true;
    forestLeafTiles.push({ mesh: leaves, colors: ids.map((id) => colors[id]) });
    for (const im of [trunks, leaves, caps]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere(); // (round its own trees only: what lets it be culled)
      forest.add(im);
    }
  }
  return forest;
}

/** Train extent relative to the locomotive centre: front buffer and back of the carriage. */
/** Half-length of the locomotive's running board (its buffer beams are just beyond). */
let LOCO_HALF = 0; // 6.5 m compact, 11.6 m full-size, 18.8 m Taurus
let TRAIN_FRONT = 0; // front buffers
/** Carriage underframe length. */
/** Carriage length in metres: ?length= (6–30), or the loco type's default (DEFAULT_LENGTH). */
let CARRIAGE_LEN = 9;
/**
 * Gaps between vehicles. On a curve neighbouring vehicles' inside corners swing
 * towards each other by about (half-width × centre distance / radius), so the ring
 * is kept large enough for these gaps (see MIN_RING_RADIUS).
 * Locomotive to first carriage: room for the loco's buffer beam and buffers.
 */
let LOCO_GAP = 0.82;
/**
 * How much shorter the electric locos' buffers and draw hook are than the steam
 * locos' (they mount straight onto the foot of the nose). Everything that depends on
 * where the loco's buffer faces and hook tip are allows for it.
 */
const ELECTRIC_BUFFER_SHORTEN = 0.15;
let LOCO_END_SHORTEN = 0;
/** Between carriages: about what real coaches have, bodies ~0.4 m apart, bridged by the gangways. */
const CARRIAGE_GAP = 0.4;
/**
 * A carriage's front buffers stick out at most this far from its end: enough to
 * meet the locomotive's on the straight. They're sprung: they extend only as far as
 * the vehicle ahead allows, so on a curve the inside ones compress (see placeTrain).
 */
const BUFFER_REACH = 0.472;
/** Its rear buffers stick out half the gap between carriages, meeting the next carriage's front ones. */
const REAR_BUFFER_REACH = CARRIAGE_GAP / 2;
/** Outer face of the locomotive's rear buffer heads, in its own frame. */
let LOCO_BUFFER_FACE = 0;
/** Draw hooks stick out this far from the ends; the screw coupling spans between them. */
const HOOK_REACH = 0.12; // the hook's tip stays behind the buffer faces, as on real stock
/** Carriages' hooks are shorter, to fit the smaller gap between them. */
const CARRIAGE_HOOK_REACH = 0.13;
const COUPLING_Y = 1.558;
/** Carriage centre, behind the locomotive centre (whose back end is at -1.3). */
/** Number of carriages, from ?carriages= (1–10, default 1). */
let CARRIAGE_COUNT = 1;
/** Carriage centres, behind the locomotive centre: each a carriage plus a gap further back. */
let CARRIAGE_OFFSETS: number[] = [];
let LAST_CARRIAGE = 0;
let TRAIN_TAIL = 0;
/** Length of the locomotive plus one carriage: the clear track between stations, whatever the train. */
let LOCO_AND_CARRIAGE = 0;
/** Carriage doors sit this far from the carriage centre. */
let CARRIAGE_DOOR_X = 0;
let TRAIN_LENGTH = 0;
/**
 * How much bigger everything is than with one carriage. Speeds are multiplied by
 * this so the number of carriages doesn't change how long anything takes.
 */
let SPEED_SCALE = 1;
/** How far the locomotive centre sits ahead of the train's midpoint. */
let LOCO_AHEAD = 0;
/** Where the last carriage's rear door stops, along the track from the platform's middle (negative: behind). */
let REAR_DOOR = 0;

/** Where every passenger door stops, along the track from the platform's middle (forward positive). */
function doorStops(): number[] {
  if (S423) return S423_CARS.flatMap((c) => s423Doors(c).map((d) => LOCO_AHEAD + c.offset + d));
  return CARRIAGE_OFFSETS.flatMap((o) => [LOCO_AHEAD + o + CARRIAGE_DOOR_X, LOCO_AHEAD + o - CARRIAGE_DOOR_X]);
}

/**
 * The waiting figure's door: the first one (counting from the front of the train) at or
 * behind the front name board, which stands `boardAt` along the track ahead of the
 * platform's middle, and at least FIGURE_FROM_DRIVER behind where the driver leans out
 * (so they're in that shot, not hidden under it); the rear door if none is.
 */
const FIGURE_FROM_DRIVER = 8;
function figureDoor(boardAt: number): number {
  const limit = Math.min(boardAt, LOCO_AHEAD + driverLeanX() - FIGURE_FROM_DRIVER); // (the front vehicle's centre stops LOCO_AHEAD ahead of the middle)
  const behind = doorStops().filter((d) => d <= limit + 1e-6);
  return behind.length ? Math.max(...behind) : REAR_DOOR;
}

/** Recalculate everything that depends on the rolling stock. */
function deriveStock(): void {
  LOCO_KIND = stock.loco;
  LOCO = LOCO_KIND === 'full' ? FULL_LOCO : COMPACT_LOCO;
  // (ELECTRIC: the modern types, no steam; the LINT is a diesel, so it's that without the wires)
  ELECTRIC = LOCO_KIND === 'taurus' || LOCO_KIND === 'railjet' || LOCO_KIND === 's423' || LOCO_KIND === 'flirt' || LOCO_KIND === 'lint' || LOCO_KIND === 'desiro' || LOCO_KIND === 'kiss' || LOCO_KIND === 'rjkiss' || LOCO_KIND === 'allegra';
  RAILJET = LOCO_KIND === 'railjet';
  S423 = LOCO_KIND === 's423' || LOCO_KIND === 'flirt' || LOCO_KIND === 'lint' || LOCO_KIND === 'desiro' || LOCO_KIND === 'kiss' || LOCO_KIND === 'rjkiss' || LOCO_KIND === 'allegra';
  FLIRT = LOCO_KIND === 'flirt';
  LINT = LOCO_KIND === 'lint';
  KISS = LOCO_KIND === 'kiss' || LOCO_KIND === 'rjkiss';
  DESIRO = LOCO_KIND === 'desiro' || KISS;
  ALLEGRA = LOCO_KIND === 'allegra';
  DESIRO_LOOK = DESIRO || ALLEGRA;
  DESIRO_L = ALLEGRA ? ALLEGRA_L : LOCO_KIND === 'rjkiss' ? KISS_RJ_L : KISS ? KISS_L : DESIRO_ML;
  // (the track: metre gauge for the Allegra, with shorter sleepers)
  TRACK_GAUGE = ALLEGRA ? 1.0 : STANDARD_GAUGE;
  RAIL_HALF_GAUGE = TRACK_GAUGE / 2;
  WHEEL_Z = RAIL_HALF_GAUGE + 0.062;
  SLEEPER_LEN = ALLEGRA ? 1.8 : 2.6;
  const spec = FLIRT ? EMU_SPECS.flirt : LINT ? EMU_SPECS.lint : KISS ? EMU_SPECS.kiss : DESIRO ? EMU_SPECS.desiro : ALLEGRA ? EMU_SPECS.allegra : EMU_SPECS.s423;
  S423_DIM = spec.dim;
  S423_CAB_EXTRA = spec.cabExtra;
  S423_END_BOGIE = spec.endBogie;
  S423_CAB_BODY = S423_CAB_EXTRA - S423_DIM.nose;
  ACTIVE_LOCO_WIDTH = ELECTRIC ? TAURUS.width : LOCO.width;
  ACTIVE_LOCO_PIVOT = ELECTRIC ? TAURUS.bogieX : (Math.max(...LOCO.driverXs) - Math.min(...LOCO.driverXs)) / 2;
  HAS_STEAM = !ELECTRIC;
  LOCO_HALF = ELECTRIC ? TAURUS.half : LOCO.half;
  LOCO_END_SHORTEN = ELECTRIC ? ELECTRIC_BUFFER_SHORTEN : 0;
  LOCO_GAP = 0.82 - LOCO_END_SHORTEN; // the carriage stays the same distance from the loco's buffers
  TRAIN_FRONT = LOCO_HALF + 0.41 - LOCO_END_SHORTEN;
  CARRIAGE_LEN = stockLength(stock);
  LOCO_BUFFER_FACE = -(LOCO_HALF + 0.041) - 0.267 - 0.031 + LOCO_END_SHORTEN;
  CARRIAGE_COUNT = stock.carriages;
  CARRIAGE_OFFSETS = Array.from(
    { length: CARRIAGE_COUNT },
    (_, i) => -(LOCO_HALF + LOCO_GAP + CARRIAGE_LEN / 2 + i * (CARRIAGE_LEN + CARRIAGE_GAP)),
  );
  LAST_CARRIAGE = CARRIAGE_OFFSETS[CARRIAGE_COUNT - 1];
  TRAIN_TAIL = -LAST_CARRIAGE + CARRIAGE_LEN / 2;
  LOCO_AND_CARRIAGE = TRAIN_FRONT + LOCO_HALF + LOCO_GAP + CARRIAGE_LEN;
  CARRIAGE_DOOR_X = doorCentre(CARRIAGE_LEN);
  TRAIN_LENGTH = TRAIN_FRONT + TRAIN_TAIL;
  SPEED_SCALE = TRAIN_LENGTH / LOCO_AND_CARRIAGE;
  LOCO_AHEAD = (TRAIN_TAIL - TRAIN_FRONT) / 2;
  REAR_DOOR = LOCO_AHEAD + LAST_CARRIAGE - CARRIAGE_DOOR_X;
  if (S423) {
    // The train: `carriages` cars formed into coupled units (s423Units). In each unit
    // the middle cars are `length` long and the end cars longer to fit the cab; a
    // one-car unit is a double-ended railcar. Cars within a unit meet at shared
    // bogies (articulated); units meet cab to cab. s is the front car's centre.
    const n = stock.carriages;
    const L = stockLength(stock);
    // (FLIRT: pantograph raised at the front of the second car, and a folded one
    // symmetrically at the rear of the second-last, in each unit.)
    // (LINT: no pantographs, it's a diesel.)
    // (Allegra, more than 4 cars: a 3-car unit (4-car from 6 cars), then EW II coaches, then an ABt driving trailer)
    const allegraMixed = ALLEGRA && n > 4;
    const units = allegraMixed ? [n >= 6 ? 4 : 3] : FLIRT ? flirtUnits(n) : KISS ? flirtUnits(n, KISS_UNIT_RANK) : ALLEGRA ? rankedUnits(n, ALLEGRA_UNIT_RANK) : LINT ? lintUnits(n) : s423Units(n);
    const cars: Omit<S423Car, 'offset'>[] = units.flatMap((m) =>
      Array.from({ length: m }, (_, i) => ({
        len: L + (i === 0 ? S423_CAB_EXTRA : 0) + (i === m - 1 ? S423_CAB_EXTRA : 0),
        cabFront: i === 0,
        cabRear: i === m - 1,
        // Pantographs, symmetrical about the unit's middle (folded ahead of it, raised
        // behind): either side of the middle joint, or with an odd number of cars on the
        // neighbouring cars' ends facing the middle car; a railcar has them at its ends
        // (Desiro ML: symmetrical: raised at the inner end of each unit's front car, folded
        // at the inner end of its rear car; a railcar has both, at the flat roof's ends)
        // (Allegra: one on each end car, just behind the cab: raised at the front, folded at the rear)
        pantoFront: ALLEGRA ? (i === 0 ? 'raised' : null) : DESIRO ? (i === m - 1 ? 'folded' : null) : LINT ? null : FLIRT ? (i === Math.min(1, m - 1) ? 'raised' : null) : m === 1 ? 'folded' : i === Math.ceil(m / 2) ? 'raised' : null,
        pantoRear: ALLEGRA ? (i === m - 1 ? 'folded' : null) : DESIRO ? (i === 0 ? 'raised' : null) : LINT ? null : FLIRT ? (i === m - 1 - Math.min(1, m - 1) ? 'folded' : null) : m === 1 ? 'raised' : i === Math.floor(m / 2) - 1 ? 'folded' : null,
      })),
    );
    if (allegraMixed) {
      const coachLen = rhbCoachLength(L);
      for (let k = 0; k < n - units[0] - 1; k++) cars.push({ len: coachLen, cabFront: false, cabRear: false, pantoFront: null, pantoRear: null, kind: 'coach' });
      cars.push({ len: coachLen, cabFront: false, cabRear: true, pantoFront: null, pantoRear: null, kind: 'cabCar' });
    }
    const lens = cars.map((c) => c.len);
    let x = 0; // front of the current car, measured back from the front of the train
    const centres = cars.map((c) => {
      // (a gap where cars are coupled rather than sharing a bogie: between units, and on
      // either side of loco-hauled coaches)
      if ((c.cabFront || (c.kind ?? 'emu') !== 'emu') && x > 0) x += S423_UNIT_GAP;
      const centre = -(x + c.len / 2);
      x += c.len;
      return centre;
    });
    const ref = centres[0];
    S423_CARS = cars.map((c, i) => ({ ...c, offset: centres[i] - ref }));
    ACTIVE_LOCO_WIDTH = 3.02;
    LOCO_HALF = lens[0] / 2;
    LOCO_GAP = 0;
    TRAIN_FRONT = LOCO_HALF + 0.35; // the automatic coupler's face
    CARRIAGE_LEN = L;
    CARRIAGE_COUNT = n;
    CARRIAGE_OFFSETS = S423_CARS.slice(1).map((c) => c.offset);
    const last = S423_CARS[n - 1];
    LAST_CARRIAGE = last.offset;
    TRAIN_TAIL = -last.offset + last.len / 2 + 0.35;
    LOCO_AND_CARRIAGE = TRAIN_FRONT + LOCO_HALF + (n > 1 ? lens[1] : 0);
    TRAIN_LENGTH = TRAIN_FRONT + TRAIN_TAIL;
    SPEED_SCALE = TRAIN_LENGTH / LOCO_AND_CARRIAGE;
    LOCO_AHEAD = (TRAIN_TAIL - TRAIN_FRONT) / 2;
    // Bodies span bogie to bogie: middle cars joint to joint, end cars cab bogie to joint
    ACTIVE_LOCO_PIVOT = Math.max(...S423_CARS.map((c) => (c.kind === 'coach' || c.kind === 'cabCar' ? c.len - 2 * RHB.bogieIn : DESIRO ? c.len - bogieInset(c, true) - bogieInset(c, false) : c.len - (c.cabFront ? (LINT ? bogieInset(c, true) : S423_END_BOGIE) : 0) - (c.cabRear ? (LINT ? bogieInset(c, false) : S423_END_BOGIE) : 0)) / 2));
    // The waiting figure: at the last car's rear door
    REAR_DOOR = LOCO_AHEAD + last.offset + s423Doors(last)[0];
  }
  EC = ELECTRIC;
  EC_LIVERY = RAILJET
    ? // Railjet: dark red body, anthracite lower part and roof, silver skirt
      { lower: RJ.red, band: RJ.red, stripe: RJ.bright, red: RJ.anthracite, door: RJ.anthracite, under: RJ.anthracite } // (only the skirt panels are silver)
    : { lower: 0xc9cdd0, band: 0x858b90, stripe: 0xf2f3f4, red: DB_RED, door: 0x9da2a6, under: 0x3a3d41 };
}
/** How far the waiting figure stands in from the platform's back edge (the platform is 1.4 deep). */
const FIGURE_FROM_BACK = 0.718;
/** Platform runs from its back edge (where the building stands), this far inside the track... */
let PLATFORM_INNER = BALLAST_HALF + 2.87; // walkway 2.87 m deep (kept in step with BALLAST_HALF)
/** ...out to the edge of the ballast: no gap between bed and platform. */
let PLATFORM_OUTER = BALLAST_HALF;
/** German standard platform height: 0.76 m above the top of the rail (EBO §13). */
const PLATFORM_HEIGHT = RAIL_Y + RAIL_H / 2 + 0.76;

/**
 * Ring layout. A station's footprint along the track is its platform (one train
 * long) plus a ramp at each end; between neighbouring footprints there is the
 * length of the locomotive and one carriage. No station may sit on the points,
 * so the junction gets a gap of its own, and the stations are spread evenly
 * round the rest of the ring.
 */
const STATION_HALF = () => TRAIN_LENGTH / 2 + RAMP_LEN;
const STATION_PITCH = () => 2 * STATION_HALF() + LOCO_AND_CARRIAGE + 0.615;
/** Clear ground between a ramp foot and the first/last sleeper of the junction. */
const JUNCTION_MARGIN = 1.64;

/** Track length (ring distance from the toe at s = 0, backwards) taken up by the junction. */
const junctionBack = (R: number) => R * Math.asin(-junctionStart(R) / R) + SLEEPER_PITCH;


/**
 * Smallest ring the train can run round without neighbouring vehicles' inside
 * corners meeting: their swing (half-width × centre distance / radius) must stay
 * 0.1 m short of the gap between them.
 */
const MIN_RING_RADIUS = () => {
  const swingRadius = (halfW: number, centreDist: number, gap: number) => (halfW * centreDist) / (gap - 0.1);
  if (S423) return Math.max(18.45, swingRadius(ACTIVE_LOCO_WIDTH / 2, Math.max(...S423_CARS.map((c) => c.len)), 0.6)); // bodies 0.6 m apart at the joints
  let r = Math.max(18.45, swingRadius(Math.max(ACTIVE_LOCO_WIDTH, TRAIN_WIDTH) / 2, LOCO_HALF + LOCO_GAP + CARRIAGE_LEN / 2, LOCO_GAP));
  if (CARRIAGE_COUNT > 1) r = Math.max(r, swingRadius(TRAIN_WIDTH / 2, CARRIAGE_LEN + CARRIAGE_GAP, CARRIAGE_GAP));
  return r;
};

/**
 * Gravel bed and platform edge for a ring of radius R: half the widest vehicle,
 * plus the inward shift of its body's middle on the curve (pivot² / 2R, the body
 * spanning between its pivots), plus clearance.
 */
function setTrackClearance(R: number): void {
  const halfW = Math.max(TRAIN_WIDTH, ACTIVE_LOCO_WIDTH) / 2;
  const pivots = [ACTIVE_LOCO_PIVOT];
  const axles = carriageAxles(CARRIAGE_LEN).xs;
  pivots.push(axles.length === 4 ? (axles[0] + axles[1]) / 2 : axles[0]);
  const inward = Math.max(...pivots.map((p) => R - Math.sqrt(R * R - p * p)));
  BALLAST_HALF = halfW + inward + 0.15;
  PLATFORM_OUTER = BALLAST_HALF;
  PLATFORM_INNER = BALLAST_HALF + 2.87;
}

interface RingLayout {
  R: number;
  /** Ring distance (s) of each station's centre. */
  stationS: number[];
}

/**
 * Stations sit at fixed angles: n stations and the points share the ring evenly, the
 * points taking one slot, so station i is at (i + 1) / (n + 1) × 360° from the points
 * whatever the train or the ring's size. The ring is then made just big enough that
 * neighbouring stations keep their spacing and the stations either side of the
 * points stay clear of the junction.
 */
function ringLayout(n: number): RingLayout {
  const slot = TAU / (n + 1); // angle between neighbouring stations (and either side of the points)
  let R = MIN_RING_RADIUS();
  for (let i = 0; i < 20; i++) {
    R = Math.max(
      MIN_RING_RADIUS(),
      STATION_PITCH() / slot, // station to station
      (JUNCTION_END + STATION_HALF() + JUNCTION_MARGIN) / slot, // first station, after the points
      (junctionBack(R) + STATION_HALF() + JUNCTION_MARGIN) / slot, // last station, before the junction
    );
  }
  const stationS = Array.from({ length: n }, (_, i) => (i + 1) * slot * R);
  return { R, stationS };
}

/** A curved slab covering ring radii [rIn, rOut] between angles a0..a1. */
function arcSlab(rIn: number, rOut: number, a0: number, a1: number, height: number, material: THREE.Material, y = 0) {
  return mesh(arcSlabGeometry(rIn, rOut, a0, a1, height, y), material);
}

function arcSlabGeometry(rIn: number, rOut: number, a0: number, a1: number, height: number, y = 0): THREE.BufferGeometry {
  // Built directly as strips (top, bottom, inner and outer sides) and two end caps, not
  // as an extruded shape: triangulating a whole ring's outline (tens of thousands of
  // points on a big layout) took seconds. Enough segments that long arcs stay smooth:
  // one per ~0.5 m of length.
  const n = Math.max(16, Math.ceil((Math.abs(a1 - a0) * rOut) / 0.513));
  const y0 = y;
  const y1 = y + height;
  const strip = (pt: (i: number, k: 0 | 1) => [number, number, number]) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      pos.push(...pt(i, 0), ...pt(i, 1));
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  };
  const at = (i: number, r: number, h: number): [number, number, number] => {
    const t = a0 + ((a1 - a0) * i) / n;
    return [r * Math.cos(t), h, r * Math.sin(t)];
  };
  const parts = [
    strip((i, k) => at(i, k ? rOut : rIn, y1)), // top
    strip((i, k) => at(i, k ? rIn : rOut, y0)), // bottom
    strip((i, k) => at(i, rOut, k ? y0 : y1)), // outer side
    strip((i, k) => at(i, rIn, k ? y1 : y0)), // inner side
  ];
  for (const [i, flip] of [[0, false], [n, true]] as const) {
    const c = [at(i, rIn, y0), at(i, rOut, y0), at(i, rOut, y1), at(i, rIn, y1)];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(c.flat(), 3));
    g.setIndex(flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    parts.push(g);
  }
  // (make each part face outwards: wind it the way its normal should point)
  for (const g of parts) g.computeVertexNormals();
  const geo = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return geo;
}

/** A curved rail of radius r between angles a0..a1 (about the origin), with the rectangular cross-section. */
const railArc = (r: number, a0: number, a1: number) =>
  arcSlabGeometry(r - RAIL_W / 2, r + RAIL_W / 2, a0, a1, RAIL_H, RAIL_Y - RAIL_H / 2);

const platformMat = () => mat(0xd8d2c4);
// (biased towards the camera: 3 mm proud of the platform is too little depth to tell apart
// from far off, so it flickered through)
const edgeMat = () => mat(0xf2c94c, { polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

/** Curved platform on the inside of the ring, centred on ring angle a, one train long at the track. */
function addRingPlatform(parent: THREE.Object3D, R: number, a: number): void {
  const half = TRAIN_LENGTH / 2 / R;
  // Front edge follows the track. The back edge follows it too, at R - PLATFORM_INNER,
  // except along the front of the station building, where it runs straight.
  const rOut = R - PLATFORM_OUTER;
  const rBack = R - PLATFORM_INNER;
  const d = buildingHalfAngle(R);
  const at = (r: number, ang: number) => [r * Math.cos(ang), r * Math.sin(ang)] as const;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOut, a - half, a + half, false);
  shape.lineTo(...at(rBack, a + half));
  shape.absarc(0, 0, rBack, a + half, a + d, true);
  shape.lineTo(...at(rBack, a - d)); // straight, along the building's front
  shape.absarc(0, 0, rBack, a - d, a - half, true);
  shape.closePath();
  const slab = new THREE.ExtrudeGeometry(shape, { depth: PLATFORM_HEIGHT, bevelEnabled: false, curveSegments: 48 })
    .rotateX(Math.PI / 2)
    .translate(0, PLATFORM_HEIGHT, 0);
  parent.add(mesh(slab, platformMat()));
  parent.add(
    // the yellow safety line, painted flush on the platform surface (not a raised strip)
    arcSlab(R - PLATFORM_OUTER - 0.287, R - PLATFORM_OUTER - 0.041, a - half, a + half, 0.003, edgeMat(), PLATFORM_HEIGHT),
  );
  // Ramps off both ends, curving with the platform
  parent.add(curvedRamp(R, a + half, 1, rBack));
  parent.add(curvedRamp(R, a - half, -1, rBack));
}

/** Angle either side of the station's centre covered by the building's front, on the platform's back edge. */
const buildingHalfAngle = (R: number) => Math.asin(BUILDING.w / 2 / (R - PLATFORM_INNER));

/**
 * Ramp continuing a curved platform round the ring from angle `start`, in
 * direction `dir` (+1 / -1), sloping from platform height to the ground over
 * RAMP_LEN of track.
 */
function curvedRamp(R: number, start: number, dir: 1 | -1, rIn: number): THREE.Mesh {
  const rOut = R - PLATFORM_OUTER;
  const sweep = RAMP_LEN / R;
  const steps = 12;
  const p = (r: number, i: number, top: boolean) => {
    const a = start + dir * (i / steps) * sweep;
    const y = top ? PLATFORM_HEIGHT * (1 - i / steps) : 0;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  };
  // Each surface (slope, inner side, outer side) is curved, so it's smooth-shaded on
  // its own: flat-shaded facets would show as diagonal stripes along the triangle
  // splits. Separate surfaces keep crisp edges between them.
  const surface = (quads: (i: number) => number[][]) => {
    const tris: number[] = [];
    for (let i = 0; i < steps; i++) {
      const [a, b, c, d] = quads(i);
      tris.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
    const merged = mergeVertices(g); // shared vertices, so normals average across the surface
    merged.computeVertexNormals();
    return merged;
  };
  const geo = mergeGeometries([
    surface((i) => [p(rIn, i, true), p(rOut, i, true), p(rIn, i + 1, true), p(rOut, i + 1, true)]), // slope
    surface((i) => [p(rIn, i, false), p(rIn, i, true), p(rIn, i + 1, false), p(rIn, i + 1, true)]), // inner side
    surface((i) => [p(rOut, i, false), p(rOut, i, true), p(rOut, i + 1, false), p(rOut, i + 1, true)]), // outer side
  ])!;
  const m = mesh(geo, mat(0xd8d2c4, { side: THREE.DoubleSide }));
  // Double-sided, so casting would put its back faces into the shadow map and it
  // would shade itself in stripes (shadow acne). Its own shadow isn't visible anyway.
  m.castShadow = false;
  return m;
}

/** Straight platform beside the lead-in (on the far side, z < -R), centred on x; returns it. */
function addStraightPlatform(parent: THREE.Object3D, R: number, x: number): THREE.Group {
  const out = new THREE.Group();
  parent.add(out);
  parent = out;
  const depth = PLATFORM_INNER - PLATFORM_OUTER;
  parent.add(box(TRAIN_LENGTH, PLATFORM_HEIGHT, depth, platformMat(), x, PLATFORM_HEIGHT / 2, -R - PLATFORM_OUTER - depth / 2));
  parent.add(box(TRAIN_LENGTH, 0.003, 0.246, edgeMat(), x, PLATFORM_HEIGHT + 0.0015, -R - PLATFORM_OUTER - 0.164)); // safety line, painted flush
  const z = -R - PLATFORM_OUTER - depth / 2;
  parent.add(platformRamp(x + TRAIN_LENGTH / 2, z, 0));
  parent.add(platformRamp(x - TRAIN_LENGTH / 2, z, Math.PI));
  return out;
}

const RAMP_LEN = 2.665;

/**
 * Wedge sloping from platform height down to the ground. Placed at the middle of
 * a platform end; yaw points its local +X (downhill) away from the platform.
 */
function platformRamp(x: number, z: number, yaw: number): THREE.Mesh {
  const depth = PLATFORM_INNER - PLATFORM_OUTER;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(RAMP_LEN, 0);
  shape.lineTo(0, PLATFORM_HEIGHT);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  const ramp = mesh(geo, platformMat(), x, 0, z);
  ramp.rotation.y = yaw;
  return ramp;
}

// ---------------------------------------------------------------------------
// Track: sleepers, rails and the points (turnout) where the lead-in joins
// ---------------------------------------------------------------------------
//
// The lead-in meets the ring at a tangent at x = 0, z = -R: that is the toe of
// the points. Going back from there (x < 0) the ring curves away from the
// straight. Through the junction both tracks share long timbers laid square to
// the straight, each spanning both tracks; once the tracks are far enough apart
// for ordinary sleepers, each goes back to its own.

/** Sleeper length: a German B70 concrete sleeper, or a metre-gauge one (set by deriveStock). */
let SLEEPER_LEN = 2.6;
const SLEEPER_PITCH = 1.128;
/** Rail cross-section: a rectangle twice as tall as it is wide. Top at 0.215 (where the wheels run), bottom on the sleepers. */
const RAIL_W = 0.092;
const BLADE_LEN = 4.92;
/** How far the toe of an open blade stands off from its stock rail. */
const BLADE_THROW = 0.226;

/** x where the tracks are far enough apart for separate sleepers. */
const junctionStart = (R: number) => -Math.sqrt(R * R - (R - SLEEPER_LEN - 0.205) ** 2);
const JUNCTION_END = 0.82;

function buildSleepers(R: number, leadStart: number): THREE.InstancedMesh {
  const x0 = junctionStart(R);
  const timberXs: number[] = [];
  for (let x = x0; x <= JUNCTION_END; x += SLEEPER_PITCH) timberXs.push(x);
  const xLast = timberXs[timberXs.length - 1];
  // Ring sleepers near x0 are tilted (radial), so their near end reaches further
  // towards the timbers than their centre; allow for that on top of a full pitch.
  const tilt = (SLEEPER_LEN / 2) * Math.abs(x0 / R);
  const leftLimit = x0 - SLEEPER_PITCH - tilt; // closest a ring sleeper may come on the curve side
  const rightLimit = xLast + SLEEPER_PITCH * 0.9;
  const inJunction = (x: number) => x > leftLimit && x < rightLimit;
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  const add = (x: number, z: number, yaw: number, len: number) => {
    dummy.position.set(x, 0.144, z);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, len);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  };

  // Ring: radial sleepers, except through the junction
  const count = Math.round((TAU * R) / SLEEPER_PITCH);
  let nearestLeft = -Infinity;
  let nearestRight = Infinity;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const x = R * Math.cos(a);
    const z = R * Math.sin(a);
    if (z < 0 && inJunction(x)) continue;
    add(x, z, tangentYaw(a), SLEEPER_LEN);
    if (z < 0 && x <= leftLimit) nearestLeft = Math.max(nearestLeft, x);
    if (z < 0 && x >= rightLimit) nearestRight = Math.min(nearestRight, x);
  }
  // The ring's evenly spaced sleepers don't line up with the junction, so the gap
  // to the timbers can be nearly two pitches; if so, add one at exactly the limit.
  const addRingAtX = (x: number) => {
    const a = -Math.PI / 2 + Math.asin(x / R); // far side of the ring (z < 0)
    add(R * Math.cos(a), R * Math.sin(a), tangentYaw(a), SLEEPER_LEN);
  };
  if (leftLimit - nearestLeft > SLEEPER_PITCH * 0.5) addRingAtX(leftLimit);
  if (nearestRight - rightLimit > SLEEPER_PITCH * 0.5) addRingAtX(rightLimit);
  // Lead-in: evenly pitched back from one pitch before the first timber
  for (let x = x0 - SLEEPER_PITCH; x > leadStart + 0.205; x -= SLEEPER_PITCH) add(x, -R, 0, SLEEPER_LEN);
  // Junction timbers, square to the straight, lengthening as the ring pulls away
  for (const x of timberXs) {
    const zRing = -Math.sqrt(R * R - x * x);
    const z0 = -R - SLEEPER_LEN / 2;
    const z1 = zRing + SLEEPER_LEN / 2;
    add(x, (z0 + z1) / 2, 0, z1 - z0);
  }

  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.451, 0.205, 1), mat(0x6b4a2f), matrices.length);
  matrices.forEach((m, i) => sleepers.setMatrixAt(i, m));
  sleepers.castShadow = true;
  sleepers.receiveShadow = true;
  sleepers.computeBoundingSphere();
  return sleepers;
}

interface Blade {
  pivot: THREE.Group;
  closedYaw: number;
  /** Extra yaw that swings the toe away from its stock rail. */
  openYaw: number;
}

interface Points {
  a: Blade; // straight-route blade
  b: Blade; // ring-route blade
  bar: THREE.Mesh; // stretcher bar tying the blades together
  rod: THREE.Mesh; // drive rod from the point motor
  barX: number;
  /** 0 = set for the straight (lead-in), 1 = set for the ring. */
  k: number;
}

let points: Points | null = null;

/** A switch blade pivoting at its heel, tapering to a point at the toe. */
function makeBlade(heelX: number, heelZ: number, toeX: number, toeZ: number, openDir: 1 | -1, material: THREE.Material) {
  const len = Math.hypot(toeX - heelX, toeZ - heelZ);
  const geo = new THREE.BoxGeometry(len, RAIL_H, RAIL_W).translate(len / 2, 0, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getX(i) > len * 0.99) pos.setZ(i, pos.getZ(i) * 0.3);
  }
  geo.computeVertexNormals();
  const pivot = new THREE.Group();
  pivot.position.set(heelX, RAIL_Y, heelZ);
  pivot.add(mesh(geo, material));
  // rotation.y = φ points local +X at (cos φ, 0, -sin φ)
  const closedYaw = Math.atan2(-(toeZ - heelZ), toeX - heelX);
  // Positive yaw swings the toe towards -z
  const openYaw = (openDir === -1 ? 1 : -1) * (BLADE_THROW / len);
  pivot.rotation.y = closedYaw;
  return { pivot, closedYaw, openYaw } satisfies Blade;
}

function buildRails(R: number, leadStart: number): THREE.Group {
  const g = new THREE.Group();
  const railMat = mat(0x9aa3ab, { metalness: 0.8, roughness: 0.35 });
  const rOuter = R + RAIL_HALF_GAUGE; // ring rail nearest the straight at the junction
  const rInner = R - RAIL_HALF_GAUGE;
  const toeAngle = JOIN_ANGLE;
  const heelAngle = JOIN_ANGLE - Math.asin(BLADE_LEN / rOuter);

  // The crossing (frog): where the straight's inner rail (A) and the ring's outer
  // rail (B) cross at a shallow angle. Coming from the points, the two closure
  // rails stop at the throat, still a flange-width apart, then kink outwards and
  // run on as wing rails along both sides of the nose. The nose is the V of the
  // two onward rails, touching at its tip just beyond the crossing point.
  const crossX = -Math.sqrt(rOuter * rOuter - rInner * rInner); // where z = -R + gauge/2 meets radius rOuter
  const crossAngle = JOIN_ANGLE - Math.asin(-crossX / rOuter);
  const frogAngle = Math.asin(-crossX / rOuter); // angle between the two rails at the crossing
  const zIn = -R + RAIL_HALF_GAUGE;
  const throatGap = 0.226; // centre-to-centre separation of the closure rails where they stop
  const toThroat = throatGap / Math.tan(frogAngle); // distance before the crossing point
  const toNose = (RAIL_W * 0.8) / Math.tan(frogAngle); // nose tip: the onward rails just touching
  const WING_OFF = 0.164; // wing rail centre to nose leg centre (the flangeway)
  const WING_TO = crossX - 1.128; // how far past the crossing the wing rails run
  const zB = (x: number) => -Math.sqrt(rOuter * rOuter - x * x); // rail B's z at x (far side of the ring)

  /** A straight piece of rail between two points in the ground plane. */
  const railSegment = (x1: number, z1: number, x2: number, z2: number) => {
    const seg = box(Math.hypot(x2 - x1, z2 - z1), RAIL_H, RAIL_W, railMat, (x1 + x2) / 2, RAIL_Y, (z1 + z2) / 2);
    seg.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
    return seg;
  };

  // Ring inner rail: unbroken (it is the stock rail for the straight-route blade)
  g.add(mesh(railArc(rInner, 0, TAU), railMat));
  // Rail B: from the toe all the way round to the nose...
  g.add(mesh(railArc(rOuter, toeAngle, crossAngle - toNose / rOuter + TAU), railMat));
  // ...and its closure rail, from the throat up to the heel of its blade
  g.add(mesh(railArc(rOuter, crossAngle + toThroat / rOuter, heelAngle), railMat));

  // Straight outer rail: unbroken to the toe (stock rail for the ring-route blade)
  g.add(box(-leadStart, RAIL_H, RAIL_W, railMat, leadStart / 2, RAIL_Y, -R - RAIL_HALF_GAUGE));
  // Rail A: from the tunnel up to the nose...
  const beyondLen = crossX - toNose - leadStart;
  g.add(box(beyondLen, RAIL_H, RAIL_W, railMat, leadStart + beyondLen / 2, RAIL_Y, zIn));
  // ...and its closure rail, from the throat up to the heel of its blade
  const closureFrom = crossX + toThroat;
  const closureLen = -BLADE_LEN - closureFrom;
  g.add(box(closureLen, RAIL_H, RAIL_W, railMat, closureFrom + closureLen / 2, RAIL_Y, zIn));

  // Wing rails: A's closure kinks out to run outside nose leg B; B's closure kinks
  // out to run outside nose leg A
  const throatX = crossX + toThroat;
  g.add(railSegment(throatX, zIn, WING_TO, zB(WING_TO) + WING_OFF / Math.cos(frogAngle)));
  g.add(railSegment(throatX, zB(throatX), WING_TO, zIn - WING_OFF));

  // Check rails: short guard rails just inside the opposite stock rails, holding the
  // wheels on line while they cross the gap
  const CHECK_LEN = 2.87;
  const CHECK_OFF = 0.164;
  g.add(box(CHECK_LEN, RAIL_H * 0.8, RAIL_W, railMat, crossX, RAIL_Y, -R - RAIL_HALF_GAUGE + CHECK_OFF));
  const checkHalf = CHECK_LEN / 2 / rInner;
  const ringCrossAngle = JOIN_ANGLE - Math.asin(-crossX / R); // level with the crossing, on the ring
  g.add(mesh(railArc(rInner + CHECK_OFF, ringCrossAngle - checkHalf, ringCrossAngle + checkHalf), railMat));

  // The blades. Straight route: A closed, B open. Ring route: A open, B closed.
  const zA = -R + RAIL_HALF_GAUGE;
  const a = makeBlade(-BLADE_LEN, zA, 0, zA, -1, railMat);
  const b = makeBlade(rOuter * Math.cos(heelAngle), rOuter * Math.sin(heelAngle), 0, -rOuter, 1, railMat);
  g.add(a.pivot, b.pivot);

  // Stretcher bar between the blades near the toe, and a point motor driving it
  const steel = mat(0x4d5656, { metalness: 0.5, roughness: 0.5 });
  const barX = -0.718;
  const bar = box(0.123, 0.082, 2 * RAIL_HALF_GAUGE, steel, barX, 0.267, -R);
  const rod = box(0.103, 0.082, 1.23, steel, barX, 0.267, -R);
  g.add(bar, rod);
  g.add(box(1.025, 0.615, 0.718, mat(0x7f8c8d), barX, 0.308, -R - RAIL_HALF_GAUGE - 1.538));

  points = { a, b, bar, rod, barX, k: pointsTarget() };
  setPoints(points.k);
  return g;
}

/** Points are set for the lead-in until the whole train has passed the toe. */
const pointsTarget = () => (state.s - TRAIN_TAIL > 0.615 ? 1 : 0);

function setPoints(k: number): void {
  if (!points) return;
  points.k = k;
  const { a, b, bar, rod } = points;
  a.pivot.rotation.y = a.closedYaw + k * a.openYaw;
  b.pivot.rotation.y = b.closedYaw + (1 - k) * b.openYaw;
  // The bar shifts across with the blades (by their throw at the bar's position)
  const shift = BLADE_THROW * ((BLADE_LEN + points.barX) / BLADE_LEN) * (0.5 - k);
  const R = state.radius;
  bar.position.z = -R + shift;
  rod.position.z = -R + shift - RAIL_HALF_GAUGE - 0.615;
}

function updatePoints(dt: number): void {
  if (!points) return;
  const target = pointsTarget();
  if (points.k === target) return;
  const step = dt / 0.6; // takes 0.6 s to throw
  setPoints(target > points.k ? Math.min(target, points.k + step) : Math.max(target, points.k - step));
}

/**
 * How lit a point inside the tunnel is: full light at the start of the curve,
 * fading to near-black a few units in (matching the stone lining). Shadows only
 * block the sun, not the sky light, so the darkness has to be painted on.
 */
function tunnelLight(x: number, z: number, x0: number, R: number): number {
  const phi = Math.atan2(z, x - x0); // -π/2 at the start of the curve, -π at the end
  return tunnelShade(2.05 + Math.max(0, (-Math.PI / 2 - phi) * R)); // +1: the portal wall's depth
}

/** Add a vertex colour attribute that darkens the geometry with depth into the tunnel. */
function darkenInTunnel(geo: THREE.BufferGeometry, x0: number, R: number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors.fill(tunnelLight(pos.getX(i), pos.getZ(i), x0, R), i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Ballast, sleepers and rails round the 90° curve inside the tunnel (centre (x0, 0), radius R). */
function buildTunnelTrack(R: number, x0: number): THREE.Group {
  const g = new THREE.Group();
  // World angles -π..-π/2 about (x0, 0); RingGeometry's θ maps to world -θ once laid flat.
  const ballastGeo = new THREE.RingGeometry(R - BALLAST_HALF, R + BALLAST_HALF, 64, 4, Math.PI / 2, Math.PI / 2)
    .rotateX(-Math.PI / 2)
    .translate(x0, 0.062, 0);
  const ballast = new THREE.Mesh(
    darkenInTunnel(ballastGeo, x0, R),
    new THREE.MeshBasicMaterial({ color: 0x9a8f80, vertexColors: true }),
  );
  ballast.receiveShadow = true;
  g.add(ballast);

  const count = Math.floor(((Math.PI / 2) * R) / SLEEPER_PITCH);
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.451, 0.205, SLEEPER_LEN), new THREE.MeshBasicMaterial({ color: 0x6b4a2f }), count);
  const dummy = new THREE.Object3D();
  const shade = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const phi = -Math.PI / 2 - ((k + 0.5) * SLEEPER_PITCH) / R;
    const x = x0 + R * Math.cos(phi);
    const z = R * Math.sin(phi);
    dummy.position.set(x, 0.144, z);
    dummy.rotation.set(0, tangentYaw(phi), 0);
    dummy.updateMatrix();
    sleepers.setMatrixAt(k, dummy.matrix);
    const l = tunnelLight(x, z, x0, R);
    sleepers.setColorAt(k, shade.setRGB(l, l, l));
  }
  sleepers.receiveShadow = true;
  g.add(sleepers);

  // Unlit, like the lining: no sun or shadow edges inside the tunnel
  const railMat = new THREE.MeshBasicMaterial({ color: 0x9aa3ab, vertexColors: true });
  for (const r of [R - RAIL_HALF_GAUGE, R + RAIL_HALF_GAUGE]) {
    const rail = railArc(r, -Math.PI, -Math.PI / 2).translate(x0, 0, 0);
    g.add(mesh(darkenInTunnel(rail, x0, R), railMat));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Overhead line (only with an electric locomotive)
// ---------------------------------------------------------------------------

/** Contact wire zigzag either side of the track centre at the supports. */
const STAGGER = 0.4;
/** Realistic maximum span between supports on straight track. */
const MAX_SPAN = 65;
/** Supporting wire this far above the contact wire (the system height). */
const SYSTEM_HEIGHT = 1.4;
/** Masts stand this far from the track centre. */
const MAST_OFFSET = 3.0;

/**
 * Longest span on a curve of radius R: the wire runs straight between supports,
 * so mid-span it drifts inwards by span² / 8R. Pulled STAGGER outwards at the
 * supports, it may drift to STAGGER inside the centre, so span² / 8R ≤ 2·STAGGER.
 */
const curveSpan = (R: number) => Math.min(MAX_SPAN, Math.sqrt(16 * R * STAGGER));

/**
 * Contact wire, supporting wire with droppers, and masts with cantilever arms over
 * the track: round the ring, along the lead-in, and (contact wire only) into the tunnel.
 */
function buildCatenary(R: number, terrain: Terrain, homeX: number): THREE.Group {
  const steel = mat(0x8c9196, { metalness: 0.6, roughness: 0.45 });
  const wireMat = mat(0x6b5a45, { metalness: 0.5, roughness: 0.5 });
  const parts: { geo: THREE.BufferGeometry; m: THREE.Material }[] = [];
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  /** A thin cylinder between two points. */
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => {
    const len = a.distanceTo(b);
    if (len < 1e-4) return;
    const geo = new THREE.CylinderGeometry(r, r, len, 6);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push({ geo, m });
  };
  const messY = CONTACT_WIRE_Y + SYSTEM_HEIGHT;

  /** Wire spans through support points: contact wire, plus supporting wire and droppers if `full`. */
  const wire = (pts: THREE.Vector3[], full: boolean, closed: boolean) => {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      rod(a, b, 0.015, wireMat);
      if (!full) continue;
      const am = v(a.x, messY, a.z);
      const bm = v(b.x, messY, b.z);
      rod(am, bm, 0.012, wireMat);
      const drops = Math.max(2, Math.round(a.distanceTo(b) / 6));
      for (let k = 1; k < drops; k++) {
        const t = k / drops;
        const c = a.clone().lerp(b, t);
        rod(c, v(c.x, messY, c.z), 0.006, wireMat);
      }
    }
  };

  /** A mast at (mx, mz) with a cantilever reaching over to the wire point w. */
  const mast = (mx: number, mz: number, w: THREE.Vector3) => {
    const top = messY + 0.6;
    parts.push({ geo: new THREE.BoxGeometry(0.22, top, 0.22).translate(mx, top / 2, mz), m: steel });
    // Cantilever: an arm at the supporting wire's height, a registration arm to the
    // contact wire, and a brace
    const dx = w.x - mx;
    const dz = w.z - mz;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const over = v(w.x + ux * 0.3, messY, w.z + uz * 0.3);
    rod(v(mx, messY, mz), over, 0.04, steel);
    rod(v(mx, CONTACT_WIRE_Y + 0.25, mz), v(w.x, CONTACT_WIRE_Y + 0.02, w.z), 0.03, steel);
    rod(v(mx, CONTACT_WIRE_Y + 0.25, mz), v(mx + ux * len * 0.6, messY, mz + uz * len * 0.6), 0.03, steel);
  };

  // Where masts may not stand
  const nearLeadIn = (x: number, z: number) => Math.abs(z + R) < MAST_OFFSET - 0.4 && x > terrain.portalX - 2 && x < 3;
  const nearRing = (x: number, z: number) => Math.abs(Math.hypot(x, z) - R) < MAST_OFFSET - 0.4;
  const onHill = (x: number, z: number) => terrain.height(x, z) > 0.3;
  const onRingPlatform = (a: number) =>
    stations.some((st) => Math.abs(mod(a - st.angle + Math.PI, TAU) - Math.PI) < (TRAIN_LENGTH / 2 + RAMP_LEN + 1.5) / R);
  const onHomePlatform = (x: number, z: number) =>
    Math.abs(x - homeX) < TRAIN_LENGTH / 2 + RAMP_LEN + 1.5 && z < -R && z > -R - PLATFORM_INNER - BUILDING.d - 1;

  // Ring: as few supports as the curve allows, the wire pulled outwards at each
  // Supports keep clear of the station buildings (not right in front of them): a mast
  // that would fall in front of one moves to the nearer side of it. Spans are planned
  // a little shorter than the limit to leave room for that.
  const ringN = Math.ceil((TAU * R) / (curveSpan(R) * 0.75));
  const keepClear = (BUILDING.w / 2 + 1.5) / R;
  const clearOfStations = (a: number) => {
    for (const st of stations) {
      const d = mod(a - st.angle + Math.PI, TAU) - Math.PI;
      if (Math.abs(d) < keepClear) return st.angle + (d >= 0 ? keepClear : -keepClear);
    }
    return a;
  };
  const ringPts: THREE.Vector3[] = [];
  for (let k = 0; k < ringN; k++) {
    const a = clearOfStations(JOIN_ANGLE + (k / ringN) * TAU);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const w = v((R + STAGGER) * c, CONTACT_WIRE_Y, (R + STAGGER) * sn);
    ringPts.push(w);
    const outX = (R + MAST_OFFSET) * c;
    const outZ = (R + MAST_OFFSET) * sn;
    const inX = (R - MAST_OFFSET) * c;
    const inZ = (R - MAST_OFFSET) * sn;
    if (!nearLeadIn(outX, outZ) && !onHill(outX, outZ)) mast(outX, outZ, w);
    else if (!nearLeadIn(inX, inZ) && !onRingPlatform(a)) mast(inX, inZ, w);
  }
  wire(ringPts, true, true);

  // Lead-in: straight, so long spans, zigzagging either side of the centre
  const leadFrom = terrain.portalX + 2;
  const leadN = Math.max(1, Math.ceil(-leadFrom / MAX_SPAN));
  const leadPts: THREE.Vector3[] = [];
  for (let k = 0; k <= leadN; k++) {
    const x = leadFrom + (-leadFrom * k) / leadN;
    const zig = (k % 2 ? 1 : -1) * STAGGER;
    const w = v(x, CONTACT_WIRE_Y, -R + zig);
    leadPts.push(w);
    if (k === leadN) continue; // the junction end is carried by the ring's supports
    for (const side of [1, -1]) {
      const mz = -R + side * MAST_OFFSET;
      if (nearRing(x, mz) || onHill(x, mz) || onHomePlatform(x, mz)) continue;
      mast(x, mz, w);
      break;
    }
  }
  wire(leadPts, true, false);

  // Into the tunnel: contact wire only (no room for the supporting wire), following the curve
  const tunnelPts: THREE.Vector3[] = [v(leadFrom, CONTACT_WIRE_Y, -R), v(terrain.curveStartX, CONTACT_WIRE_Y, -R)];
  const arcLen = (Math.PI / 2) * R;
  const steps = Math.max(2, Math.ceil(arcLen / curveSpan(R)));
  for (let k = 1; k <= steps; k++) {
    const phi = -Math.PI / 2 - (k / steps) * (Math.PI / 2);
    tunnelPts.push(v(terrain.curveStartX + R * Math.cos(phi), CONTACT_WIRE_Y, R * Math.sin(phi)));
  }
  wire(tunnelPts, false, false);

  // Merge into one mesh per material
  const group = new THREE.Group();
  for (const m of [steel, wireMat]) {
    const geos = parts.filter((p) => p.m === m).map((p) => p.geo.toNonIndexed());
    if (!geos.length) continue;
    const merged = mergeGeometries(geos.map((g) => { g.deleteAttribute('uv'); return g; }))!;
    const meshObj = new THREE.Mesh(merged, m);
    meshObj.castShadow = m === steel;
    group.add(meshObj);
  }
  return group;
}

let world: THREE.Group | null = null;
let stations: Station[] = [];
let homeStation: Station | null = null;
let homePlatform: THREE.Group | null = null;
/** The home station (building, signs, platform) shows only once you've given your name; the train stops there either way. */
function showHomeStation(): void {
  const shown = !!myName;
  if (homeStation) homeStation.group.visible = shown;
  if (homePlatform) homePlatform.visible = shown;
}

function buildWorld(): void {
  if (world) {
    scene.remove(world);
    disposeTree(world);
  }
  world = new THREE.Group();
  scene.add(world);

  const n = state.names.length;
  const prevRadius = state.radius;
  assignPillColors([...state.names, homeName()]);
  const layout = ringLayout(n);
  const R = (state.radius = layout.R);
  signScale = Math.max(1, R / 51.25);
  setTrackClearance(R);

  // Keep the train in a sensible place if the ring size changed.
  const start = (homeStartS = startS(R, layout.stationS));

  // Straight lead-in along z = -R, from the buffer stop to the junction at x = 0.
  // The train starts at the home station, its whole length alongside the platform.
  const homeX = start - LOCO_AHEAD;
  // Left of the home station the ground rises into a hill; the line carries on
  // through a cutting and into a tunnel.
  const slopeStart = Math.min(homeX - STATION_HALF() - 4.1, -R - 6.15);
  // On the tunnel curve the carriage's ends swing out by (half-length)² / 2R; widen the bore for that.
  const swing = (S423 ? Math.max(...S423_CARS.map((c) => c.len / 2)) : Math.max(CARRIAGE_LEN / 2, LOCO_HALF)) ** 2 / (2 * R);
  // Fog scales with the ring: unchanged up to a radius of ~51 m, further out beyond.
  // The ground grows too, so its edge is always lost in the fog.
  fogBase = { near: Math.max(102.5, R * 2), far: Math.max(266.5, R * 5.2) };
  updateFog();
  // (a detailed ground as before, and a coarser one round it out to the forest's edge)
  const groundSize = Math.max(656, R * 10);
  const terrain = makeTerrain(-R, slopeStart, groundMat, BALLAST_HALF, R, swing + 0.164, groundSize, groundSize * WORLD_SCALE);
  world.add(terrain.group);
  tunnelMouthX = terrain.portalX;
  tunnelCurveX = terrain.curveStartX;
  // Branch landmarks (train midpoint): end of the tunnel bore, tunnel mouth, home station, the points
  branchMarks = [terrain.curveStartX - (Math.PI / 2) * R, terrain.portalX, homeX, 0];
  state.s = posToS(state.pos); // the layout may have changed size: place the train from its position
  groundHeight = terrain.height;
  const leadStart = terrain.curveStartX; // straight ends behind the portal wall; then the tunnel curve
  world.add(buildTunnelTrack(R, leadStart));
  const leadLen = -leadStart;

  // Ballast beds
  const ballastMat = mat(0x9a8f80, { roughness: 1 });
  const ballast = new THREE.Mesh(new THREE.RingGeometry(R - BALLAST_HALF, R + BALLAST_HALF, 180), ballastMat);
  ballast.rotation.x = -Math.PI / 2;
  ballast.position.y = 0.041;
  ballast.receiveShadow = true;
  world.add(ballast);
  const leadBallast = new THREE.Mesh(new THREE.PlaneGeometry(leadLen, BALLAST_HALF * 2), ballastMat);
  leadBallast.rotation.x = -Math.PI / 2;
  leadBallast.position.set(leadStart / 2, 0.062, -R); // a touch above the ring's bed where they overlap
  leadBallast.receiveShadow = true;
  world.add(leadBallast);

  world.add(buildSleepers(R, leadStart));
  world.add(buildRails(R, leadStart));


  // Home station: on the far side of the lead-in, platform facing the track
  const home = (homeStation = makeStation(homeName(), HOME_COLOR, 1));
  home.group.position.set(homeX, 0, -R - PLATFORM_INNER);
  world.add(home.group);
  homePlatform = addStraightPlatform(world, R, homeX);
  showHomeStation();

  // Stations, inside the ring, platforms facing out towards the track
  stations = state.names.map((name, i) => {
    const st = makeStation(name, STATION_COLORS[i % STATION_COLORS.length], -1);
    st.angle = JOIN_ANGLE + layout.stationS[i] / R;
    // The building's front sits on the straight part of the platform's back edge (a chord)
    const r = (R - PLATFORM_INNER) * Math.cos(buildingHalfAngle(R));
    st.group.position.set(r * Math.cos(st.angle), 0, r * Math.sin(st.angle));
    st.group.rotation.y = tangentYaw(st.angle) + Math.PI;
    world!.add(st.group);
    addRingPlatform(world!, R, st.angle);
    // Name boards: on the curve, just behind the platform's back edge, facing the track,
    // halfway (in angle) between the building's ends and the platform's ends
    const boardR = R - PLATFORM_INNER - BOARD.behind;
    const boardA = (buildingHalfAngle(R) + TRAIN_LENGTH / 2 / R) / 2;
    st.group.updateMatrixWorld();
    st.boards.forEach((b, i) => {
      const da = (i ? 1 : -1) * boardA;
      // (local −x is +angle: the group faces back along the ring)
      const ba = st.angle - da;
      b.position.copy(st.group.worldToLocal(new THREE.Vector3(boardR * Math.cos(ba), 0, boardR * Math.sin(ba))));
      b.rotation.y = da;
    });
    // Stand the waiting figure on the curved platform, level with the first door at or
    // behind the front board (measured along the track; the train runs towards +angle),
    // at a fixed distance in from the platform's back edge. Along a straight line from
    // the centre it would drift towards the track.
    const figR = R - PLATFORM_INNER + FIGURE_FROM_BACK;
    const figA = st.angle + figureDoor(boardA * R) / R;
    st.figure.position.copy(st.group.worldToLocal(new THREE.Vector3(figR * Math.cos(figA), 0, figR * Math.sin(figA))));
    st.figure.position.y = PLATFORM_HEIGHT;
    return st;
  });

  if (ELECTRIC && !LINT) world.add(buildCatenary(R, terrain, homeX)); // electric: needs overhead wires

  // Fit the shadow camera to the layout (the lead-in sticks out to the left)
  const ext = Math.max(R + 16.4, -(terrain.curveStartX - R) + 6.15);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 2.05, far: 246 });
  sun.shadow.camera.updateProjectionMatrix();

  // Default view: from just past the tunnel portal on the left, and just past the
  // front and back of the ring (including the signs of the stations at the back).
  const left = Math.min(homeX - TRAIN_LENGTH / 2 - RAMP_LEN - 0.82, terrain.portalX - 3.075);
  const signTop = signCentreY() + signHeight() / 2 + 0.205;
  fitPoints = [
    new THREE.Vector3(left, 0, -R),
    new THREE.Vector3(left, signTop, -R - PLATFORM_INNER), // home station's sign
    new THREE.Vector3(0, signTop, -R + PLATFORM_INNER), // sign of a station at the back
    // The whole ring, ballast included
    ...Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * TAU;
      return new THREE.Vector3((R + 2.46) * Math.cos(a), 0, (R + 2.46) * Math.sin(a));
    }),
  ];

  // (after fitPoints: how far it reaches depends on the overview. ?trees=false leaves the forest out: much quicker to build and draw on a big layout)
  if (SHOW_TREES) world.add(makeForest(R, terrain));
  else {
    treeGrid = new Map();
    forestLeafTiles = [];
  }
  // (after the forest: its snow caps and frosted leaves follow the weather too)
  showWeather();

  // The picked station carries over (stations are rebuilt, so find it again by name)
  const winnerName = state.winner?.name;
  state.winner = stations.find((st) => st.name === winnerName) ?? null;
  refreshStations();
  // If the ring changed size, the camera goes back to its default view: the close-up
  // of the picked station if that's what was showing, otherwise the overview
  if (prevRadius !== R || !camera.position.lengthSq()) resetCamera();
}

function resetCamera(): void {
  flight = null;
  userMovedCamera = false;
  if (state.winner && !state.run) {
    // Someone is picked and the train is standing at their station: centre on it
    inStationView = true;
    const view = stationView(state.winner);
    camera.position.copy(view.pos);
    controls.target.copy(view.target);
    controls.update();
  } else {
    inStationView = false;
    frameCamera();
  }
}

// ---------------------------------------------------------------------------
// Train
// ---------------------------------------------------------------------------

/**
 * Full width of the locomotive and carriage bodies: ~0.29 m short of the platform
 * edges (±1.74 m, the ballast's edge) each side. Everything this wide is above
 * 1.39 m, clear of the ~1.2 m-high platforms. On the ring the car ends swing outwards,
 * away from the (inside) platforms, so the middle of each car is the closest point.
 */
const TRAIN_WIDTH = 2.9; // carriages: close to a real coach (~2.83 m)
let WHEEL_Z = RAIL_HALF_GAUGE + 0.062; // (follows the gauge: see deriveStock)
/** Distance of the crank pin (where the coupling rod attaches) from the wheel centre. */
const CRANK = 0.287;

const wheelMat = mat(0x2c2c2c);
const FLANGE_T = 0.051;
const flangeGeos = new Map<number, THREE.BufferGeometry>();
const flangeGeo = (r: number) => {
  let g = flangeGeos.get(r);
  if (!g) flangeGeos.set(r, (g = new THREE.CylinderGeometry(r + 0.092, r + 0.092, FLANGE_T, 24).rotateX(Math.PI / 2)));
  return g;
};
const rodMat = mat(0xb0b6bb, { metalness: 0.7, roughness: 0.3 });

/**
 * A wheel; with a crank phase, also a pin on its outer face for the coupling rod.
 * With a centre material (the loco's red), it gets a black tyre round a coloured centre.
 */
function makeWheel(side: number, crankPhase?: number, centreMat?: THREE.Material, r = WHEEL_RADIUS, crank = CRANK): THREE.Group {
  const w = new THREE.Group();
  w.userData.radius = r;
  w.add(mesh(new THREE.CylinderGeometry(r, r, 0.205, 24).rotateX(Math.PI / 2), wheelMat));
  // Flange: a thin rim on the inside face (towards the track centre), reaching
  // below the rail head just inside the rail
  const flangeZ = RAIL_HALF_GAUGE - RAIL_W / 2 - FLANGE_T / 2; // flange centre, measured from the track centre
  w.add(mesh(flangeGeo(r), wheelMat, 0, 0, -side * (WHEEL_Z - flangeZ)));
  if (centreMat) {
    const centre = new THREE.CylinderGeometry(r - 0.103, r - 0.103, 0.226, 24).rotateX(Math.PI / 2);
    w.add(mesh(centre, centreMat));
  }
  if (crankPhase !== undefined) {
    const pin = new THREE.CylinderGeometry(0.082, 0.082, 0.164, 10).rotateX(Math.PI / 2);
    w.add(mesh(pin, rodMat, crank * Math.cos(crankPhase), crank * Math.sin(crankPhase), side * 0.144));
  }
  return w;
}

/**
 * Add wheels at the given x positions on both sides. With `coupled`, each side also
 * gets one coupling rod joining all its wheels; the sides are a quarter turn apart.
 */
function addWheels(
  car: THREE.Group,
  xs: number[],
  coupled = false,
  centreMat?: THREE.Material,
  r = WHEEL_RADIUS,
  crank = CRANK,
): Pick<Car, 'wheels' | 'rods'> {
  const wheels: THREE.Object3D[] = [];
  const rods: Rod[] = [];
  for (const side of [-1, 1]) {
    const phase = side > 0 ? 0 : Math.PI / 2;
    for (const x of xs) {
      const w = makeWheel(side, coupled ? phase : undefined, centreMat, r, crank);
      w.position.set(x, RAIL_TOP + r, side * WHEEL_Z);
      Object.assign(w.userData, { axleX: x, side, follow: !coupled }); // carriage bogies follow the track
      car.add(w);
      wheels.push(w);
    }
    if (coupled) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const rod = box(maxX - minX + 0.328, 0.123, 0.082, rodMat);
      car.add(rod);
      rods.push({ mesh: rod, phase, midX: (minX + maxX) / 2, z: side * (WHEEL_Z + 0.246), y: RAIL_TOP + r, radius: r, crank });
    }
  }
  return { wheels, rods };
}

/** Small carrying wheels (leading / trailing trucks) at the given x positions, on the rails. */
function addCarryingWheels(car: THREE.Group, xs: number[], r: number, centreMat: THREE.Material): THREE.Object3D[] {
  const wheels: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    for (const x of xs) {
      const w = makeWheel(side, undefined, centreMat, r);
      w.position.set(x, RAIL_Y + RAIL_H / 2 + r, side * WHEEL_Z);
      Object.assign(w.userData, { axleX: x, side, follow: true }); // on a pivoting truck
      car.add(w);
      wheels.push(w);
    }
  }
  return wheels;
}

const DRIVE_Z = WHEEL_Z + 0.39; // connecting rods: outside the coupling rods

const chimneyTip = new THREE.Object3D();

/**
 * The Taurus (DB class 182) in DB traffic red, simplified: a rounded nose curving
 * from a vertical lower front up into the roof, with a wraparound windscreen and
 * trapezoid cab side windows; smooth sides with an engine-room door; red cab roofs
 * and a dark grey roof between them; a deep dark grey solebar band with the buffers
 * set into it; red pantographs (the rear one raised to the contact wire) with a roof
 * line on insulators; set-in headlights and snowploughs. It rides on two bogies,
 * which follow the track like the carriages' do.
 */
function makeTaurus(): Car {
  const T = TAURUS;
  const g = new THREE.Group();
  const red = mat(RAILJET ? RJ.red : DB_RED, { roughness: 0.4 });
  const dark = mat(RAILJET ? RJ.anthracite : 0x3d4246, { roughness: 0.7 });
  const darker = mat(0x2a2e31, { roughness: 0.8 });
  const black = mat(0x111214, { roughness: 0.4 });
  const glass = mat(0x0f1a24, { roughness: 0.15, metalness: 0.3 });
  const W = T.width;
  const front = T.half - 0.05; // the cab front faces
  const noseTop = front - T.noseLen; // where the nose meets the roof line
  /** Where the windscreen glass starts on the nose curve (the side windows' bottoms line up with it). */
  const WINDSCREEN_T0 = 0.45;

  // The body starts at the bottom of the solebar band; the nose's side profile is one
  // curve from there all the way up to the roof line, leaning back from the very start
  // (no vertical part) and rounding over at the top
  const base = T.solebarBottom;
  const nose = (dir: number) =>
    new THREE.CubicBezierCurve(
      new THREE.Vector2(dir * front, base),
      new THREE.Vector2(dir * (front - 0.6), base + 1.0),
      new THREE.Vector2(dir * (front - 1.25), T.roofEdge),
      new THREE.Vector2(dir * noseTop, T.roofEdge),
    );

  // The roof's arch carries on round the nose: seen from above, the nose's corners are
  // rounded by the same arch (as deep as the roof rises), fully at the bottom and fading
  // out towards the top, where the nose meets the roof along a straight line.
  const plan = (_t: number) => T.roofRise; // the roof's arch, all the way down
  /** The side walls' outline: the nose curve at the sides, set back by the rounding. */
  const sideCurve = (dir: number) => ({
    getPoint: (t: number) => {
      const p = nose(dir).getPoint(t);
      return new THREE.Vector2(p.x - dir * plan(t), p.y);
    },
    getTangent(t: number) {
      const e = 1e-3;
      const a = this.getPoint(Math.max(0, t - e));
      const b = this.getPoint(Math.min(1, t + e));
      return b.sub(a).normalize();
    },
  });

  // Red body: the side profile extruded across the width
  const profile = new THREE.Shape();
  const sidePts = (dir: number) => Array.from({ length: 21 }, (_, i) => sideCurve(dir).getPoint(i / 20));
  profile.moveTo(-front + plan(0), base);
  profile.lineTo(front - plan(0), base);
  for (const p of sidePts(1).slice(1)) profile.lineTo(p.x, p.y);
  profile.lineTo(-noseTop, T.roofEdge);
  for (const p of sidePts(-1).reverse().slice(1)) profile.lineTo(p.x, p.y);
  profile.closePath();
  g.add(mesh(new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), red));

  // The nose's surface continues the roof's arch: across the width each profile is the
  // nose curve stretched up by the arch's height there, so at the top it meets the roof
  // exactly and towards the bottom it flattens out. u runs across, −1 to 1.
  const H0 = T.roofEdge - base;
  const surf = (dir: number, t: number, u: number) => {
    const p = nose(dir).getPoint(t);
    const hu = H0 + T.roofRise * Math.sqrt(Math.max(0, 1 - u * u));
    return new THREE.Vector3(p.x - dir * plan(t) * archRound(u), base + ((p.y - base) * hu) / H0, (u * W) / 2);
  };
  /** Outward normal of the nose surface (numerically). */
  const surfNormal = (dir: number, t: number, u: number) => {
    const e = 1e-3;
    const dt = surf(dir, Math.min(1, t + e), u).sub(surf(dir, Math.max(0, t - e), u));
    const du = surf(dir, t, Math.min(1, u + e)).sub(surf(dir, t, Math.max(-1, u - e)));
    const n = dt.cross(du).normalize();
    if (n.x * dir + n.y < 0) n.negate();
    return n;
  };
  /** A patch of the nose surface over t0..t1 and u0..u1, lifted `out` off it. */
  /** Where on the nose (t) the surface reaches height y, at position u across. */
  const tAtY = (dir: number, u: number, y: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (surf(dir, mid, u).y < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  /** t0 may depend on u, e.g. to give the patch a level bottom edge. */
  const nosePatch = (dir: number, t0: number | ((u: number) => number), t1: number | ((u: number) => number), u0: number, u1: number, out: number, material: THREE.Material) => {
    // Across the width, sample evenly by angle round the arch (like the roof's own
    // segments), not evenly in u: the arch turns sharply near the sides, and even steps
    // in u would leave visible facets there
    const nt = 24;
    const nu = 24;
    const th0 = Math.acos(THREE.MathUtils.clamp(u0, -1, 1));
    const th1 = Math.acos(THREE.MathUtils.clamp(u1, -1, 1));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nt; i++) {
      for (let j = 0; j <= nu; j++) {
        const u = Math.cos(th0 + ((th1 - th0) * j) / nu);
        const tb = typeof t0 === 'number' ? t0 : t0(u);
        const te = typeof t1 === 'number' ? t1 : t1(u);
        const t = tb + ((te - tb) * i) / nt;
        const p = surf(dir, t, u).addScaledVector(surfNormal(dir, t, u), out);
        pos.push(p.x, p.y, p.z);
        if (i > 0 && j > 0) {
          const a = (i - 1) * (nu + 1) + (j - 1);
          const b = a + 1;
          const c = a + nu + 1;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = material as THREE.MeshStandardMaterial;
    g.add(mesh(geo, new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide })));
  };
  for (const dir of [1, -1]) nosePatch(dir, 0, 1, -1, 1, 0, red);

  // Roof: shallow arches, red over the cabs and dark grey with hatches in between
  const roofArch = (len: number, material: THREE.Material, x: number, noseEnd = 0) => {
    const geo = new THREE.CylinderGeometry(W / 2, W / 2, len, 24, 1, false, 0, Math.PI)
      .rotateZ(Math.PI / 2)
      .scale(1, T.roofRise / (W / 2), 1);
    // The end meeting the nose follows its rounded top edge
    if (noseEnd) curveRoofEnd(geo, (noseEnd * len) / 2, -noseEnd, W / 2, T.roofRise);
    g.add(mesh(geo, material, x, T.roofEdge, 0));
  };
  const midLen = 2 * (noseTop - T.cabRoofLen);
  // The grey roof runs the whole length, over the cabs too, and carries on down the
  // nose to the top of the black band above the windscreen (painted on there)
  // On the Railjet the roof is dark red like the sides, with a grey stripe down the
  // middle as wide as the windscreen; on the Taurus it's grey all over
  const roofMat = RAILJET ? red : dark;
  for (const dir of [1, -1]) roofArch(T.cabRoofLen, roofMat, dir * (noseTop - T.cabRoofLen / 2), dir);
  roofArch(midLen, roofMat, 0);
  /** Half-width (as a fraction across) of the windscreen's black band. */
  const uBandRoof = (W / 2 - 0.28) / (W / 2);
  if (RAILJET) {
    const th0 = Math.acos(uBandRoof);
    const len = 2 * noseTop;
    const r = W / 2 + 0.004;
    const stripe = new THREE.CylinderGeometry(r, r, len, 24, 1, true, th0, Math.PI - 2 * th0)
      .rotateZ(Math.PI / 2)
      .scale(1, (T.roofRise + 0.004) / r, 1);
    for (const end of [1, -1]) curveRoofEnd(stripe, (end * len) / 2, -end, W / 2, T.roofRise);
    const sm = mesh(stripe, new THREE.MeshStandardMaterial({ color: RJ.anthracite, roughness: 0.7, side: THREE.DoubleSide }), 0, T.roofEdge, 0);
    sm.castShadow = false;
    g.add(sm);
  }
  for (const hx of [-3.4, -1.1, 1.1, 3.4]) g.add(box(1.9, 0.08, 1.5, darker, hx, T.roofEdge + T.roofRise - 0.02, 0));

  // Windscreens and their black band, following the nose's curve; trapezoid side windows
  const sideWindow = (dir: number, side: number, grow: number, material: THREE.Material, out: number) => {
    // A contour: the front and top edges keep a fixed distance from the side panel's
    // outline (the nose curve and the roof line), measured square to it
    const inset = 0.32 - grow;
    const curve = sideCurve(dir);
    // Bottom edge level with the bottom of the windscreen (it starts at t = 0.45 on the nose)
    const yb = curve.getPoint(WINDSCREEN_T0).y - grow;
    // Same length as the driving trailer's (measured from the corner where the nose meets
    // the side), so the windows at both ends of the train match
    const xBack = dir * (noseTop - T.roofRise - cabWindowLen - grow);
    const r = 0.18;
    const edge: THREE.Vector2[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      // outward normal of the outline (away from the body), then step inwards along it
      let nx = dir * Math.abs(tan.y);
      let ny = Math.abs(tan.x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const q = new THREE.Vector2(p.x - nx * inset, p.y - ny * inset);
      // (stop before the back corner: on a short window the flat top of the curve would
      // otherwise run back past it and fold the outline over itself)
      if (q.y >= yb && dir * q.x >= dir * xBack + r) edge.push(q);
    }
    if (edge.length < 2) return; // (no room for a side window at all: a very short cab)
    const yt = edge[edge.length - 1].y; // = roof line − inset
    const shape = new THREE.Shape();
    shape.moveTo(xBack, yb + r);
    shape.quadraticCurveTo(xBack, yb, xBack + dir * r, yb);
    shape.lineTo(edge[0].x, yb);
    for (const p of edge) shape.lineTo(p.x, p.y);
    shape.lineTo(xBack + dir * r, yt);
    shape.quadraticCurveTo(xBack, yt, xBack, yt - r);
    shape.closePath();
    const m = material as THREE.MeshStandardMaterial;
    g.add(mesh(new THREE.ShapeGeometry(shape, 8).translate(0, 0, side * (W / 2 + out)), new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.3, side: THREE.DoubleSide })));
  };
  for (const dir of [1, -1]) {
    // Windscreen with a red border at the sides and above it
    const uBand = (W / 2 - 0.28) / (W / 2);
    const uGlass = (W / 2 - 0.42) / (W / 2);
    // Level bottom edges (curved round the nose, but horizontal); the windscreen's
    // bottom is at the same height as the side windows' bottoms
    const bandY = nose(dir).getPoint(0.4).y;
    const glassY = nose(dir).getPoint(WINDSCREEN_T0).y;
    nosePatch(dir, (u) => tAtY(dir, u, bandY), 0.86, -uBand, uBand, 0.012, black);
    // The grey roof carries on down the nose to the top of the black band (on the Railjet
    // just the middle stripe, as wide as the windscreen)
    if (RAILJET) nosePatch(dir, 0.86, 1, -uBand, uBand, 0.008, dark);
    else nosePatch(dir, 0.86, 1, -1, 1, 0.008, dark);
    nosePatch(dir, (u) => tAtY(dir, u, glassY), 0.82, -uGlass, uGlass, 0.022, glass);
    for (const side of [-1, 1]) {
      sideWindow(dir, side, 0.07, black, 0.006);
      sideWindow(dir, side, 0, glass, 0.012);
    }
  }

  {
    // Bands along the whole length and round the noses: on the sides out to the nose's
    // outline, and across the nose surface at the same heights
    const band = (y0: number, y1: number, material: THREE.Material) => {
      // Side: a shape bounded at both ends by the nose curve at those heights
      const edge = (dir: number, y: number) => sideCurve(dir).getPoint(tAtY(dir, 1, y)).x;
      const pts: THREE.Vector2[] = [];
      for (let k = 0; k <= 8; k++) {
        const y = y0 + ((y1 - y0) * k) / 8;
        pts.push(new THREE.Vector2(edge(1, y), y));
      }
      for (let k = 8; k >= 0; k--) {
        const y = y0 + ((y1 - y0) * k) / 8;
        pts.push(new THREE.Vector2(edge(-1, y), y));
      }
      const shape = new THREE.Shape(pts);
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(shape).translate(0, 0, side * (W / 2 + 0.004));
        if (side < 0) geo.scale(1, 1, 1);
        const m = mesh(geo, new THREE.MeshStandardMaterial({ color: (material as THREE.MeshStandardMaterial).color, roughness: 0.5, side: THREE.DoubleSide }));
        m.castShadow = false;
        g.add(m);
      }
      // Front: across the nose surface between the same heights
      for (const dir of [1, -1]) nosePatch(dir, (u) => tAtY(dir, u, y0), (u) => tAtY(dir, u, y1), -1, 1, 0.006, material);
    };
    if (RAILJET) {
      // Railjet: anthracite from the bottom up to the bright red stripe
      const greyTop = RJ_STRIPE_Y - RJ_STRIPE_H / 2;
      band(base, greyTop, mat(RJ.anthracite, { roughness: 0.5 }));
      band(greyTop, greyTop + RJ_STRIPE_H, mat(RJ.bright, { roughness: 0.45 })); // in line with the coaches' stripe
    } else {
      // Taurus: the dark grey solebar band along the bottom, carried round the nose
      band(base, T.bodyBottom, dark);
    }
  }
  // Halfway along, centred in the red area above the side stripe (the Taurus uses the same height)
  addLocoEmblem(g, 0, (RJ_STRIPE_Y + RJ_STRIPE_H / 2 + T.roofEdge) / 2, W / 2);

  // (The solebar band is painted on above; beneath the body, a narrower skirt between the bogies)
  if (RAILJET) {
    // Railjet: a light grey (silver) panel between the bogies, like the coaches' skirts,
    // nearly the full width and down to the same height as the coaches' middle panels
    const len = 2 * (T.bogieX - T.bogieWheelbase / 2 - 0.75);
    g.add(box(len, T.solebarBottom - SKIRT.bottom, W - 0.06, mat(RJ.silver, { roughness: 0.5 }), 0, (T.solebarBottom + SKIRT.bottom) / 2, 0));
  } else {
    g.add(box(2 * (T.bogieX - T.bogieWheelbase / 2 - 0.9), 0.5, W - 0.4, dark, 0, T.solebarBottom - 0.25, 0));
  }

  for (const [x, dir] of [
    [T.half + 0.041, 1],
    [-T.half - 0.041, -1],
  ] as const) {
    // Buffers and the draw hook mount straight onto the foot of the curved front (no
    // separate buffer beam): their shanks run back to the body surface at that height
    const bodyAt = (z: number) => surf(dir, tAtY(dir, z / (W / 2), COUPLING_Y), z / (W / 2)).x - dir * 0.02;
    {
      // Draw hooks at both ends; at the front an unused screw coupling hangs from it
      const from = bodyAt(0);
      const tip = x + dir * (0.103 + HOOK_REACH - ELECTRIC_BUFFER_SHORTEN); // shorter, like the buffers
      g.add(box(Math.abs(tip - from), 0.123, 0.164, black, (from + tip) / 2, COUPLING_Y, 0));
      if (dir > 0) addHangingCoupling(g, tip, dir);
    }
    for (const z of [-1.128, 1.128]) {
      const headX = x + dir * (0.267 - ELECTRIC_BUFFER_SHORTEN);
      const shankFrom = bodyAt(z);
      const shankTo = headX - dir * 0.015;
      g.add(cylX(0.103, Math.abs(shankTo - shankFrom), black, (shankFrom + shankTo) / 2, COUPLING_Y, z));
      const head = bufferHead(dir, z, black);
      head.position.x = headX;
      g.add(head);
    }
    // Snowplough below the buffers, leaning forwards
    // Snowplough: a V, its point in line with the foot of the nose
    addSnowplough(g, dir * front, dir, T.solebarBottom - 0.05, W - 0.5, darker);
    // Lights at both ends, so it can be driven either way: white headlights low in the
    // corners and one above the windscreen, red tail lights beside the low ones. At the
    // front the white ones are lit; the rear end is coupled to the train, so all off.
    const white = lampMaterial('white', dir > 0);
    const redLamp = lampMaterial('red', false);
    for (const z of [-1.0, 1.0]) {
      const u = z / (W / 2);
      lampOn(g, surf(dir, 0.12, u), surfNormal(dir, 0.12, u), 0.09, white);
      lampOn(g, surf(dir, 0.12, u * 0.78), surfNormal(dir, 0.12, u * 0.78), 0.06, redLamp);
    }
    lampOn(g, surf(dir, 0.92, 0), surfNormal(dir, 0.92, 0), 0.08, white);
    // CALM emblem in the middle of the end, between and above the low lights
    {
      // Below the bright red stripe, centred between it and the low lights
      const te = tAtY(dir, 0, (surf(dir, 0.12, 0).y + RJ_STRIPE_Y - RJ_STRIPE_H / 2) / 2);
      addEmblemAt(g, surf(dir, te, 0).addScaledVector(surfNormal(dir, te, 0), 0.006), surfNormal(dir, te, 0), 0.6); // lying flat on the sloping nose
    }
  }

  // Pantographs (red): the rear one raised to the contact wire, the front one lowered,
  // and a roof line on insulators between them
  const panRed = mat(RAILJET ? RJ.bright : DB_RED, { roughness: 0.5 });
  const roofTop = T.roofEdge + T.roofRise;
  const panBaseY = roofTop + 0.3;
  for (const [px, raised] of [
    [5.6, false],
    [-5.6, true],
  ] as const) {
    for (const z of [-0.55, 0.55]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 10), darker, px, roofTop + 0.15, z)); // insulators
    g.add(box(1.2, 0.08, 1.3, panRed, px, panBaseY, 0)); // base frame
    const headY = raised ? CONTACT_WIRE_Y - 0.06 : panBaseY + 0.25;
    // Knee-shaped arms: lower arm from the base up to the knee, upper arm back to the head
    const kneeX = px + (raised ? -1.1 : -1.4) * Math.sign(px);
    const kneeY = raised ? (panBaseY + headY) / 2 + 0.1 : panBaseY + 0.15;
    // A rod between two points in 3D
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
      const geo = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
        .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      g.add(mesh(geo, panRed));
    };
    // Single-arm pantograph: one lower arm from the base to the knee, then the upper
    // arm from the knee to the head, splaying out to both ends of the collector
    const hinge = new THREE.Vector3(px + 0.4 * Math.sign(px), panBaseY, 0);
    const knee = new THREE.Vector3(kneeX, kneeY, 0);
    rod(hinge, knee, 0.05);
    g.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), panRed, kneeX, kneeY, 0)); // knee joint
    for (const z of [-0.45, 0.45]) rod(knee, new THREE.Vector3(px, headY, z), 0.03);
    g.add(box(0.12, 0.06, 1.95, darker, px, headY, 0)); // pan head (collector)
    for (const z of [-1.0, 1.0]) g.add(box(0.1, 0.18, 0.05, darker, px, headY - 0.06, z)); // horns
  }
  // Roof line between the pantographs, on insulators
  g.add(cylX(0.025, 11.2, panRed, 0, roofTop + 0.42, 0.75));
  for (const ix of [-3.6, -1.2, 1.2, 3.6]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 10), darker, ix, roofTop + 0.2, 0.75));

  // Bogies: two axles each, with deeper side frames, springs and axle boxes
  const xs = [T.bogieX + T.bogieWheelbase / 2, T.bogieX - T.bogieWheelbase / 2, -T.bogieX + T.bogieWheelbase / 2, -T.bogieX - T.bogieWheelbase / 2];
  const { wheels } = addWheels(g, xs);
  for (const bx of [-T.bogieX, T.bogieX]) {
    for (const side of [-1, 1]) {
      const z = side * (WHEEL_Z + 0.22);
      g.add(box(T.bogieWheelbase + 1.1, 0.5, 0.14, dark, bx, RAIL_TOP + WHEEL_RADIUS + 0.15, z));
      for (const ax of [bx - T.bogieWheelbase / 2, bx + T.bogieWheelbase / 2]) {
        g.add(box(0.42, 0.34, 0.2, darker, ax, RAIL_TOP + WHEEL_RADIUS, z)); // axle box
        g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.32, 10), black, ax, RAIL_TOP + WHEEL_RADIUS + 0.38, z)); // spring
      }
    }
  }

  return { obj: g, offset: 0, wheels, rods: [], pivot: T.bogieX };
}

/** Rounded rectangle centred on the origin. */
function roundedRect(w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()): THREE.Path {
  const x = -w / 2;
  const y = -h / 2;
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

/** Name on the locomotive's emblem. */


/**
 * Emblem on both side tanks, after the DB logo: a raised white rounded-rectangle
 * outline with the name inside in raised white capitals (same font as the
 * carriage lettering), straight onto the black tank. Centred at (x, y) on faces at z = ±face.
 */
function addLocoEmblem(g: THREE.Group, x: number, y: number, face: number): void {
  for (const side of [1, -1]) {
    // On each side, reading correctly from that side
    addEmblemAt(g, new THREE.Vector3(x, y, side * face), new THREE.Vector3(0, 0, side));
  }
}

/**
 * The CALM emblem at p, facing along n (upright, so it reads level), optionally scaled.
 * Used on the loco's sides and on the ends of the electric loco and driving trailer.
 */
function addEmblemAt(g: THREE.Group, p: THREE.Vector3, n: THREE.Vector3, scale = 1, textOverride?: string, color = 0xf3ecd2): void {
  const white = mat(color, { roughness: 0.5 }); // (default: the same cream-white as the carriage lettering)
  const cap = 0.451;
  const pad = 0.072; // gap between the letters and the outline
  const stroke = 0.072; // outline thickness
  loadLetterFont()
    .then((font) => {
      // Flat on the surface. No width limit here: the fitting below handles it.
      const text = letterGeometry(font, textOverride ?? stock.emblem, { capHeight: cap, depth: 0.004, tracking: 0.12, maxWidth: 1e9 });
      if (!text) return;
      text.computeBoundingBox();
      const tb0 = text.boundingBox!;
      // The frame keeps one height (capitals plus padding). Letters that reach higher or
      // lower (umlaut dots, a J's tail) are shrunk to fit inside it rather than making it
      // taller; and only if the word is too long, shrunk to fit the maximum width too.
      const MAX_TEXT_W = 1.64;
      const fit = Math.min(1, cap / (tb0.max.y - tb0.min.y), MAX_TEXT_W / (tb0.max.x - tb0.min.x));
      text.scale(fit, fit, 1);
      text.computeBoundingBox();
      const tb = text.boundingBox!;
      const innerW = tb.max.x - tb.min.x + 2 * pad;
      const innerH = cap + 2 * pad;
      const textY = -(tb.min.y + tb.max.y) / 2; // centred in the frame
      const outer = roundedRect(innerW + 2 * stroke, innerH + 2 * stroke, 0.144) as THREE.Shape;
      outer.holes.push(roundedRect(innerW, innerH, 0.082, new THREE.Path()));
      const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.004, bevelEnabled: false, curveSegments: 8 }); // flat on the surface
      const e = new THREE.Group();
      e.add(mesh(frame, white));
      e.add(mesh(text, white, 0, textY, 0));
      e.scale.setScalar(scale);
      e.position.copy(p);
      e.lookAt(p.clone().add(n)); // local +z (the emblem's front) along n
      g.add(e);
    })
    .catch((err) => console.warn('Emblem font failed to load', err));
}

/**
 * Styled on the DB class 64 tank engine: black, with red wheel centres, frames and
 * buffer beams; side water tanks along the boiler, a short cab, a coal bunker
 * behind it, a graphite smokebox and DB's three headlamps.
 */
function makeLoco(): Car {
  const L = LOCO;
  const g = new THREE.Group();
  const black = mat(0x1d1e20, { roughness: 0.5 });
  const graphite = mat(0x34363a, { roughness: 0.8 });
  const red = mat(0xb3202a, { roughness: 0.5 });
  const coal = mat(0x0e0e0f, { roughness: 1 });
  const glassMat = mat(0x1b2631, { roughness: 0.2 });
  const lamp = mat(0xfff6d8, { emissive: 0xfff0c0, emissiveIntensity: 1.2 });
  const W = L.width;
  const deckH = L.deckTop - L.deckBottom;

  // Running board (full width, overhanging the wheels) and red frames beneath it
  g.add(box(L.half * 2, deckH, W, black, 0, (L.deckBottom + L.deckTop) / 2, 0));
  // (the frames run into the buffer beams, whose inner faces are at ±(half − 0.06))
  for (const z of [-0.574, 0.574]) g.add(box(L.half * 2 - 0.1, L.frameH, 0.103, red, 0, L.frameY, z));
  // Red buffer beams with round buffers, front and back
  for (const [x, dir] of [
    [L.half + 0.041, 1],
    [-L.half - 0.041, -1],
  ] as const) {
    // A touch wider than the running board, so their side faces don't coincide (no z-fighting)
    g.add(box(0.205, L.beamTop - L.beamBottom, W + 0.02, red, x, (L.beamBottom + L.beamTop) / 2, 0));
    g.add(box(HOOK_REACH, 0.123, 0.164, black, x + dir * (0.103 + HOOK_REACH / 2), COUPLING_Y, 0)); // draw hook
    if (dir > 0) addHangingCoupling(g, x + 0.103 + HOOK_REACH, dir); // unused at the front // draw hook
    for (const z of [-1.128, 1.128]) {
      g.add(cylX(0.103, 0.185, black, x + dir * 0.174, COUPLING_Y, z));
      const head = bufferHead(dir, z, black);
      head.position.x = x + dir * 0.267;
      g.add(head);
    }
  }

  // Boiler, black, with a graphite smokebox at the front; it runs back into the cab
  const BR = L.boilerR;
  const BY = L.boilerY;
  const boilerLen = L.boilerFront - L.boilerBack;
  // The barrel stops just inside the smokebox, so their front faces don't coincide (no z-fighting)
  const barrelFront = L.boilerFront - L.smokeboxLen + 0.05;
  g.add(cylX(BR, barrelFront - L.boilerBack, black, (barrelFront + L.boilerBack) / 2, BY, 0));
  g.add(cylX(BR + 0.021, L.smokeboxLen, graphite, L.boilerFront - L.smokeboxLen / 2, BY, 0)); // smokebox
  g.add(cylX(BR - 0.164, 0.082, graphite, L.boilerFront + 0.02, BY, 0)); // smokebox door
  g.add(cylX(0.082, 0.164, mat(0x8a8d91, { metalness: 0.6 }), L.boilerFront + 0.1, BY, 0)); // door handle
  if (L.saddle) {
    // Support under the boiler where it stands clear of the running board
    g.add(box(boilerLen - 0.3, BY - L.deckTop, BR * 1.4, black, (L.boilerFront + L.boilerBack) / 2, (L.deckTop + BY) / 2, 0));
  }
  // Steam dome and sand dome
  for (const x of L.domeXs) g.add(mesh(new THREE.SphereGeometry(L.domeR, 16, 12), black, x, BY + BR - 0.123, 0));

  // Side panels: the water tanks' sides run on unbroken, at one height, right
  // back through the cab and the bunker to the rear buffer beam
  const PANEL_TOP = L.panelTop;
  const panelBack = -L.half + 0.041;
  const panelLen = L.panelFront - panelBack;
  const panelH = PANEL_TOP - L.deckTop;
  for (const side of [-1, 1]) {
    g.add(box(panelLen, panelH, 0.533, black, (L.panelFront + panelBack) / 2, (L.deckTop + PANEL_TOP) / 2, side * (W / 2 - 0.267)));
  }
  addLocoEmblem(g, L.emblemX, (L.deckTop + PANEL_TOP) / 2, W / 2);

  // Cab with an arched roof, and the coal bunker behind it
  const cabX = L.cabX;
  const cabL = L.cabL;
  g.add(box(cabL, panelH, W - 0.123, black, cabX, (L.deckTop + PANEL_TOP) / 2, 0)); // cab, below the panel line
  // Cab above the panel line: the sides rise and curve over into the roof in one
  // piece (no separate roof)
  const halfW = W / 2; // flush with the side panels below: no step
  const shoulder = L.cabShoulder;
  const top = L.cabTop;
  const cabTop = new THREE.Shape();
  cabTop.moveTo(-halfW, PANEL_TOP);
  cabTop.lineTo(-halfW, shoulder);
  cabTop.quadraticCurveTo(-halfW, top, 0, top);
  cabTop.quadraticCurveTo(halfW, top, halfW, shoulder);
  cabTop.lineTo(halfW, PANEL_TOP);
  cabTop.closePath();
  const cabTopGeo = new THREE.ExtrudeGeometry(cabTop, { depth: cabL, bevelEnabled: false, curveSegments: 12 })
    .rotateY(Math.PI / 2) // extrusion now runs along x, from 0 to cabL
    .translate(cabX - cabL / 2, 0, 0);
  g.add(mesh(cabTopGeo, black));
  // Cab side windows, ahead of the doorway
  g.add(box(L.cabWindowW, 0.656, W + 0.021, glassMat, cabX + cabL / 2 - L.cabWindowW / 2 - 0.2, shoulder - 0.369, 0));
  // Doorway at the back of the cab, both sides: a dark opening from the footplate
  // up to where the roof begins to curve, with a grab handle either side
  const doorX = cabX - cabL / 2 + 0.349;
  const doorW = 0.492;
  const doorBottom = L.deckTop + 0.082;
  const doorTop = shoulder + 0.041;
  const opening = mat(0x060606, { roughness: 1 });
  const steelRail = mat(0xb0b6bb, { metalness: 0.7, roughness: 0.3 });
  for (const side of [-1, 1]) {
    g.add(box(doorW, doorTop - doorBottom, 0.021, opening, doorX, (doorBottom + doorTop) / 2, side * (W / 2 + 0.008)));
    for (const dx of [-doorW / 2 - 0.072, doorW / 2 + 0.072]) {
      g.add(box(0.041, 1.23, 0.041, steelRail, doorX + dx, doorBottom + 0.86, side * (W / 2 + 0.062)));
    }
  }
  // Coal bunker from the back of the cab to the rear, and its coal
  const bunkerFront = cabX - cabL / 2;
  const bunkerBack = -L.half;
  const bunkerX = (bunkerFront + bunkerBack) / 2;
  const bunkerLen = bunkerFront - bunkerBack;
  g.add(box(bunkerLen, panelH + 0.103, W - 0.205, black, bunkerX, (L.deckTop + PANEL_TOP + 0.103) / 2, 0));
  g.add(box(bunkerLen - 0.08, 0.205, W - 0.41, coal, bunkerX, PANEL_TOP + 0.164, 0));

  // Small front windows in the cab's top corners, either side of the boiler
  const cabFront = cabX + cabL / 2;
  for (const z of [-(W / 2 - 0.5), W / 2 - 0.5]) g.add(box(0.062, 0.41, 0.492, glassMat, cabFront + 0.031, shoulder - 0.164, z));

  // Chimney on the smokebox, its top at the real class 64's height (4.55 m above
  // the rails' top). The stack starts just inside the boiler and carries a flared cap.
  const CHIMNEY_TOP = RAIL_TOP + 4.55;
  const capH = 0.164;
  const stackBottom = BY + BR - 0.15;
  const stackTop = CHIMNEY_TOP - capH;
  const cr = L.chimneyR;
  g.add(mesh(new THREE.CylinderGeometry(cr * 0.87, cr, stackTop - stackBottom, 16), black, L.chimneyX, (stackBottom + stackTop) / 2, 0));
  g.add(mesh(new THREE.CylinderGeometry(cr * 1.13, cr * 0.87, capH, 16), black, L.chimneyX, CHIMNEY_TOP - capH / 2, 0));
  chimneyTip.position.set(L.chimneyX, CHIMNEY_TOP + 0.04, 0);
  g.add(chimneyTip);

  // DB headlamps: two low on the buffer beam, one on top of the smokebox
  for (const z of [-1.025, 1.025]) g.add(cylX(0.164, 0.164, lamp, L.half + 0.205, L.beamTop + 0.2, z));
  g.add(cylX(0.164, 0.164, lamp, L.boilerFront + 0.123, BY + BR - 0.103, 0));

  // Running gear, after the class 64 (2-6-2): three coupled driving axles, a small
  // carrying axle front and back, and on each side a cylinder driving the main
  // axle through a crosshead and connecting rod.
  const { wheels, rods } = addWheels(g, L.driverXs, true, red, L.driverR, L.crank);
  wheels.push(...addCarryingWheels(g, L.carryingXs, L.carryingR, red));
  const steel = mat(0xb0b6bb, { metalness: 0.7, roughness: 0.3 });
  const axleY = RAIL_TOP + L.driverR;
  const cylinderBack = L.mainAxle + L.crank + L.conRod + 0.082; // the crosshead's travel ends just short of it
  const guideFrom = L.mainAxle - L.crank + L.conRod - 0.25;
  const drive: Drive[] = [];
  for (const side of [-1, 1]) {
    const phase = side > 0 ? 0 : Math.PI / 2; // same as this side's coupling rod
    const z = side * DRIVE_Z;
    // Cylinder (with end covers), low at the front under the running board
    g.add(cylX(L.cylR, L.cylLen, black, cylinderBack + L.cylLen / 2, axleY, z));
    for (const x of [cylinderBack, cylinderBack + L.cylLen]) g.add(cylX(L.cylR + 0.021, 0.062, graphite, x, axleY, z));
    // Guide bar the crosshead slides under
    g.add(box(cylinderBack - guideFrom, 0.062, 0.103, steel, (cylinderBack + guideFrom) / 2, axleY + 0.154, z));
    const crosshead = box(0.246, 0.205, 0.144, steel, 0, axleY, z);
    const pistonRod = box(1, 0.062, 0.062, steel, 0, axleY, z);
    const conRodMesh = box(L.conRod, 0.103, 0.082, steel, 0, 0, z);
    g.add(crosshead, pistonRod, conRodMesh);
    drive.push({
      side, phase, axleX: L.mainAxle, axleY, radius: L.driverR, crank: L.crank, conRod: L.conRod, cylinderBack,
      crosshead, pistonRod, conRodMesh,
    });
    // A longer crank pin on the main driving wheel, reaching out to the connecting rod
    const main = wheels.find((w) => w.userData.axleX === L.mainAxle && w.userData.side === side)!;
    const pin = new THREE.CylinderGeometry(0.072, 0.072, DRIVE_Z - WHEEL_Z, 10).rotateX(Math.PI / 2);
    main.add(mesh(pin, steel, L.crank * Math.cos(phase), L.crank * Math.sin(phase), side * ((DRIVE_Z - WHEEL_Z) / 2 + 0.041)));
  }

  const pivot = (Math.max(...L.driverXs) - Math.min(...L.driverXs)) / 2;
  return { obj: g, offset: 0, wheels, rods, drive, pivot };
}

/**
 * One end of the carriage (dir ±1 along x, end wall at x = dir·endX), after a DB
 * UIC-X coach: a closed gangway (black rubber surround round an end door with a
 * window), brake hoses either side of the draw hook, a heating cable looped up to
 * its socket, and grab handles at the corners.
 */
function addCarriageEnd(
  g: THREE.Group,
  dir: number,
  endX: number,
  m: { floor: number; eaves: number; blue: THREE.Material; glass: THREE.Material; under: THREE.Material },
  /** Whether this end is the back of the train: its red tail lamps are lit (elsewhere at 10%, as off). */
  tailOfTrain = false,
): void {
  const face = dir * endX;
  const rubber = mat(0x141516, { roughness: 0.95 });
  const steel = mat(0x9aa0a6, { metalness: 0.6, roughness: 0.4 });

  // Lay a shape drawn in (across, up) onto the end wall, extruded outwards along dir
  const onEnd = (geo: THREE.BufferGeometry, y: number, out = 0) =>
    geo.rotateY(dir * (Math.PI / 2)).translate(face + dir * out, y, 0);

  // Gangway: a thick rubber roll framing the end door, from the floor up into the
  // roof's arch. Bevelled, so it has rounded edges; it stands GANGWAY.depth proud.
  const bevel = 0.06;
  const surroundGeo = new THREE.ExtrudeGeometry(gangwayShape(), {
    depth: GANGWAY.depth - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 10,
  }).translate(0, 0, bevel); // back face on the end wall
  g.add(mesh(onEnd(surroundGeo, 0), rubber));
  // The end door fills the opening, set back behind the roll, darker than the body,
  // with a window
  const openW = GANGWAY.w - 2 * GANGWAY.wall;
  const doorBottom = GANGWAY.bottom + 0.04;
  const doorTop = GANGWAY.top - GANGWAY.wall;
  const doorMat = mat(RAILJET ? RJ.red : EC ? EC_LIVERY.red : 0x14294a, { roughness: 0.5 }); // red on the EC coaches
  g.add(mesh(onEnd(new THREE.BoxGeometry(openW, doorTop - doorBottom, 0.02), (doorBottom + doorTop) / 2, 0.01), doorMat));
  g.add(mesh(onEnd(new THREE.BoxGeometry(0.55, 0.7, 0.02), doorTop - 0.62, 0.02), m.glass));

  // Red tail lamps at the lower corners of the end (lit only at the back of the train)
  const lampMat = lampMaterial('red', tailOfTrain);
  for (const z of [-(TRAIN_WIDTH / 2 - 0.3), TRAIN_WIDTH / 2 - 0.3]) {
    g.add(mesh(onEnd(new THREE.CylinderGeometry(0.1, 0.1, 0.07, 16).rotateX(Math.PI / 2), 0, 0.035), lampMat, 0, m.floor + 0.35, z));
  }


  const beam = face; // the buffer beam's front is at the carriage end
  // Heating cable: its socket is on the buffer beam's front, beside the coupling,
  // and the cable hangs in a loop below the beam to a dummy socket further out
  const socketZ = -0.75;
  g.add(box(0.08, 0.16, 0.18, steel, beam + dir * 0.04, 1.42, socketZ));
  g.add(box(0.08, 0.16, 0.18, steel, beam + dir * 0.04, 1.42, socketZ - 0.22));
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(beam + dir * 0.09, 1.36, socketZ),
    new THREE.Vector3(beam + dir * 0.12, 1.05, socketZ + 0.02),
    new THREE.Vector3(beam + dir * 0.13, 0.9, socketZ - 0.11),
    new THREE.Vector3(beam + dir * 0.12, 1.05, socketZ - 0.24),
    new THREE.Vector3(beam + dir * 0.09, 1.36, socketZ - 0.22),
  ]);
  g.add(mesh(new THREE.TubeGeometry(cable, 20, 0.045, 6), rubber));
}

/** Carriage side door width. */
const CARRIAGE_DOOR_W = 0.943;
/**
 * Side doors sit right at the ends of the coach, as on the real ones: only a narrow
 * strip of body (0.12 m) between the door and the end wall.
 */
const DOOR_END_GAP = 0.12;
const doorCentre = (L: number) => L / 2 - DOOR_END_GAP - CARRIAGE_DOOR_W / 2;

/**
 * Skirt panels (EC / Railjet coaches): tops at the floor (1.722 m), the middle panel
 * down to 0.3 m above the rail top, the end panels halfway from the plug doors'
 * bottom edge to that. Diagonal ends lean in by half their height.
 */
/**
 * Heights above the rails, measured from a side drawing of these coaches (scaled by
 * the 0.92 m wheels): door bottoms 0.70 m, end panels 0.58 m, middle panel 0.43 m.
 */
const SKIRT_DOOR_BOTTOM = RAIL_TOP + 0.7; // the plug doors' bottom edge: well below the wheels' tops
/** Bottom edge of the coaches' body sides: the wheel arches, just above the 0.92 m wheels. */
const BODY_BOTTOM = 1.394;
const SKIRT = {
  top: BODY_BOTTOM,
  bottom: RAIL_TOP + 0.43, // middle panel, between the bogies
  endBottom: RAIL_TOP + 0.58, // end panels, a little below the doors
  lean: 0.5,
};
/** How far an end panel's diagonal reaches in from its top corner. */
const endSlant = () => (SKIRT.top - SKIRT.endBottom) * SKIRT.lean;

/** Coach wheels: 0.92 m across, as on real coaches (the compact loco's are 1.15 m). */
const CARRIAGE_WHEEL_R = 0.46;

/** Bogie wheelbase (axle to axle within a bogie). */
const BOGIE_WHEELBASE = 1.23;

/** Below this length a carriage has a single axle at each end, as short real coaches do. */
const TWO_AXLE_BELOW = 12;

/**
 * Where a carriage's axles go. As on real coaches, the bogies sit inboard of the
 * doors: the outer wheel clears the door's inner edge. Shorter than TWO_AXLE_BELOW (or
 * too short for two bogies there), it gets a single axle at each end instead.
 */
function carriageAxles(L: number): { xs: number[]; innermost: number } {
  const doorX = doorCentre(L);
  // The outer wheel clears the end skirt's diagonal, which runs inwards from the door's inner edge
  const outer = doorX - CARRIAGE_DOOR_W / 2 - endSlant() - CARRIAGE_WHEEL_R - 0.08;
  const inner = outer - BOGIE_WHEELBASE;
  if (L >= TWO_AXLE_BELOW && inner > CARRIAGE_WHEEL_R + 0.2) return { xs: [outer, inner, -inner, -outer], innermost: inner };
  return { xs: [outer, -outer], innermost: outer };
}

/** Lettering along both sides of the carriage. */


/** DB ocean blue / beige livery, as on the classic 1970s–80s coaches. */
const LIVERY = { blue: 0x1f3d6e, beige: 0xe6dcbc, cream: 0xf3ecd2, roof: 0x8a949c, under: 0x2a2d31, glass: 0x22302f };
/**
 * Modern EC coaches, used with the Taurus: red roof, white stripe below it, mid
 * grey window band, light grey lower body with a thin red stripe, dark grey
 * underframe, flush plug doors.
 */
let EC = false; // modern coach shape (EC, or Railjet in its own colours)
let EC_LIVERY = { lower: 0, band: 0, stripe: 0, red: 0, door: 0, under: 0 };

/**
 * The driving trailer's cab nose at the rear (towards −x), shaped like the
 * locomotive's: a curve from the bottom of the body up to the roof line, rounded
 * across the width to continue the roof's arch; Railjet colours with the anthracite
 * band and bright red stripe carried round it, a wraparound windscreen with a level
 * bottom edge, cab side windows, and lights (white headlights, red tail lights).
 */
/**
 * Seen from above, the noses' corners are rounded by the roof's own arch, all the way
 * down: at position u across (−1 to 1) the surface is set back by rise·(1 − √(1−u²)).
 */
const archRound = (u: number) => 1 - Math.sqrt(Math.max(0, 1 - u * u));
/** Shift the vertices at one end of a roof arch (local x = endX) back by the same rounding, so its end follows the nose. */
function curveRoofEnd(geo: THREE.BufferGeometry, endX: number, back: number, halfW: number, rise: number, fromCorners = false): void {
  // fromCorners: the end stays put at the corners and is shifted in the middle instead
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - endX) > 1e-3) continue;
    const r = archRound(pos.getZ(i) / halfW);
    pos.setX(i, pos.getX(i) + back * rise * (fromCorners ? 1 - r : r));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * Lamp materials: lit, or off (10% of the light, so they still read as lamps). At the
 * front of the train the white headlights are lit; at the rear the red tail lights
 * are, and the white ones are off.
 */
const lampMaterial = (kind: 'white' | 'red', lit: boolean) =>
  kind === 'white'
    ? mat(lit ? 0xfff6d8 : 0x3a3936, { emissive: 0xfff0c0, emissiveIntensity: lit ? 1.2 : 0.12 })
    : mat(lit ? 0xb5121b : 0x2a0c0e, { emissive: 0x5a0000, emissiveIntensity: lit ? 0.8 : 0.08 });

/** A round lamp sitting on a curved surface: a short disc at p, facing along normal n, lifted clear of it. */
function lampOn(g: THREE.Group, p: THREE.Vector3, n: THREE.Vector3, r: number, material: THREE.Material): void {
  const geo = new THREE.CylinderGeometry(r, r, 0.05, 20)
    .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.clone().normalize()));
  const at = p.clone().addScaledVector(n.clone().normalize(), 0.03); // proud of the surface (it curves away under the lamp)
  const m = mesh(geo, material, at.x, at.y, at.z);
  m.castShadow = false;
  g.add(m);
}

/** An unused screw coupling hanging down from a draw hook's tip at (x, COUPLING_Y), as at the front of a train. */
function addHangingCoupling(g: THREE.Group, tipX: number, dir: number): void {
  const iron = mat(0x2a2d31, { metalness: 0.4, roughness: 0.6 });
  const drop = 0.34;
  for (const dz of [-0.072, 0.072]) {
    const link = box(0.041, drop, 0.051, iron, tipX - dir * 0.03, COUPLING_Y - drop / 2, dz);
    link.rotation.z = dir * 0.12; // swinging back slightly under the buffer beam
    g.add(link);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.164, 12), iron, tipX - dir * 0.05, COUPLING_Y - drop * 0.55, 0)); // turnbuckle
}

/**
 * Snowplough: two blades meeting in the middle in a V (its point forwards, in line
 * with the foot of the nose), leaning back, from top down to just above the rails.
 */
function addSnowplough(g: THREE.Group, frontX: number, dir: number, top: number, width: number, material: THREE.Material): void {
  // Two flat blades sharing one edge down the middle: the V's point is at the front,
  // its bottom in line with the foot of the nose, each blade sweeping back to the side
  // and leaning back towards the top
  const bottom = RAIL_TOP + 0.12;
  const h = top - bottom;
  const lean = h * 0.35; // how far the top edge is set back
  const sweep = (width / 2) * 0.33; // how far the sides are set back from the point
  const x = (back: number) => frontX - dir * back;
  const pos: number[] = [];
  for (const side of [-1, 1]) {
    const z = (side * width) / 2;
    const cb = [x(0), bottom, 0];
    const ct = [x(lean), top, 0];
    const sb = [x(sweep), bottom, z];
    const st = [x(sweep + lean), top, z];
    pos.push(...cb, ...sb, ...ct, ...ct, ...sb, ...st);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const m = material as THREE.MeshStandardMaterial;
  const plough = mesh(geo, new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, side: THREE.DoubleSide }));
  plough.castShadow = false; // double-sided: casting would make it shade itself in stripes (shadow acne)
  g.add(plough);
}

/** The cab car's nose profile: from the bottom of the body at xEnd, leaning back up to the roof line. */
function cabNoseCurve(xEnd: number, cabStart: number, floor: number, eaves: number): THREE.CubicBezierCurve {
  // exactly the locomotive's nose curve (see makeTaurus)
  return new THREE.CubicBezierCurve(
    new THREE.Vector2(xEnd, floor),
    new THREE.Vector2(xEnd + 0.6, floor + 1.0),
    new THREE.Vector2(xEnd + 1.25, eaves),
    new THREE.Vector2(cabStart, eaves),
  );
}
/** Where on the cab nose's side profile (t) it reaches height y. */
function cabNoseT(xEnd: number, cabStart: number, y: number): number {
  const c = cabNoseCurve(xEnd, cabStart, BODY_BOTTOM, CARRIAGE_EAVES);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (c.getPoint(mid).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Length of the cab side windows from the nose's corner (set by the driving trailer,
 * matched by the loco). Without a trailer (the DB Taurus) it's the Railjet's: its
 * trailer's door comes right behind the cab, leaving the window little more than the
 * nose's curve.
 */
const RJ_CAB_WINDOW_LEN = -0.0635;
let cabWindowLen = RJ_CAB_WINDOW_LEN;

function buildCabNose(
  g: THREE.Group,
  o: { xEnd: number; cabStart: number; floor: number; eaves: number; roofRise: number; bodyW: number; glass: THREE.Material; windowEnd: number },
): void {
  const { xEnd, cabStart, floor, eaves, roofRise, bodyW } = o;
  const W = bodyW;
  const red = mat(RJ.red, { roughness: 0.4 });
  const anth = mat(RJ.anthracite, { roughness: 0.5 });
  const bright = mat(RJ.bright, { roughness: 0.45 });
  const black = mat(0x111214, { roughness: 0.4 });
  // leaning back from the very bottom (no vertical part), like the locomotive's
  const curve = cabNoseCurve(xEnd, cabStart, floor, eaves);
  // Solid nose: the side profile extruded across the width
  const profile = new THREE.Shape();
  // (side walls: the curve set back by the rounding, rise, at the corners)
  profile.moveTo(cabStart + roofRise, floor);
  for (const p of curve.getPoints(24)) profile.lineTo(p.x + roofRise, p.y);
  profile.closePath();
  g.add(mesh(new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), red));

  // Rounded surface (continues the roof arch, flattening towards the bottom)
  const H0 = eaves - floor;
  const surf = (t: number, u: number) => {
    const p = curve.getPoint(t);
    const hu = H0 + roofRise * Math.sqrt(Math.max(0, 1 - u * u));
    return new THREE.Vector3(p.x + roofRise * archRound(u), floor + ((p.y - floor) * hu) / H0, (u * W) / 2);
  };
  const normal = (t: number, u: number) => {
    const e = 1e-3;
    const dt = surf(Math.min(1, t + e), u).sub(surf(Math.max(0, t - e), u));
    const du = surf(t, Math.min(1, u + e)).sub(surf(t, Math.max(-1, u - e)));
    const n = dt.cross(du).normalize();
    if (-n.x + n.y < 0) n.negate(); // outwards: towards −x and up
    return n;
  };
  const tAtY = (u: number, y: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (surf(mid, u).y < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const patch = (t0: (u: number) => number, t1: (u: number) => number, u0: number, u1: number, out: number, material: THREE.Material) => {
    const nt = 24;
    const nu = 24;
    const th0 = Math.acos(THREE.MathUtils.clamp(u0, -1, 1));
    const th1 = Math.acos(THREE.MathUtils.clamp(u1, -1, 1));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nt; i++) {
      for (let j = 0; j <= nu; j++) {
        const u = Math.cos(th0 + ((th1 - th0) * j) / nu); // evenly by angle round the arch
        const tb = t0(u);
        const t = tb + ((t1(u) - tb) * i) / nt;
        const p = surf(t, u).addScaledVector(normal(t, u), out);
        pos.push(p.x, p.y, p.z);
        if (i > 0 && j > 0) {
          const a = (i - 1) * (nu + 1) + (j - 1);
          idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = material as THREE.MeshStandardMaterial;
    const meshObj = mesh(geo, new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, side: THREE.DoubleSide }));
    meshObj.castShadow = false;
    g.add(meshObj);
  };
  patch(() => 0, () => 1, -1, 1, 0, red);

  // Bands carried round the nose: on the sides out to the curve, across the front
  const greyTop = RJ_STRIPE_Y - RJ_STRIPE_H / 2;
  const band = (y0: number, y1: number, material: THREE.Material) => {
    const edge = (y: number) => curve.getPoint(tAtY(1, y)).x + roofRise;
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 8; k++) pts.push(new THREE.Vector2(edge(y0 + ((y1 - y0) * k) / 8), y0 + ((y1 - y0) * k) / 8));
    pts.push(new THREE.Vector2(cabStart + roofRise + 0.02, y1), new THREE.Vector2(cabStart + roofRise + 0.02, y0));
    const shape = new THREE.Shape(pts);
    for (const side of [-1, 1]) {
      const m = mesh(
        new THREE.ShapeGeometry(shape).translate(0, 0, side * (W / 2 + 0.004)),
        new THREE.MeshStandardMaterial({ color: (material as THREE.MeshStandardMaterial).color, roughness: 0.5, side: THREE.DoubleSide }),
      );
      m.castShadow = false;
      g.add(m);
    }
    patch((u) => tAtY(u, y0), (u) => tAtY(u, y1), -1, 1, 0.006, material);
  };
  band(floor, greyTop, anth);
  band(greyTop, greyTop + RJ_STRIPE_H, bright);

  // Windscreen (level bottom edge) in a black band with a dark red border
  // (the same positions on the curve as the locomotive's windscreen and band)
  const bandY = curve.getPoint(0.4).y;
  const glassY = curve.getPoint(0.45).y;
  const uB = (W / 2 - 0.28) / (W / 2);
  const uG = (W / 2 - 0.42) / (W / 2);
  patch((u) => tAtY(u, bandY), () => 0.86, -uB, uB, 0.012, black);
  patch(() => 0.86, () => 1, -uB, uB, 0.008, anth); // the roof's grey stripe carries on down to the top of the black band
  // The same dark windscreen glass as the locomotive's (the passenger windows are lighter)
  patch((u) => tAtY(u, glassY), () => 0.82, -uG, uG, 0.02, mat(0x0f1a24, { roughness: 0.15, metalness: 0.3 }));
  // Cab side windows, as on the locomotive: a contour keeping a fixed distance from
  // the side panel's outline (the nose curve, set back by the corner rounding, and the
  // roof line), its bottom level with the windscreen's, rounded corners at the back;
  // a black surround with the glass inside
  const sideWindow = (grow: number, material: THREE.Material, out: number) => {
    const inset = 0.32 - grow;
    const yb = glassY - grow;
    // Its back edge: 1.1 m in from the corner, or shorter if the next door or passenger
    // window is closer (the doors and windows stay where they are)
    cabWindowLen = Math.min(1.1, o.windowEnd - (cabStart + roofRise));
    const xBack = cabStart + roofRise + cabWindowLen + grow;
    const r = 0.18;
    const edge: THREE.Vector2[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      let nx = -Math.abs(tan.y); // outward normal of the outline: towards −x and up
      let ny = Math.abs(tan.x);
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      const q = new THREE.Vector2(p.x + roofRise - nx * inset, p.y - ny * inset);
      if (q.y >= yb && q.x <= xBack - r) edge.push(q); // (stop before the back corner)
    }
    if (edge.length < 2) return; // (no room for a side window at all: a very short cab)
    const yt = edge[edge.length - 1].y;
    const shape = new THREE.Shape();
    shape.moveTo(xBack, yb + r);
    shape.quadraticCurveTo(xBack, yb, xBack - r, yb);
    shape.lineTo(edge[0].x, yb);
    for (const p of edge) shape.lineTo(p.x, p.y);
    shape.lineTo(xBack - r, yt);
    shape.quadraticCurveTo(xBack, yt, xBack, yt - r);
    shape.closePath();
    const m0 = material as THREE.MeshStandardMaterial;
    for (const side of [-1, 1]) {
      const m = mesh(
        new THREE.ShapeGeometry(shape, 8).translate(0, 0, side * (W / 2 + out)),
        new THREE.MeshStandardMaterial({ color: m0.color, roughness: 0.3, side: THREE.DoubleSide }),
      );
      m.castShadow = false;
      g.add(m);
    }
  };
  sideWindow(0.07, black, 0.008);
  sideWindow(0, mat(0x0f1a24, { roughness: 0.15, metalness: 0.3 }), 0.014);

  // Lights: white headlights low in the corners and one above the windscreen, red tail
  // lights beside the low ones
  // (it's the rear of the train: the red tail lights are lit, the white ones off)
  const white = lampMaterial('white', false);
  const tail = lampMaterial('red', true);
  for (const u of [-0.72, 0.72]) {
    lampOn(g, surf(0.12, u), normal(0.12, u), 0.09, white);
    lampOn(g, surf(0.12, u * 0.78), normal(0.12, u * 0.78), 0.06, tail);
  }
  lampOn(g, surf(0.92, 0), normal(0.92, 0), 0.08, white);
  // CALM emblem in the middle of the end, between and above the low lights
  // below the bright red stripe, centred between it and the low lights
  const te = tAtY(0, (surf(0.12, 0).y + RJ_STRIPE_Y - RJ_STRIPE_H / 2) / 2);
  addEmblemAt(g, surf(te, 0).addScaledVector(normal(te, 0), 0.006), normal(te, 0), 0.6); // lying flat on the sloping nose
}

/**
 * @param cab a Railjet driving trailer (Steuerwagen): its rear end (−x) is a driving
 *   cab with a rounded nose like the locomotive's, and its rear door moves to just
 *   inside the rear bogie (left out if there's no room)
 */
function makeCarriage(offset: number, cab = false): Car {
  const g = new THREE.Group();
  const L = CARRIAGE_LEN;
  /** Length of the cab nose at the rear, and where the ordinary body starts. */
  const NOSE = cab ? TAURUS.noseLen : 0; // the same nose as the locomotive's
  const cabStart = -L / 2 + NOSE;
  const bodyL = L; // the body runs right to the ends, like real coaches
  const bodyW = TRAIN_WIDTH - 0.082;
  // Lower body, window band and the thin line along the lower body: classic DB
  // blue/beige/cream, or the modern EC light grey/mid grey/red
  const blue = mat(EC ? EC_LIVERY.lower : LIVERY.blue, { roughness: 0.45 });
  const beige = mat(EC ? EC_LIVERY.band : LIVERY.beige, { roughness: 0.5 });
  const cream = mat(EC ? EC_LIVERY.red : LIVERY.cream, { roughness: 0.5 });
  // (Railjet: lighter glass, set in the black band; depth-biased like the surround, a step further)
  const glass = mat(RAILJET ? 0x5f7678 : LIVERY.glass, { roughness: 0.15, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const seam = mat(0x15243d);
  const steelStep = mat(0x6d7378, { metalness: 0.6, roughness: 0.45 });

  // Heights: underframe top 1.72 m, blue up to the window band, beige band, curved
  // roof whose top lines up with the locomotive's cab roof (4.59 m).
  const floor = 1.722;
  const beltline = 2.829;
  const eaves = CARRIAGE_EAVES;
  const roofRise = 0.574;

  const under = mat(EC ? EC_LIVERY.under : LIVERY.under);
  // Underframe, in sections that stop either side of the side doors so the step
  // wells beneath them show
  {
    const dX = CARRIAGE_DOOR_X;
    const dHalf = CARRIAGE_DOOR_W / 2;
    // (classic coaches: cut either side of the doors for the step wells; the EC /
    // Railjet coaches have plug doors, so one piece)
    const start = cab ? cabStart + roofRise : -L / 2;
    const cuts: [number, number][] = EC
      ? [[start, L / 2]]
      : [
          [start, -dX - dHalf],
          [-dX + dHalf, dX - dHalf],
          [dX + dHalf, L / 2],
        ];
    // (on the EC / Railjet coaches tucked in behind the skirt panels, so their faces don't fight)
    const uW = bodyW - 0.12; // hidden behind the body sides, which come down to the wheel arches
    for (const [a, b] of cuts) if (b - a > 0.01) g.add(box(b - a, 0.328, uW, under, (a + b) / 2, 1.558, 0));
    // A narrower spine runs through behind the step wells
    if (!EC) for (const x of [-dX, dX]) g.add(box(CARRIAGE_DOOR_W, 0.328, bodyW - 0.7, under, x, 1.558, 0));
  }
  // Buffer beams with round buffers and a draw hook at each end
  const buffers: SprungBuffer[] = [];
  // At a cab end there's no buffer beam: the buffers and hook mount straight onto the
  // foot of the nose (which leans back, so at buffer height it's this far in)
  const cabNoseX = cab ? cabNoseCurve(-L / 2, cabStart, BODY_BOTTOM, CARRIAGE_EAVES).getPoint(cabNoseT(-L / 2, cabStart, COUPLING_Y)).x : 0;
  /** How far in from the end the (rounded) nose is at buffer height, at z across. */
  const cabNoseInAt = (z: number) => (cab ? cabNoseX + L / 2 + roofRise * archRound(z / (bodyW / 2)) + 0.02 : 0);
  const cabNoseIn = cabNoseInAt(0);
  if (cab) addSnowplough(g, -L / 2, -1, BODY_BOTTOM - 0.05, bodyW - 0.5, mat(0x2a2e31, { roughness: 0.8 }));
  for (const dir of [1, -1]) {
    const endX = dir * (L / 2);
    const cabEnd = cab && dir < 0;
    // A touch wider than the underframe, and 6 mm proud of the body's end (whose lower
    // part now reaches down here), so their faces don't fight
    if (!cabEnd) g.add(box(0.164, 0.533, TRAIN_WIDTH + 0.02, under, endX - dir * 0.076, 1.558, 0));
    // (Railjet: its coaches are short-coupled to one another by a centre rod, without
    // buffers; only the set's outer ends, next to the loco or at the cab, have them)
    const innerEnd = dir > 0 ? offset !== CARRIAGE_OFFSETS[0] : offset !== LAST_CARRIAGE;
    if (!(RAILJET && innerEnd)) for (const z of [-1.128, 1.128]) {
      const shaft = cylX(0.103, 1, under, 0, 1.558, z);
      const head = bufferHead(dir, z, under);
      g.add(shaft, head);
      if (dir > 0) buffers.push({ z, shaft, head }); // front ones meet the loco; placed each frame
      else if (cabEnd) setBufferReach(shaft, head, endX + cabNoseInAt(z), dir, REAR_BUFFER_REACH + cabNoseInAt(z));
      else setBufferReach(shaft, head, endX, dir, REAR_BUFFER_REACH);
    }
    const hookFrom = cabEnd ? endX + cabNoseIn : endX;
    const hookLen = CARRIAGE_HOOK_REACH + (cabEnd ? cabNoseIn : 0);
    g.add(box(hookLen, 0.123, 0.164, under, hookFrom + dir * hookLen / 2, COUPLING_Y, 0)); // draw hook
  }
  if (EC) {
    // Railjet: light grey skirt panels along both sides: one between the bogies, and
    // one at each end beyond the wheels (the plug door is part of it); diagonal where
    // a panel meets the wheels, square at the carriage ends
    const axles = carriageAxles(L).xs;
    const innerEdge = Math.min(...axles.filter((x) => x > 0)) - CARRIAGE_WHEEL_R - 0.12;
    const top = SKIRT.top; // the body's bottom edge (wheel arches)
    const bottom = SKIRT.bottom;
    // Silver on the Railjet; on the EC coaches the underframe grey (and end panels only)
    const skirtMat = mat(RAILJET ? RJ.silver : EC_LIVERY.under, { roughness: 0.5, side: THREE.DoubleSide });
    const slant = (top - bottom) * SKIRT.lean; // how far a diagonal end slants in at the bottom
    /** Vertical panel from x0 to x1; ends next to wheels are diagonal, others square. */
    const skirt = (x0: number, x1: number, diagLeft: boolean, diagRight: boolean, bot = bottom) => {
      const sl = slant * ((top - bot) / (top - bottom)); // keep the same angle at any height
      const shape = new THREE.Shape([
        new THREE.Vector2(x0, top),
        new THREE.Vector2(x1, top),
        new THREE.Vector2(x1 - (diagRight ? sl : 0), bot),
        new THREE.Vector2(x0 + (diagLeft ? sl : 0), bot),
      ]);
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(shape).translate(0, 0, side * (bodyW / 2 - 0.002)); // flush with the body side
        const m = mesh(geo, skirtMat);
        // Double-sided thin panel: neither casting nor receiving shadows, or the body's
        // shadow falling across it at a grazing angle shows as stripes (shadow acne)
        m.castShadow = false;
        m.receiveShadow = false;
        g.add(m);
      }
    };
    // Between the bogies (only if it's at least 2 m long): diagonal towards both bogies
    if (RAILJET && 2 * innerEdge >= 2) skirt(-innerEdge, innerEdge, true, true);
    // Ends: from beyond the outer wheels (diagonal there) to the end of the carriage
    // (square), taking in the plug door, which reaches down into this panel
    const endX = L / 2 - 0.05;
    // The end panels reach down halfway from the bottom of the doors to the bottom of
    // the middle panel
    const endBottom = SKIRT.endBottom;
    // The panel takes in the doorway: square at the coach end, its bottom edge starting
    // at the door's inner edge and the diagonal leaning out from there towards the wheels
    const panelStart = CARRIAGE_DOOR_X - CARRIAGE_DOOR_W / 2 - endSlant();
    skirt(panelStart, endX, true, false, endBottom);
    if (!cab) skirt(-endX, -panelStart, false, true, endBottom);
  }
  // Equipment boxes between the bogies, sized to the space (none if it's too short)
  const { innermost } = carriageAxles(L);
  const boxSpace = innermost - CARRIAGE_WHEEL_R - 0.15; // centre to the inner wheels' edge, less a margin
  const boxLen = Math.min(1.435, boxSpace - 0.1);
  if (boxLen > 0.4) for (const x of [-boxSpace / 2 - 0.05, boxSpace / 2 + 0.05]) g.add(box(boxLen, 0.328, 1.845, under, x, 1.23, 0));

  /** A window pane with rounded corners on one side of the body. */
  const pane = (w: number, h: number, x: number, y: number, side: number, out = 0.012) => {
    const geo = new THREE.ShapeGeometry(roundedRect(w, h, Math.min(0.14, w / 4, h / 4)) as THREE.Shape, 6);
    if (side < 0) geo.rotateY(Math.PI); // face outwards on the far side
    const m = mesh(geo, glass, x, y, side * (sideZ0 + out));
    m.castShadow = false;
    return m;
  };
  const sideZ0 = bodyW / 2;
  // Passenger windows: 0.779 m tall, centred at this height
  // EC proportions measured from a side view (side 2.3 m from the body's bottom to the
  // roof): red stripe 0.2 m, light grey to 1.0 m, grey band 1.0–2.04 m with the 0.9 m
  // windows centred in it, then a light grey stripe up to the roof
  const EC_BAND_BOTTOM = floor + 1.0;
  const EC_BAND_TOP = floor + 2.04;
  const windowH = EC ? 0.9 : 0.779;
  const windowY = EC ? (EC_BAND_BOTTOM + EC_BAND_TOP) / 2 : beltline + 0.595;
  if (EC) {
    // EC: the mid grey band is only a little taller than the windows, centred on them;
    // light grey below, and a white stripe from the band up to the red roof
    const bandBottom = EC_BAND_BOTTOM;
    const bandTop = EC_BAND_TOP;
    g.add(box(bodyL, bandBottom - floor, bodyW, blue, 0, (floor + bandBottom) / 2, 0));
    g.add(box(bodyL, bandTop - bandBottom, bodyW, beige, 0, (bandBottom + bandTop) / 2, 0));
    g.add(box(bodyL, eaves - bandTop, bodyW, blue, 0, (bandTop + eaves) / 2, 0)); // stripe below the roof
    if (RAILJET) {
      // Railjet: mostly dark red, a black strip just around the windows, and an
      // anthracite band along the bottom
      // Bright red stripe along the whole coach, centred on the bottom of the black window surround
      // (just behind the black window strip, so it shows below and beyond it)
      g.add(box(bodyL + 0.005, RJ_STRIPE_H, bodyW + 0.003, mat(RJ.bright, { roughness: 0.45 }), 0, RJ_STRIPE_Y, 0));
      // Anthracite from the bottom of the body up to the red stripe
      const greyTop = RJ_STRIPE_Y - RJ_STRIPE_H / 2;
      g.add(box(bodyL + 0.01, greyTop - BODY_BOTTOM, bodyW + 0.01, mat(RJ.anthracite, { roughness: 0.5 }), 0, (BODY_BOTTOM + greyTop) / 2, 0));
    }
  } else {
    g.add(box(bodyL, beltline - floor, bodyW, blue, 0, (floor + beltline) / 2, 0)); // lower body
    g.add(box(bodyL, eaves - beltline, bodyW, beige, 0, (beltline + eaves) / 2, 0)); // window band
  }
  // The body sides come down below the floor to the wheel arches (BODY_BOTTOM), in the
  // lower body colour, hiding the underframe; on the classic coaches they stop either
  // side of the doors, where the step wells are
  {
    const lowerMat = mat(RAILJET ? RJ.anthracite : EC ? EC_LIVERY.lower : LIVERY.blue, { roughness: 0.5 });
    const cuts: number[] = EC ? [] : [-CARRIAGE_DOOR_X, CARRIAGE_DOOR_X];
    const edges = [cab ? cabStart + roofRise : -bodyL / 2, ...cuts.flatMap((x) => [x - CARRIAGE_DOOR_W / 2, x + CARRIAGE_DOOR_W / 2]), bodyL / 2];
    for (let k = 0; k < edges.length; k += 2) {
      const a = edges[k];
      const b = edges[k + 1];
      if (b - a > 0.01) g.add(box(b - a, floor - BODY_BOTTOM + 0.01, bodyW, lowerMat, (a + b) / 2, (floor + BODY_BOTTOM - 0.01) / 2, 0));
    }
  }
  if (EC) {
    g.add(box(bodyL + 0.021, 0.2, bodyW + 0.021, cream, 0, BODY_BOTTOM + 0.1, 0)); // red stripe along the bottom of the body
  } else {
    g.add(box(bodyL + 0.021, 0.062, bodyW + 0.021, cream, 0, floor + 0.267, 0)); // cream line low on the blue
  }

  // Curved roof: a flattened half-cylinder along the carriage
  // Exactly as wide and as long as the body below: no overhang
  const roofGeo = new THREE.CylinderGeometry(bodyW / 2, bodyW / 2, bodyL, 24, 1, false, 0, Math.PI)
    .rotateZ(Math.PI / 2)
    .scale(1, roofRise / (bodyW / 2), 1);
  // Railjet: the roof is dark red like the sides, with an anthracite stripe down the
  // middle as wide as the windscreens (the stripe is a separate strip just above)
  const roofMesh = mesh(roofGeo, mat(RAILJET ? RJ.red : EC ? EC_LIVERY.red : LIVERY.roof, { roughness: 0.6 }), 0, eaves, 0);
  g.add(roofMesh);
  let roofStripe: THREE.Mesh | null = null;
  if (RAILJET) {
    const u = (bodyW / 2 - 0.28) / (bodyW / 2);
    const th0 = Math.acos(u);
    const r = bodyW / 2 + 0.004;
    const geo = new THREE.CylinderGeometry(r, r, bodyL, 24, 1, true, th0, Math.PI - 2 * th0)
      .rotateZ(Math.PI / 2)
      .scale(1, (roofRise + 0.004) / r, 1);
    roofStripe = mesh(geo, new THREE.MeshStandardMaterial({ color: RJ.anthracite, roughness: 0.7, side: THREE.DoubleSide }), 0, eaves, 0);
    roofStripe.castShadow = false;
    g.add(roofStripe);
  }

  // Doors near each end, on both sides: outlined, with a tall narrow window
  const doorX = CARRIAGE_DOOR_X;
  const doorW = CARRIAGE_DOOR_W;
  const sideZ = bodyW / 2;
  const WINDOW_GAP = EC ? 0.65 : 0.246; // EC: wider windows (~1.1 m) with wider gaps, as on the real coaches
  const WINDOW_PITCH = EC ? 1.75 : 1.148; // nominal window + gap
  // On a driving trailer the rear door sits just inside the rear bogie, if there's room
  // for it and at least one window between it and the front door
  let rearDoorX: number | null = -doorX;
  let windowsFrom = -(doorX - doorW / 2 - WINDOW_GAP);
  if (cab) {
    const { innermost: inner } = carriageAxles(L);
    // Its outer edge in line with the bottom of the middle skirt panel's diagonal
    const midSlant = (SKIRT.top - SKIRT.bottom) * SKIRT.lean;
    const innerEdgeX = inner - CARRIAGE_WHEEL_R - 0.12; // where the middle panel's top starts
    const xd = -(innerEdgeX - midSlant) + doorW / 2;
    const from = xd + doorW / 2 + WINDOW_GAP;
    // Only if the middle skirt panel exists (at least 2 m between the bogies' inner
    // wheels) and there's room for a window between the doors
    const hasMiddleSkirt = 2 * innerEdgeX >= 2;
    if (hasMiddleSkirt && doorX - doorW / 2 - WINDOW_GAP - from >= 1.0) {
      rearDoorX = xd;
      windowsFrom = from;
    } else {
      rearDoorX = null;
      windowsFrom = cabStart + 0.5 + WINDOW_GAP;
    }
  }
  const doorXs = rearDoorX === null ? [doorX] : [rearDoorX, doorX];
  for (const x of doorXs) {
    for (const side of [-1, 1]) {
      const z = side * (sideZ + 0.012);
      if (EC) {
        // Flush plug door: an outline in the body side (so the band and stripes carry on
        // across it), from the top of the grey band down to below the floor, where the
        // door continues as a light grey panel (the steps are inside); a narrow window
        // whose top lines up with the passenger windows' tops. No external steps.
        const doorTop = EC_BAND_TOP; // top of the grey band
        const doorBottom = SKIRT_DOOR_BOTTOM; // level with the bottom of the end skirt panel it's part of
        const outline = mat(0x2a2d31);
        const zf = side * (sideZ + 0.008);
        for (const dx of [-doorW / 2, doorW / 2]) g.add(box(0.03, doorTop - doorBottom, 0.012, outline, x + dx, (doorBottom + doorTop) / 2, zf));
        g.add(box(doorW, 0.03, 0.012, outline, x, doorTop, zf));
        g.add(box(doorW, 0.03, 0.012, outline, x, doorBottom, zf));
        // Below the floor: the same grey as the underframe (on the Railjet, the skirt panel
        // it's part of, flush with it)
        g.add(box(doorW - 0.03, BODY_BOTTOM - doorBottom, 0.02, RAILJET ? mat(RJ.silver, { roughness: 0.5 }) : under, x, (doorBottom + BODY_BOTTOM) / 2, side * (bodyW / 2 + 0.002)));
        // Door window: tall and narrow with rounded ends, from 0.32 m below the door's top
        const dwH = 1.3;
        g.add(pane(0.29, dwH, x, doorTop - 0.32 - dwH / 2, side, 0.014));
        continue;
      } else {
        for (const dx of [-doorW / 2, doorW / 2]) g.add(box(0.041, eaves - floor - 0.164, 0.025, seam, x + dx, (floor + eaves) / 2, z));
        g.add(box(doorW, 0.041, 0.025, seam, x, eaves - 0.103, z));
        g.add(box(0.328, 0.861, 0.041, glass, x, beltline + 0.574, side * (sideZ + 0.021)));
      }
      // Step well below the door, as on the real coaches: blue side plates continuing
      // the body down, a dark recessed upper step, and a grated metal lower step
      const well = 0.26; // how far the well reaches in from the body side
      const wellZ = (d: number) => side * (sideZ - d); // d: distance in from the side
      const upperY = floor - 0.38;
      const lowerY = floor - 0.78;
      for (const dx of [-doorW / 2 + 0.015, doorW / 2 - 0.015]) {
        g.add(box(0.03, floor - lowerY + 0.05, well, blue, x + dx, (floor + lowerY - 0.05) / 2, wellZ(well / 2)));
      }
      const recess = mat(0x0d0f12, { roughness: 1 });
      g.add(box(doorW - 0.06, floor - upperY, 0.02, recess, x, (floor + upperY) / 2, wellZ(well - 0.01))); // back of the upper recess
      g.add(box(doorW - 0.06, 0.05, well, steelStep, x, upperY, wellZ(well / 2))); // upper tread
      g.add(box(doorW - 0.06, upperY - lowerY, 0.02, recess, x, (upperY + lowerY) / 2, wellZ(well - 0.01))); // riser
      // Lower step: a grating of thin slats in a frame
      g.add(box(doorW - 0.06, 0.04, 0.03, steelStep, x, lowerY, wellZ(0.015)));
      g.add(box(doorW - 0.06, 0.04, 0.03, steelStep, x, lowerY, wellZ(well - 0.015)));
      for (let k = 0; k < 6; k++) {
        const sx = x - (doorW - 0.12) / 2 + ((doorW - 0.12) * k) / 5;
        g.add(box(0.025, 0.035, well - 0.04, steelStep, sx, lowerY, wellZ(well / 2)));
      }
    }
  }

  // Carriage ends: gangway, brake hoses, heating cable and grab handles (not at a cab end)
  for (const dir of cab ? [1] : [1, -1]) addCarriageEnd(g, dir, bodyL / 2, { floor, eaves, blue, glass, under }, dir < 0 && offset === LAST_CARRIAGE);

  // Row of passenger windows in the beige band, between the doors
  // The doors stay put near the ends and the gaps between windows stay the same;
  // the length between the doors decides how many windows fit (rounded), and the
  // windows stretch to fill it.
  const windowsTo = doorX - doorW / 2 - WINDOW_GAP;
  const span = windowsTo - windowsFrom;
  const windowsMid = (windowsFrom + windowsTo) / 2;
  const n = Math.max(1, Math.round(span / WINDOW_PITCH));
  const pitch = span / n;
  for (let i = 0; i < n; i++) {
    const x = windowsFrom + pitch * (i + 0.5);
    for (const side of [-1, 1]) g.add(pane(pitch - WINDOW_GAP, windowH, x, windowY, side, RAILJET ? 0.035 : 0.012));
  }
  if (RAILJET) {
    // Black surround behind the windows: the same margin all round (above, below and
    // beyond the end windows), with corners rounded by the window radius plus that margin
    const margin = RJ_WINDOW_MARGIN;
    const paneR = Math.min(0.14, (pitch - WINDOW_GAP) / 4, windowH / 4); // as in pane()
    const w = span - WINDOW_GAP + 2 * margin;
    const h = windowH + 2 * margin;
    // Depth-biased towards the camera, so it never fights the livery underneath (which
    // a small gap alone can't prevent far away, where depth precision is coarse)
    const black = mat(0x111214, { roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    for (const side of [-1, 1]) {
      const geo = new THREE.ShapeGeometry(roundedRect(w, h, paneR + margin) as THREE.Shape, 8);
      if (side < 0) geo.rotateY(Math.PI);
      g.add(mesh(geo, black, windowsMid, windowY, side * (sideZ0 + 0.02))); // clear of the livery layers (≤ 5 mm), so no flicker from afar
    }
  }
  if (cab) {
    // The ordinary body (bands, stripes, roof) stops where the cab nose begins
    for (const o of [...g.children]) {
      if (!(o instanceof THREE.Mesh)) continue;
      const geo = o.geometry as THREE.BufferGeometry;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const minX = bb.min.x + o.position.x;
      const maxX = bb.max.x + o.position.x;
      // (the body now reaches down to the wheel arches, BODY_BOTTOM)
      const cut = cabStart + roofRise; // where the nose's rounded corners meet the sides
      if (maxX - minX < 0.6 * L || bb.min.y + o.position.y < BODY_BOTTOM - 0.01 || minX > cut) continue;
      const k = (maxX - cut) / (maxX - minX);
      geo.translate(-maxX + o.position.x, 0, 0).scale(k, 1, 1).translate(maxX - o.position.x, 0, 0);
      // The roof's end follows the nose's rounded top edge: back to cabStart in the middle
      if (o === roofMesh || o === roofStripe) curveRoofEnd(geo, cut - o.position.x, -1, bodyW / 2, roofRise, true);
    }
    // The cab's side window stops short of whatever comes next: the inner door, or the
    // first passenger window (with the usual gap between windows)
    const nextThing = rearDoorX !== null ? rearDoorX - doorW / 2 : windowsFrom + RJ_WINDOW_MARGIN;
    buildCabNose(g, { xEnd: -L / 2, cabStart, floor: BODY_BOTTOM, eaves, roofRise, bodyW, glass, windowEnd: nextThing - WINDOW_GAP });
  }

  // Lettering along the blue band on both sides, in the same raised capitals as the station walls
  const letterMat = mat(RAILJET ? RJ.lettering : EC ? EC_LIVERY.red : 0xf3ecd2, { roughness: 0.5 }); // red on the light grey EC coaches
  const letterCap = 0.328;
  loadLetterFont()
    .then((font) => {
      const geo = letterGeometry(font, stock.lettering, {
        capHeight: letterCap,
        depth: 0.004, // flat on the surface
        tracking: 0.12,
        maxWidth: span + 2 * WINDOW_GAP - 0.41, // between the doors
      });
      if (!geo) return;
      // Centred vertically: classic, between the cream line and the beige band; EC, in the
      // light grey part between the red stripe and the grey window band
      // (Railjet: in the dark red band between the anthracite bottom band and the black window strip)
      const mid = RAILJET
        ? (BODY_BOTTOM + (RJ_STRIPE_Y - RJ_STRIPE_H / 2)) / 2 // in the anthracite, below the red stripe
        : EC
          ? (BODY_BOTTOM + 0.2 + EC_BAND_BOTTOM) / 2
          : (floor + 0.297 + beltline) / 2;
      const y = mid - letterCap / 2;
      for (const side of [1, -1]) {
        // Just outside the outermost livery layer (the Railjet's anthracite band is 5 mm proud)
        const m = mesh(geo, letterMat, windowsMid, y, side * (sideZ + 0.012));
        m.rotation.y = side > 0 ? 0 : Math.PI; // read correctly from each side
        g.add(m);
      }
    })
    .catch((err) => console.warn('Carriage lettering font failed to load', err));


  // Two bogies of two axles, set in from the ends so they suit any carriage length
  const axles = carriageAxles(L);
  const pivot = axles.xs.length === 4 ? (axles.xs[0] + axles.xs[1]) / 2 : axles.xs[0]; // bogie centre, or the axle
  const running = addWheels(g, axles.xs, false, undefined, CARRIAGE_WHEEL_R);
  running.wheels.push(...carriageRunningGear(g, axles.xs));
  return { obj: g, offset, ...running, buffers, pivot };
}

/**
 * What joins a carriage's wheels to each other and to the body: on a bogie, a side
 * frame along each side linking its two axles, and a bolster across from the frames up
 * to the underframe; on a two-axle coach, an axle box and spring hanger above each
 * wheel. They follow the track as the wheels do (placeTrain), not turning with them.
 */
function carriageRunningGear(g: THREE.Group, xs: number[]): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const frameMat = mat(0x2a2d31, { roughness: 0.7 });
  const hubY = RAIL_TOP + CARRIAGE_WHEEL_R;
  const add = (o: THREE.Object3D, axleX: number, offZ: number) => {
    // (radius Infinity: placeTrain's wheel spin leaves it unturned; offZ: its distance out from the track's centre line)
    Object.assign(o.userData, { axleX, side: Math.sign(offZ) || 1, offZ, follow: true, radius: Infinity });
    g.add(o);
    out.push(o);
  };
  const frameZ = WHEEL_Z + 0.16;
  if (xs.length === 4) {
    for (const [a, b] of [[xs[0], xs[1]], [xs[2], xs[3]]]) {
      const cx = (a + b) / 2;
      const len = Math.abs(a - b) + 2 * CARRIAGE_WHEEL_R + 0.3;
      for (const side of [-1, 1]) {
        const frame = new THREE.Group();
        frame.add(box(len, 0.32, 0.12, frameMat, 0, 0, 0)); // the side frame, through the axle boxes
        frame.add(box(0.5, 0.32, 0.14, frameMat, 0, 0.3, 0)); // spring nest up to the bolster
        frame.position.set(cx, hubY, side * frameZ);
        add(frame, cx, side * frameZ);
      }
      const bolster = box(0.6, BODY_BOTTOM - (hubY + 0.46), 2 * frameZ + 0.12, frameMat);
      bolster.position.set(cx, (BODY_BOTTOM + hubY + 0.46) / 2, 0);
      add(bolster, cx, 0);
    }
  } else {
    for (const x of xs) {
      for (const side of [-1, 1]) {
        const hanger = new THREE.Group();
        hanger.add(box(0.36, 0.3, 0.14, frameMat, 0, 0, 0)); // axle box
        hanger.add(box(1.4, 0.12, 0.12, frameMat, 0, 0.24, 0)); // leaf spring
        hanger.add(box(0.12, BODY_BOTTOM - hubY - 0.24, 0.12, frameMat, 0, (BODY_BOTTOM - hubY + 0.24) / 2, 0)); // hanger up to the underframe
        hanger.position.set(x, hubY, side * frameZ);
        add(hanger, x, side * frameZ);
      }
    }
  }
  return out;
}

/**
 * Carriage gangway surround, after the UIC-X coaches: a thick rubber roll framing
 * the end door, from floor level up into the roof's arch. Heights are above the ground.
 */
const CARRIAGE_EAVES = 4.018; // where the carriage's curved grey roof begins
/** The opening's top lines up with the eaves (the bottom of the grey roof), as on the real coaches. */
const GANGWAY = { w: 1.85, bottom: 1.722, top: CARRIAGE_EAVES + 0.3, wall: 0.3, rTop: 0.55, rBottom: 0.15, depth: 0.15 };

/** The surround's outline (across, height) inset by `inset`; the opening is the outline inset by the wall. */
function gangwayPath(p: THREE.Path, inset: number): THREE.Path {
  const hw = GANGWAY.w / 2 - inset;
  const yb = GANGWAY.bottom + (inset > 0 ? 0.04 : 0); // the opening comes down to the floor
  const yt = GANGWAY.top - inset;
  const rt = Math.max(0.05, GANGWAY.rTop - inset);
  const rb = Math.max(0.03, GANGWAY.rBottom - inset / 2);
  p.moveTo(-hw + rb, yb);
  p.lineTo(hw - rb, yb);
  p.quadraticCurveTo(hw, yb, hw, yb + rb);
  p.lineTo(hw, yt - rt);
  p.quadraticCurveTo(hw, yt, hw - rt, yt);
  p.lineTo(-hw + rt, yt);
  p.quadraticCurveTo(-hw, yt, -hw, yt - rt);
  p.lineTo(-hw, yb + rb);
  p.quadraticCurveTo(-hw, yb, -hw + rb, yb);
  return p;
}

function gangwayShape(): THREE.Shape {
  const shape = gangwayPath(new THREE.Shape(), 0) as THREE.Shape;
  shape.holes.push(gangwayPath(new THREE.Path(), GANGWAY.wall));
  return shape;
}

deriveStock();
let cars: Car[] = [];
/** Bellows between the 423's car bodies (re-aimed every frame). */
let s423Joints: THREE.Mesh[] = [];
/** For each joint, the index of the car ahead of it (the car behind is the next one). */
let s423JointCars: number[] = [];

// ---------------------------------------------------------------------------
// S-Bahn class 423: articulated electric multiple unit, cab at each end
// ---------------------------------------------------------------------------


/** The body's extent along a car (local x): from the rear cab / joint to the front cab / joint. */
function s423Body(c: { len: number; cabFront: boolean; cabRear: boolean }): [number, number] {
  const D = S423_DIM;
  return [-c.len / 2 + (c.cabRear ? D.nose : D.jointGap / 2), c.len / 2 - (c.cabFront ? D.nose : D.jointGap / 2)];
}

/** The passenger part of the body (local x): the body less the cab sections. */
function s423Saloon(c: { len: number; cabFront: boolean; cabRear: boolean }): [number, number] {
  const [xa, xb] = s423Body(c);
  return [xa + (c.cabRear ? S423_CAB_BODY : 0), xb - (c.cabFront ? S423_CAB_BODY : 0)];
}

/**
 * The car's passenger door centres (local x), rear first: evenly spread along the
 * saloon, about one per 5 m (three on a real-length car, never more).
 */
function s423Doors(c: { len: number; cabFront: boolean; cabRear: boolean; kind?: S423Car['kind'] }): number[] {
  if (c.kind === 'coach') return [-(c.len / 2 - RHB.doorIn), c.len / 2 - RHB.doorIn];
  if (c.kind === 'cabCar') return [-c.len / 2 + RHB.cabDoorIn];
  const [pa, pb] = s423Saloon(c);
  if (FLIRT) {
    // One door per car, centred on a middle car, and the same distance from the
    // gangway on a cab car (half a middle car's body); a railcar's in its middle
    if (c.cabFront && c.cabRear) return [0];
    const half = (c.len - (c.cabFront || c.cabRear ? S423_CAB_EXTRA : 0) - S423_DIM.jointGap) / 2;
    return [c.cabFront ? pa + half : c.cabRear ? pb - half : (pa + pb) / 2];
  }
  // (LINT: two per car, either side of the car's middle at 38% / 62% of its length, as on the LINT 54)
  if (LINT) return lintLayout(c).doors;
  if (DESIRO) return desiroLayout(c).doors; // (two, or one on a short car: see desiroLayout)
  if (ALLEGRA) return [(pa + pb) / 2]; // (one, in the middle of the saloon)
  const n = THREE.MathUtils.clamp(Math.round((pb - pa) / 4.9), 1, 3);
  const pitch = (pb - pa) / n;
  return Array.from({ length: n }, (_, i) => pa + pitch * (i + 0.5));
}

function makeS423Car(c: S423Car, index: number): Car {
  if (FLIRT) return makeFlirtCar(c, index);
  if (LINT) return makeLintCar(c, index);
  if (c.kind === 'coach' || c.kind === 'cabCar') return makeRhbCoach(c, index);
  if (DESIRO_LOOK) return makeDesiroCar(c, index);
  const D = S423_DIM;
  const g = new THREE.Group();
  const W = D.width;
  const red = mat(DB_RED, { roughness: 0.45 });
  const grey = mat(0xc9cdd0, { roughness: 0.5 });
  const dark = mat(0x34383c, { roughness: 0.7 });
  const glass = mat(0x1a2128, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const [xa, xb] = s423Body(c);
  const bodyL = xb - xa;
  const mid = (xa + xb) / 2;
  const bb = D.bodyBottom;

  // Body: red sides, a light grey band along the bottom, red roof. At a cab
  // the flat sides stop where the nose's flanks begin (set back by the corner rounding).
  const sa = c.cabRear ? xa + D.roofRise : xa;
  const sb = c.cabFront ? xb - D.roofRise : xb;
  const sideL = sb - sa;
  const sideMid = (sa + sb) / 2;
  g.add(box(sideL, D.eaves - bb, W, red, sideMid, (bb + D.eaves) / 2, 0));
  const ST = S423_STRIPES;
  g.add(box(sideL + 0.01, ST.dark, W + 0.012, mat(ST.colorDark, { roughness: 0.6 }), sideMid, bb + ST.dark / 2, 0));
  g.add(box(sideL + 0.01, ST.silver - ST.dark, W + 0.012, grey, sideMid, bb + (ST.dark + ST.silver) / 2, 0));
  const roof = new THREE.CylinderGeometry(W / 2, W / 2, bodyL, 48, 1, false, 0, Math.PI)
    .rotateZ(Math.PI / 2)
    .scale(1, D.roofRise / (W / 2), 1);
  // At a cab end the roof's end follows the nose's rounded top (set back at the
  // corners), so the two meet flush instead of the roof's end showing as a step
  if (c.cabFront) curveRoofEnd(roof, bodyL / 2, -1, W / 2, D.roofRise);
  if (c.cabRear) curveRoofEnd(roof, -bodyL / 2, 1, W / 2, D.roofRise);
  g.add(mesh(roof, red, mid, D.eaves, 0));
  // Dark grey stripe along the middle of the roof (as wide as the front panel, which
  // it runs down to), red at the edges
  {
    const k = S423_ROOF_STRIPE_U;
    const r0 = W / 2 + 0.006;
    const stripe = new THREE.CylinderGeometry(r0, r0, bodyL, 32, 1, true, Math.acos(k), Math.acos(-k) - Math.acos(k))
      .rotateZ(Math.PI / 2)
      .scale(1, D.roofRise / (W / 2), 1);
    if (c.cabFront) curveRoofEnd(stripe, bodyL / 2, -1, W / 2, D.roofRise);
    if (c.cabRear) curveRoofEnd(stripe, -bodyL / 2, 1, W / 2, D.roofRise);
    const sm = mesh(stripe, mat(S423_STRIPES.colorDark, { roughness: 0.6 }), mid, D.eaves, 0);
    sm.castShadow = false;
    g.add(sm);
  }
  // Roof equipment: an air-conditioning unit
  g.add(box(Math.min(3, bodyL * 0.25), 0.32, 1.7, mat(S423_STRIPES.colorDark, { roughness: 0.6 }), mid, D.eaves + D.roofRise + 0.12, 0));
  // Equipment under the floor, between the bogies
  g.add(box(bodyL * 0.45, 0.45, W - 0.5, dark, mid, bb - 0.225, 0));

  // Doors: double-leaf sliding doors in light grey with two tall windows
  const doors = s423Doors(c);
  const doorW = S423_DOOR.w;
  const doorTop = bb + S423_TOP_STRIPE.top;
  // A thin grey stripe along both sides above the windows, its top edge level with the
  // doors' tops, running the length of the body and on along the nose's flanks
  for (const side of [-1, 1]) {
    g.add(box(sideL, S423_TOP_STRIPE.h, 0.01, mat(0xc9cdd0, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), sideMid, bb + S423_TOP_STRIPE.top - S423_TOP_STRIPE.h / 2, side * (W / 2 + 0.005)));
  }
  for (const x of doors) {
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 0.008);
      // (down to the dark skirt, which runs on underneath)
      const doorBottom = bb + ST.dark;
      g.add(box(doorW, doorTop - doorBottom, 0.012, mat(0xbfc4c8, { roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), x, (doorBottom + doorTop) / 2, z));
      g.add(box(0.025, doorTop - doorBottom, 0.016, dark, x, (doorBottom + doorTop) / 2, side * (W / 2 + 0.012))); // the gap between the leaves
      // (one window in the middle of each leaf, the same height as the passenger windows)
      for (const dx of [-doorW / 4, doorW / 4]) {
        const geo = new THREE.ShapeGeometry(roundedRect(S423_DOOR.paneW, S423_WIN.h, 0.1) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        g.add(mesh(geo, glass, x + dx, bb + S423_WIN.centre, side * (W / 2 + 0.02)));
      }
    }
  }

  // Passenger windows: dark, rounded, filling the spaces between the doors and ends
  const winH = S423_WIN.h;
  const winY = bb + S423_WIN.centre;
  const [pa, pb] = s423Saloon(c);
  const segs: [number, number][] = [];
  const edges = [pa + (c.cabRear ? 0.2 : 0.45), ...doors.flatMap((x) => [x - doorW / 2 - 0.3, x + doorW / 2 + 0.3]), pb - (c.cabFront ? 0.2 : 0.45)];
  for (let i = 0; i < edges.length; i += 2) segs.push([edges[i], edges[i + 1]]);
  for (const [a, b] of segs) {
    const span = b - a;
    if (span < 0.6) continue;
    // (windows about 1.25 m wide with wide pillars between them)
    const P = S423_LAYOUT.pillar;
    const n = Math.max(1, Math.round((span + P) / (1.25 + P)));
    const w = (span - (n - 1) * P) / n;
    for (let i = 0; i < n; i++) {
      const x = a + w / 2 + i * (w + P);
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(roundedRect(w, winH, 0.12) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        const m = mesh(geo, glass, x, winY, side * (W / 2 + 0.012));
        m.castShadow = false;
        g.add(m);
      }
    }
  }

  // Lettering between each pair of doors (or ahead of the only door), below the windows, never over a door
  loadLetterFont()
    .then((font) => {
      // Free spans of side wall (clear of the doors by 0.3 m): between each pair of
      // doors, or with only one door, the wall ahead of it
      const clear = doorW / 2 + 0.3;
      const gaps = doors.length > 1 ? doors.slice(1).map((x, i) => [doors[i] + clear, x - clear]) : [[doors[0] + clear, pb - 0.3]];
      const letterMat = mat(0xffffff, { roughness: 0.5 });
      const CAP = 0.26;
      const MIN_CAP = 0.14; // squeezed below this the lettering is left off
      for (const [a, b] of gaps) {
        const geo = letterGeometry(font, stock.lettering, { capHeight: CAP, depth: 0.004, tracking: 0.12, maxWidth: Infinity });
        if (!geo) return;
        geo.computeBoundingBox();
        const fit = (b - a) / (geo.boundingBox!.max.x - geo.boundingBox!.min.x);
        if (CAP * Math.min(1, fit) < MIN_CAP) {
          geo.dispose();
          continue;
        }
        if (fit < 1) geo.scale(fit, fit, 1);
        // Centred in the red strip between the grey band and the windows
        const y = (bb + ST.silver + winY - winH / 2) / 2 - (CAP * Math.min(1, fit)) / 2;
        for (const side of [1, -1]) {
          const m = mesh(geo, letterMat, (a + b) / 2, y, side * (W / 2 + 0.014));
          m.rotation.y = side > 0 ? 0 : Math.PI;
          g.add(m);
        }
      }
    })
    .catch((err) => console.warn('S-Bahn lettering font failed to load', err));

  // Cabs (only the train's very front and rear show lights; coupled cabs are dark)
  const n = S423_CARS.length;
  if (c.cabFront) buildS423Nose(g, 1, c.len / 2, { frontOfTrain: index === 0, rearOfTrain: false });
  if (c.cabRear) buildS423Nose(g, -1, c.len / 2, { frontOfTrain: false, rearOfTrain: index === n - 1 });

  // Pantographs (see deriveStock), 1 m in from the body's end, arms reaching in
  // towards the car's middle: one raised to the contact wire, one folded
  if (c.pantoFront) addS423Pantograph(g, xb - 1.0, -1, c.pantoFront === 'raised');
  if (c.pantoRear) addS423Pantograph(g, xa + 1.0, 1, c.pantoRear === 'raised');

  return s423RunningGear(g, c, dark);
}

/**
 * An ÖBB Desiro ML car in VMOBIL livery: white above, red / orange-red / red bands
 * below and a black band along the bottom; two black double doors; windows towards
 * the ends and a lower black window strip between the doors; the lettering above that
 * strip and the logo in red near the ends; a light grey roof with equipment boxes.
 */
/**
 * A double-decker car's upper deck (local x): its arched roof runs on from a cab's nose,
 * or at a gangway end to L.deck.beyondDoor past the door, leaving the end a flat roof at
 * least long enough for a pantograph there folded (1 m in, its arms reaching in).
 */
/** Samples across a double-decker's arched roof (shared, so its parts' curves match). */
const DECK_U = 32;

function deckSpan(c: S423Car): [number, number] {
  const L = DESIRO_L;
  const dk = L.deck!;
  const [xa, xb] = s423Body(c);
  const ds = s423Doors(c);
  const flatMin = (panto: Panto) => (panto ? 1.0 + FOLDED_PANTO_REACH + 0.25 : 0.5);
  const a = c.cabRear ? xa : Math.max(xa + flatMin(c.pantoRear), ds[0] - L.door.w / 2 - dk.beyondDoor);
  const b = c.cabFront ? xb : Math.min(xb - flatMin(c.pantoFront), ds[ds.length - 1] + L.door.w / 2 + dk.beyondDoor);
  return [a, b];
}

/**
 * An arched roof from xa to xb (its ends at a cab following the nose's rounded top), with
 * wells let into it: over each well's length the middle (within h of the centre line)
 * drops to a flat floor at the eaves, with upright walls round it.
 */
/** How far back a cab's windscreen cuts into an arched roof's end at each z across (front: at xb; rear: at xa). */
type RoofCuts = { front?: (z: number) => number; rear?: (z: number) => number };
function addArchedRoof(g: THREE.Group, xa: number, xb: number, cabRear: boolean, cabFront: boolean, wells: { x0: number; x1: number; h: number }[], roofMat: THREE.Material, floorMat: THREE.Material, endMat?: THREE.Material, greyFrom = S423_DIM.eaves, cuts: RoofCuts = {}): void {
  const D = S423_DIM;
  const W = D.width;
  const hw = W / 2;
  const archY = (z: number) => D.eaves + D.roofRise * Math.sqrt(Math.max(0, 1 - (z / hw) ** 2));
  // (the arch is in the body's colour below greyFrom, the roof's grey above: zg is where
  // it crosses that height; the wells' floors are level with it)
  const zg = hw * Math.sqrt(Math.max(0, 1 - ((greyFrom - D.eaves) / D.roofRise) ** 2));
  const floorY = greyFrom;
  const dbl = (m: THREE.Material) => {
    const s = m as THREE.MeshStandardMaterial;
    return new THREE.MeshStandardMaterial({ color: s.color, roughness: s.roughness, metalness: s.metalness, side: THREE.DoubleSide });
  };
  const roofD = dbl(roofMat);
  const lowerD = dbl(endMat ?? roofMat);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    geo.computeVertexNormals();
    g.add(mesh(geo, m));
  };
  // A strip of the arch from z0 to z1, between x0 and x1
  // (split where the colour changes)
  const strip = (x0: number, x1: number, z0: number, z1: number) => {
    const cuts = [z0, ...[-zg, zg].filter((z) => z > z0 + 1e-6 && z < z1 - 1e-6), z1];
    for (let i = 0; i < cuts.length - 1; i++) strip1(x0, x1, cuts[i], cuts[i + 1], Math.abs((cuts[i] + cuts[i + 1]) / 2) < zg ? roofD : lowerD);
  };
  const strip1 = (x0: number, x1: number, z0: number, z1: number, m: THREE.Material) => {
    const n = Math.max(2, Math.ceil(((z1 - z0) / W) * 40));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      pos.push(x0, archY(z), z, x1, archY(z), z);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    if (cabRear && Math.abs(x0 - xa) < 1e-6) curveRoofEnd(geo, x0, 1, hw, noseRound());
    if (cabFront && Math.abs(x1 - xb) < 1e-6) curveRoofEnd(geo, x1, -1, hw, noseRound());
    // (cut back diagonally where a windscreen's border runs up into it)
    const pa = geo.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const z = pa.getZ(k);
      if (cuts.front && cabFront && Math.abs(pa.getX(k) - xb) < 1e-6) pa.setX(k, xb - cuts.front(z));
      else if (cuts.rear && cabRear && Math.abs(pa.getX(k) - xa) < 1e-6) pa.setX(k, xa + cuts.rear(z));
    }
    add(geo, m);
  };
  // The upright face of the arch across x, from |z| = h0 out to h1 (above the eaves)
  const face = (x: number, h0: number, h1: number) => {
    for (const s of [-1, 1]) {
      const pts: THREE.Vector2[] = [new THREE.Vector2(s * h0, floorY)];
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const z = h0 + ((h1 - h0) * i) / n;
        pts.push(new THREE.Vector2(s * z, archY(z)));
      }
      pts.push(new THREE.Vector2(s * h1, floorY));
      add(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateY(-Math.PI / 2).translate(x, 0, 0), roofD);
    }
  };
  const xs = [...new Set([xa, xb, ...wells.flatMap((w) => [w.x0, w.x1])].filter((x) => x >= xa && x <= xb))].sort((a, b) => a - b);
  const depth = (x0: number, x1: number) => Math.max(0, ...wells.filter((w) => w.x0 <= x0 + 1e-6 && w.x1 >= x1 - 1e-6).map((w) => w.h));
  let prev = 0;
  for (let i = 0; i < xs.length - 1; i++) {
    const [x0, x1] = [xs[i], xs[i + 1]];
    if (x1 - x0 < 1e-6) continue;
    const h = depth(x0, x1);
    if (h !== prev) face(x0, Math.min(h, prev), Math.max(h, prev));
    if (h === 0) strip(x0, x1, -hw, hw);
    else {
      if (h < hw - 1e-6) {
        strip(x0, x1, -hw, -h);
        strip(x0, x1, h, hw);
      }
      g.add(box(x1 - x0, 0.01, 2 * h, floorMat, (x0 + x1) / 2, floorY + 0.005, 0)); // the well's floor
      for (const s of [-1, 1]) {
        // its side walls, up to the arch
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([x0, floorY, s * h, x1, floorY, s * h, x0, archY(h), s * h, x1, archY(h), s * h], 3));
        geo.setIndex([0, 1, 2, 1, 3, 2]);
        add(geo, roofD);
      }
    }
    prev = h;
  }
  if (prev) face(xs[xs.length - 1], 0, prev);
  // Closing the arch at a gangway end (in the body's colour, like the end wall below)
  const endD = dbl(endMat ?? roofMat);
  for (const [x, cab] of [[xa, cabRear], [xb, cabFront]] as const) {
    if (cab) continue;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 32; i++) {
      const z = -hw + (2 * hw * i) / 32;
      pts.push(new THREE.Vector2(z, archY(z)));
    }
    add(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateY(-Math.PI / 2).translate(x, 0, 0), endD);
  }
}

function makeDesiroCar(c: S423Car, index: number): Car {
  const D = S423_DIM;
  const L = DESIRO_L;
  const g = new THREE.Group();
  const W = D.width;
  const bb = D.bodyBottom;
  const y = (h: number) => RAIL_TOP + h;
  const dark = mat(0x34383c, { roughness: 0.7 });
  const glass = mat(0x1f262d, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  /** How far out from the body side the windows' black surrounds sit. */
  const WIN_OUT = 0.02;
  const frameMat = mat(L.black, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const [xa, xb] = s423Body(c);
  const bodyL = xb - xa;
  const mid = (xa + xb) / 2;
  // At a cab the flat sides stop where the nose's flanks begin (set back by the rounding)
  const sa = c.cabRear ? xa + noseRound() : xa;
  const sb = c.cabFront ? xb - noseRound() : xb;
  const sideL = sb - sa;
  const sideMid = (sa + sb) / 2;

  // Body: white, flat-roofed (only the cab's roof is arched, over the nose), with the
  // bands laid along both sides; the flat roof light grey
  // (double-decker: the single-deck ends' flat roof, lower than the deck's arch)
  const flatTop = L.deck ? y(L.deck.endTop) : D.eaves + D.roofRise;
  const whiteMat = mat(L.white, { roughness: 0.45 });
  const roofMat = mat(L.roof, { roughness: 0.55 });
  // (double-decker: the deck's arched roof spans deckA..deckB, its walls up to the eaves;
  // only the single-deck ends beyond it stand up to the flat roof)
  const [deckA, deckB] = L.deck ? deckSpan(c) : [0, 0];
  const bodyTop = L.deck || L.archedRoof ? D.eaves : flatTop;
  g.add(box(sideL, bodyTop - bb, W, whiteMat, sideMid, (bb + bodyTop) / 2, 0));
  const flatEnd = (a0: number, b0: number) => {
    if (b0 - a0 < 0.01) return;
    if (!L.deck) {
      g.add(box(b0 - a0, flatTop - bodyTop, W, whiteMat, (a0 + b0) / 2, (bodyTop + flatTop) / 2, 0));
      g.add(box(b0 - a0, 0.01, W - 0.04, roofMat, (a0 + b0) / 2, flatTop + 0.005, 0));
      return;
    }
    // (double-decker: the deck's arched cross-section, cut off flat at the flat roof's
    // height; sampled at the same points as the arch (DECK_U) and smooth-shaded, so the
    // two curves match where they meet)
    const kc = (flatTop - D.eaves) / D.roofRise;
    const uc = Math.sqrt(Math.max(0, 1 - kc * kc));
    const archY = (u: number) => D.eaves + D.roofRise * Math.sqrt(Math.max(0, 1 - u * u));
    const grid = Array.from({ length: DECK_U + 1 }, (_, i) => -1 + (2 * i) / DECK_U);
    const sideMesh = (us: number[]) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const x of [a0, b0]) for (const u of us) pos.push(x, archY(u), (u * W) / 2);
      const P = us.length;
      for (let i = 0; i < P - 1; i++) idx.push(i, P + i, i + 1, P + i, P + i + 1, i + 1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      g.add(mesh(geo, mat(L.white, { roughness: 0.45, side: THREE.DoubleSide })));
    };
    sideMesh([...grid.filter((u) => u < -uc), -uc]);
    sideMesh([uc, ...grid.filter((u) => u > uc)]);
    // its ends: the cut-off profile
    const prof = [...grid.filter((u) => u < -uc), -uc, uc, ...grid.filter((u) => u > uc)].map((u) => new THREE.Vector2((u * W) / 2, archY(u)));
    for (const x of [a0, b0]) g.add(mesh(new THREE.ShapeGeometry(new THREE.Shape(prof)).rotateY(Math.PI / 2).translate(x, 0, 0), mat(L.white, { roughness: 0.45, side: THREE.DoubleSide })));
    g.add(box(b0 - a0, 0.01, uc * W - 0.04, roofMat, (a0 + b0) / 2, flatTop + 0.005, 0));
  };
  let buildRoof: ((cuts: RoofCuts) => void) | null = null;
  if (L.archedRoof) {
    // (an arched roof the whole length, its ends following a cab's rounded nose top, with
    // a well let into it for each pantograph: wide where its cross-bar lies, narrower
    // down the middle for its arm)
    const wells: { x0: number; x1: number; h: number }[] = [];
    const well = (x: number, knee: number) => {
      // (the cross-bar's: across the grey roof, out to where the red begins)
      const zg = (D.width / 2) * Math.sqrt(Math.max(0, 1 - ((RAIL_TOP + ALLEGRA_GREY_FROM - D.eaves) / D.roofRise) ** 2));
      wells.push({ x0: x - 0.35, x1: x + 0.35, h: zg });
      wells.push({ x0: Math.min(x, x + knee * 1.95), x1: Math.max(x, x + knee * 1.95), h: 0.55 });
    };
    if (c.pantoFront) well(xb - 1.0, -1);
    if (c.pantoRear) well(xa + 1.0, 1);
    // (built once the noses are, which say how far their windscreens cut back into it)
    buildRoof = (cuts) => addArchedRoof(g, xa, xb, c.cabRear, c.cabFront, wells, roofMat, roofMat, mat(L.white, { roughness: 0.45 }), RAIL_TOP + ALLEGRA_GREY_FROM, cuts); // (the wells' floors in the roof's grey too)
  } else if (!L.deck) flatEnd(sa, sb);
  else {
    if (!c.cabRear) flatEnd(sa, deckA);
    if (!c.cabFront) flatEnd(deckB, sb);
  }
  const band = (y0: number, y1: number, color: number) => {
    if (y1 - y0 < 0.005) return; // (an empty band: none, rather than a hairline)
    const m0 = mat(color, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const side of [-1, 1]) g.add(box(sideL, y1 - y0, 0.01, m0, sideMid, (y0 + y1) / 2, side * (W / 2 + 0.004)));
  };
  band(y(L.orangeTop), y(L.redTop), L.red);
  band(y(L.orangeBottom), y(L.orangeTop), L.orange);
  band(y(L.blackTop), y(L.orangeBottom), L.red);
  band(bb, y(L.blackTop), L.black);
  // Roof equipment: one box (the air-conditioning unit) in the middle of each car's roof
  if (L.roofBox) g.add(box(Math.min(5, bodyL * 0.22), 0.34, 1.6, mat(0x55595d, { roughness: 0.6 }), mid, flatTop + 0.17, 0));
  // Double-decker: the upper deck's roof, about a semicircle from the eaves (the upper
  // windows' bottom), carried straight on from the nose or, at a gangway end, dropping
  // straight down to the single-deck end's flat roof (as on the BRB's FLIRT); a dark
  // stripe along its top
  if (L.deck) {
    const rise = D.roofRise;
    const eaves = D.eaves;
    const U = DECK_U;
    const arch = (u0: number, u1: number, out: number, material: THREE.Material) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (const [si, x0] of [[0, deckA], [1, deckB]] as const) {
        for (let i = 0; i <= U; i++) {
          const u = u0 + ((u1 - u0) * i) / U;
          let x = x0;
          // (at a cab the roof's end follows the nose's rounded top, set back at the corners)
          if (si === 0 && c.cabRear) x += noseRound() * archRound(u);
          if (si === 1 && c.cabFront) x -= noseRound() * archRound(u);
          pos.push(x, eaves + rise * Math.sqrt(Math.max(0, 1 - u * u)) + out, (u * W) / 2 * (1 + out / (W / 2)));
          if (si && i) idx.push(i - 1, U + 1 + i - 1, i, U + 1 + i - 1, U + 1 + i, i);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = mesh(geo, material);
      m.castShadow = !out;
      g.add(m);
    };
    // (the dark stripe as wide as the flat ends' tops: out to where the arch reaches their height)
    const kc = (flatTop - eaves) / rise;
    const uc = Math.sqrt(Math.max(0, 1 - kc * kc));
    arch(-1, 1, 0, mat(L.white, { roughness: 0.45, side: THREE.DoubleSide }));
    arch(-uc, uc, 0.012, mat(0x2b2b2d, { roughness: 0.6, side: THREE.DoubleSide }));
    // The upright end at each drop: the arch's part above the flat roof
    for (const [x, cab] of [[deckA, c.cabRear], [deckB, c.cabFront]] as const) {
      if (cab) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= U; i++) {
        const u = -uc + (2 * uc * i) / U;
        pts.push(new THREE.Vector2((u * W) / 2, eaves + rise * Math.sqrt(Math.max(0, 1 - u * u))));
      }
      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateY(Math.PI / 2).translate(x, 0, 0);
      g.add(mesh(geo, mat(L.white, { roughness: 0.45, side: THREE.DoubleSide })));
    }
  }
  // Skirts, down to DESIRO_L.skirt: the low floor between the bogies (clear of the wheels,
  // its ends diagonal), and at a gangway end from beyond the wheels to the body's end
  // (diagonal by the wheels, square at the end), where there's room for one
  {
    const skirtY = y(L.skirt);
    // (the Allegra is articulated: at a gangway end the shared bogie (2.7 m) sits on the joint)
    const single = !ALLEGRA && desiroLayout(c).single;
    const inset = (front: boolean) => (ALLEGRA ? ((front ? c.cabFront : c.cabRear) ? S423_END_BOGIE : 0) : bogieInset(c, front));
    const halfBase = (front: boolean) => (single ? 0 : ALLEGRA && !(front ? c.cabFront : c.cabRear) ? 2.7 / 2 : L.wheelbase / 2);
    const clear = halfBase(true) + S423_WHEEL_R + DESIRO_SKIRT_CLEAR;
    const clearRear = halfBase(false) + S423_WHEEL_R + DESIRO_SKIRT_CLEAR;
    const rearAxle = -(c.len / 2 - inset(false));
    const frontAxle = c.len / 2 - inset(true);
    const slant = (bb - skirtY) * SKIRT.lean;
    // (KISS: in the body's lowest colour, with a grey band along the bottom)
    const SB = L.skirtBand;
    const lowest = L.orangeBottom > L.blackTop ? L.red : L.orange;
    const skirtMat = mat(SB ? lowest : L.black, { roughness: 0.5 });
    const bandMat = SB ? mat(SB.color, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }) : null;
    const panel = (a: number, b: number, diagA: boolean, diagB: boolean) => {
      if (b - a < (diagA ? slant : 0) + (diagB ? slant : 0) + 0.3) return; // (no room)
      // (its outline from height y0 up to y1, the diagonal ends following the full panel's)
      const inset = (yy: number) => (slant * (bb - yy)) / (bb - skirtY);
      const outline = (y0: number, y1: number) =>
        new THREE.Shape([
          new THREE.Vector2(a + (diagA ? inset(y1) : 0), y1),
          new THREE.Vector2(b - (diagB ? inset(y1) : 0), y1),
          new THREE.Vector2(b - (diagB ? inset(y0) : 0), y0),
          new THREE.Vector2(a + (diagA ? inset(y0) : 0), y0),
        ]);
      g.add(mesh(new THREE.ExtrudeGeometry(outline(skirtY, bb + 0.01), { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), skirtMat));
      if (SB && bandMat) g.add(mesh(new THREE.ExtrudeGeometry(outline(skirtY - 0.001, skirtY + SB.h), { depth: W + 0.01, bevelEnabled: false }).translate(0, 0, -(W + 0.01) / 2), bandMat));
    };
    panel(rearAxle + clearRear, frontAxle - clear, true, true);
    if (!c.cabRear) panel(xa, rearAxle - clearRear, false, true);
    if (!c.cabFront) panel(frontAxle + clear, xb, true, false);
  }

  // Doors: black double sliding doors, white strips down the leaves' meeting edges, a
  // window in each leaf
  const doors = s423Doors(c);
  const DR = L.door;
  const doorMat = mat(L.doorColor ?? L.black, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stripMat = mat(0xf2f2f0, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
  for (const x of doors) {
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 0.008);
      // (down to the low-floor skirt's bottom, or the top of its grey band)
      const d0 = y(L.skirt) + (L.skirtBand?.h ?? 0);
      if (L.outlinedDoors) {
        // (in the body's colours, which run on across it: just a white outline)
        const t = 0.04;
        const h = y(DR.top) - d0;
        for (const e of [-1, 1]) g.add(box(t, h, 0.012, stripMat, x + (e * (DR.w - t)) / 2, (d0 + y(DR.top)) / 2, side * (W / 2 + 0.012)));
        g.add(box(DR.w, t, 0.012, stripMat, x, y(DR.top) - t / 2, side * (W / 2 + 0.012)));
      } else if (L.doorBorder) {
        // (the door in a black border like the side windows': 5 cm round it, the same
        // corner radius; its top level with theirs)
        const top = y(L.win[1]);
        const h = top - d0 - 0.05;
        const cy = d0 + 0.05 + h / 2;
        // (both clear of the livery bands' faces at W/2 + 0.009; the door just ahead of
        // its border, behind its window's glass)
        const doorFace = mat(L.doorColor ?? L.black, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -3.5, polygonOffsetUnits: -3.5 });
        for (const [ww, hh, m0, dz] of [[DR.w + 0.1, h + 0.1, frameMat, 0.014], [DR.w, h, doorFace, 0.018]] as const) {
          const geo = new THREE.ShapeGeometry(roundedRect(ww, hh, 0.1) as THREE.Shape, 6);
          if (side < 0) geo.rotateY(Math.PI);
          const m = mesh(geo, m0, x, cy, side * (W / 2 + dz));
          m.castShadow = false;
          g.add(m);
        }
      } else g.add(box(DR.w, y(DR.top) - d0, 0.012, doorMat, x, (d0 + y(DR.top)) / 2, z));
      // (a pair of leaves: white strips down their meeting edges, a window in each; a
      // single leaf: one window, centred)
      if (!L.singleLeaf) for (const e of [-1, 1]) g.add(box(0.03, y(DR.top) - d0 - 0.1, 0.016, stripMat, x + e * 0.05, (d0 + y(DR.top)) / 2, side * (W / 2 + 0.012)));
      const [p0, p1] = DR.pane.map(y);
      for (const e of L.singleLeaf ? [0] : [-1, 1]) {
        // (outlined doors: the window in a black surround, like the side windows)
        if (L.outlinedDoors) {
          const fg = new THREE.ShapeGeometry(roundedRect(DR.paneW + 0.1, p1 - p0 + 0.1, 0.1) as THREE.Shape, 6);
          if (side < 0) fg.rotateY(Math.PI);
          g.add(mesh(fg, frameMat, x + e * DR.paneX, (p0 + p1) / 2, side * (W / 2 + 0.016)));
        }
        const geo = new THREE.ShapeGeometry(roundedRect(DR.paneW, p1 - p0, 0.08) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        g.add(mesh(geo, glass, x + e * DR.paneX, (p0 + p1) / 2, side * (W / 2 + 0.022)));
      }
    }
  }

  // Windows: in a black surround; as many of about L.winW as fit in each space
  const windowRow = (a: number, b: number, h0: number, h1: number, w: number, pillar: number): [number, number][] => {
    const span = b - a;
    if (span < 0.6) return [];
    const n = Math.max(1, Math.round((span + pillar) / (w + pillar)));
    const ww = (span - (n - 1) * pillar) / n;
    const out: [number, number][] = [];
    const pane = (x0: number, x1: number, pad: number, m0: THREE.Material, dz: number) => {
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(roundedRect(x1 - x0 + 2 * pad, y(h1) - y(h0) + 2 * pad, 0.1) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        const m = mesh(geo, m0, (x0 + x1) / 2, (y(h0) + y(h1)) / 2, side * (W / 2 + dz));
        m.castShadow = false;
        g.add(m);
      }
    };
    // One black surround round the whole row (so the pillars between are black too),
    // the panes in it
    // (both well clear of the side bands, whose front is ~1 cm out: else they flicker through)
    pane(a, b, 0.05, frameMat, WIN_OUT);
    for (let k = 0; k < n; k++) {
      const cx = a + ww / 2 + k * (ww + pillar);
      out.push([cx - ww / 2, cx + ww / 2]);
      pane(cx - ww / 2, cx + ww / 2, 0, glass, WIN_OUT + 0.006);
    }
    return out;
  };
  const dHalf = DR.w / 2;
  // (towards the ends: from the body's end, or at a cab from behind its side window)
  // (Allegra: from behind its driver's door)
  const cabClear = L.cabDoor ? 2.545 : L.driverWin.x[1] + 1.2; // (Allegra: the first window 2.545 m from the nose tip, behind the door)
  const endA = c.cabRear ? -c.len / 2 + cabClear : xa + L.endGap;
  const endB = c.cabFront ? c.len / 2 - cabClear : xb - L.endGap;
  // (at a cab, if no full window fits between it and the door, a smaller one with tighter gaps)
  // (cabEnd: where the driver's window ends; e: +1 for the front cab, −1 the rear)
  const cabRow = (cabEnd: number, doorEdge: number, e: number) => {
    const a = doorEdge + 0.4 * e;
    const b = cabEnd - 0.7 * e;
    return windowRow(Math.min(a, b), Math.max(a, b), L.win[0], L.win[1], L.winW, L.pillar);
  };
  let outerA = windowRow(endA, doors[0] - dHalf - L.doorGap, L.win[0], L.win[1], L.winW, L.pillar);
  if (!outerA.length && c.cabRear) outerA = cabRow(-c.len / 2 + L.driverWin.x[1], doors[0] - dHalf, -1);
  const lastDoor = doors[doors.length - 1];
  let outerB = windowRow(lastDoor + dHalf + L.doorGap, endB, L.win[0], L.win[1], L.winW, L.pillar);
  if (!outerB.length && c.cabFront) outerB = cabRow(c.len / 2 - L.driverWin.x[1], lastDoor + dHalf, 1);
  // (between the doors: one long black strip, its windows inside it; none with one door)
  const s0 = doors[0] + dHalf + L.stripGap;
  const s1 = lastDoor - dHalf - L.stripGap;
  if (doors.length > 1) for (const side of [-1, 1]) {
    const geo = new THREE.ShapeGeometry(roundedRect(s1 - s0, y(L.strip[1]) - y(L.strip[0]), 0.1) as THREE.Shape, 6);
    if (side < 0) geo.rotateY(Math.PI);
    const m = mesh(geo, frameMat, (s0 + s1) / 2, (y(L.strip[0]) + y(L.strip[1])) / 2, side * (W / 2 + WIN_OUT));
    m.castShadow = false;
    g.add(m);
  }
  if (doors.length > 1) windowRow(s0 + 0.08, s1 - 0.08, L.strip[0] + 0.08, L.strip[1] - 0.08, L.winW, 0.2);
  // (double-decker: the upper deck's strip, from door centre to door centre, on the
  // roof's curve: a black band with the panes in it)
  if (L.upperStrip && doors.length > 1) {
    const [h0, h1] = L.upperStrip.map(y);
    const onArch = (x0: number, x1: number, lo: number, hi: number, out: number, m0: THREE.Material) => {
      const NH = 8;
      for (const side of [-1, 1]) {
        const pos: number[] = [];
        const idx: number[] = [];
        for (let i = 0; i <= NH; i++) {
          const h = Math.min(lo + ((hi - lo) * i) / NH, D.eaves + D.roofRise - 0.01);
          const k = Math.max(0, (h - D.eaves) / D.roofRise);
          const z = (Math.sqrt(1 - k * k) * W) / 2;
          // outward normal of the (elliptical) arch there
          const nz = z / (W / 2) ** 2;
          const ny = (h - D.eaves) / D.roofRise ** 2;
          const nl = Math.hypot(nz, ny) || 1;
          for (const x of [x0, x1]) pos.push(x, h + (ny / nl) * out, side * (z + (nz / nl) * out));
          if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const m = mesh(geo, m0);
        m.castShadow = false;
        g.add(m);
      }
    };
    const sideMat = (m0: THREE.MeshStandardMaterial) => new THREE.MeshStandardMaterial({ color: m0.color, roughness: m0.roughness, metalness: m0.metalness, side: THREE.DoubleSide });
    onArch(doors[0], lastDoor, h0 - 0.05, h1 + 0.05, 0.008, sideMat(frameMat as THREE.MeshStandardMaterial));
    const span = lastDoor - doors[0] - 0.2;
    const n = Math.max(1, Math.round((span + 0.2) / 1.8));
    const ww = (span - (n - 1) * 0.2) / n;
    for (let k = 0; k < n; k++) {
      const x0 = doors[0] + 0.1 + k * (ww + 0.2);
      onArch(x0, x0 + ww, h0, h1, 0.014, sideMat(glass as THREE.MeshStandardMaterial));
    }
  }

  // Lettering (dark grey) centred between the doors above the strip; the logo (red)
  // above the window nearest each end
  loadLetterFont()
    .then((font) => {
      const place = (text: string, color: number, cap: number, cx: number, bottom: number, maxWidth: number) => {
        const geo = letterGeometry(font, text, { capHeight: cap, depth: 0.004, tracking: 0.1, maxWidth });
        if (!geo) return;
        // (sit the lowest point on `bottom`, not the baseline: Jost's J dips below it)
        geo.computeBoundingBox();
        geo.translate(0, -Math.min(0, geo.boundingBox!.min.y), 0);
        const m0 = mat(color, { roughness: 0.5 });
        for (const side of [1, -1]) {
          // (in front of the bands and the windows' surrounds, so it never flickers against them)
          const m = mesh(geo, m0, cx, bottom, side * (W / 2 + WIN_OUT + 0.012));
          m.rotation.y = side > 0 ? 0 : Math.PI;
          g.add(m);
        }
      };
      // (as wide as the stretch between the doors allows, not just the strip's windows)
      const t0 = doors[0] + dHalf + 0.25;
      const t1 = lastDoor - dHalf - 0.25;
      // (above the strip and clear of the red band; on a double-decker centred in the white
      // between them and the upper deck's windows)
      const below = Math.max(y(L.strip[1]), y(L.redTop));
      const letterBottom = L.upperStrip ? (below + y(L.upperStrip[0])) / 2 - L.letterCap / 2 : below + L.letterGap;
      if (doors.length > 1) place(stock.lettering, L.lettering, L.letterCap, (t0 + t1) / 2, letterBottom, t1 - t0);
      else {
        // (one door: below the windows on its longer side, as on the Allegra)
        const row = outerB.length >= outerA.length ? outerB : outerA;
        if (row.length) {
          const a = row[0][0];
          const b = row[row.length - 1][1];
          place(stock.lettering, L.lettering, Math.min(L.letterCap, 0.3), (a + b) / 2, y(L.win[0]) - 0.15 - Math.min(L.letterCap, 0.3), b - a);
        }
      }
      const logoBottom = y(L.win[1]) + 0.12;
      const ends = [outerA[0], outerB[outerB.length - 1]].filter(Boolean);
      for (const [a, b] of ends) place(stock.emblem, L.logo, 0.24, (a + b) / 2, logoBottom, b - a);
    })
    .catch((err) => console.warn('Desiro lettering font failed to load', err));

  // Cabs (only the train's very front and rear show lights)
  const n = S423_CARS.length;
  const cutFront = c.cabFront ? buildS423Nose(g, 1, c.len / 2, { frontOfTrain: index === 0, rearOfTrain: false, bogieIn: bogieInset(c, true) }) : null;
  const cutRear = c.cabRear ? buildS423Nose(g, -1, c.len / 2, { frontOfTrain: false, rearOfTrain: index === n - 1, bogieIn: bogieInset(c, false) }) : null;
  (buildRoof as ((cuts: RoofCuts) => void) | null)?.({ front: cutFront ?? undefined, rear: cutRear ?? undefined });
  // Pantographs on the flat roof, 1 m in from its end: at a gangway the body's end, at a
  // cab (a railcar's) behind the cab's raised roof
  const roofA = xa + (c.cabRear ? L.hump : 0);
  const roofB = xb - (c.cabFront ? L.hump : 0);
  // (a double-decker railcar's roof is the deck's arch all along: stand on that)
  // (arched roof: the plate down in its well, level with the top of the sides, in the roof's grey)
  // (its plate's top flush with the well's floor, which is 1 cm above the eaves)
  const panRoof = L.archedRoof ? RAIL_TOP + ALLEGRA_GREY_FROM + 0.01 - 0.08 : L.deck && c.cabFront && c.cabRear ? undefined : flatTop;
  const plateColor = L.archedRoof ? L.roof : undefined;
  // (arched roof: 20 cm further in, so folded its head (out 20 cm past its base, towards
  // the end) lies centred in the cross-bar's well, 1 m in)
  const panIn = 1.0 + (L.archedRoof ? 0.2 : 0);
  if (c.pantoFront) addS423Pantograph(g, roofB - panIn, -1, c.pantoFront === 'raised', panRoof, plateColor);
  if (c.pantoRear) addS423Pantograph(g, roofA + panIn, 1, c.pantoRear === 'raised', panRoof, plateColor);

  return s423RunningGear(g, c, dark);
}

/**
 * Bogies and wheels for an articulated car (423 and FLIRT alike): a bogie under each
 * cab end, and the shared (Jakobs) bogie at the car's rear joint. Returns the Car.
 */
/** Wheelbase of a cab car's outer bogie (the FLIRT's longer, as on the drawing; the Jacobs bogies are 2.7 m). */
const endWheelbase = () => (FLIRT ? 2.6 : DESIRO ? DESIRO_L.wheelbase : 2.2);

type CarEnds = { len: number; cabFront: boolean; cabRear: boolean };

/**
 * A Desiro ML car's doors and running gear, laid out together so no door stands over a
 * wheel (nor the low-floor skirt's diagonal end over a door), and no wheel beyond the
 * body's end. Two doors where they fit: each bogie between a door and the car's end, at
 * its usual place or moved out towards the end; past that the doors move in, down to
 * room for one window between them. Failing that, one door in the middle, the bogies
 * again between it and the ends; and if even they can't fit, a single axle each side,
 * halfway between the door and the body's end (as the short carriages: carriageAxles).
 * Insets are a bogie's or axle's centre in from the car's end (a cab's face, or the
 * gangway end).
 */
function desiroLayout(c: CarEnds): { doors: number[]; insetFront: number; insetRear: number; single: boolean } {
  const L = DESIRO_L;
  const half = c.len / 2;
  const dw = L.door.w / 2;
  const reach = L.wheelbase / 2 + S423_WHEEL_R; // bogie centre to its outer wheels' edge
  const base = (cab: boolean) => (cab ? S423_END_BOGIE : L.bogieIn);
  // Least inset: the bogie (its frame reaching 0.45 m past the axles) kept 0.3 m inside
  // the body's end (a cab's face, or short of the gangway)
  const frame = L.wheelbase / 2 + 0.45;
  const minIn = (cab: boolean) => frame + 0.3 + (cab ? 0 : S423_DIM.jointGap / 2);
  // Bogie centre to the nearest door's edge: the low-floor skirt's diagonal end (which
  // starts DESIRO_SKIRT_CLEAR beyond the wheels) must finish before the door
  const toDoor = reach + DESIRO_SKIRT_CLEAR + (S423_DIM.bodyBottom - (RAIL_TOP + L.skirt)) * SKIRT.lean;
  // Furthest out each door may stand, with a bogie at its least inset beyond it
  const maxFront = half - minIn(c.cabFront) - toDoor - dw;
  const maxRear = half - minIn(c.cabRear) - toDoor - dw;
  const insets = (front: number, rear: number) => ({
    insetFront: Math.min(base(c.cabFront), half - (front + dw) - toDoor),
    insetRear: Math.min(base(c.cabRear), half - (-rear + dw) - toDoor),
  });
  // Two doors: where a middle car has them, moved in (shrinking the stretch between
  // them, down to room for one window: DESIRO_L.minDoorPitch) if a bogie needs the room
  const body = stockLength(stock) - S423_DIM.jointGap;
  const inset = L.doorInset * body;
  const ra = -half + (c.cabRear ? S423_CAB_EXTRA : 0) + S423_DIM.jointGap / 2;
  const rb = half - (c.cabFront ? S423_CAB_EXTRA : 0) - S423_DIM.jointGap / 2;
  const d0 = Math.max(ra + inset, -maxRear);
  const d1 = Math.min(rb - inset, maxFront);
  if (d1 - d0 >= L.minDoorPitch) return { doors: [d0, d1], ...insets(d1, d0), single: false };
  // One door in the middle, bogies between it and the ends where they fit
  const d = (ra + rb) / 2;
  if (d <= maxFront && -d <= maxRear) return { doors: [d], ...insets(d, d), single: false };
  // Else a single axle each side, halfway between the door and the body's end
  const endF = half - (c.cabFront ? 0 : S423_DIM.jointGap / 2);
  const endR = half - (c.cabRear ? 0 : S423_DIM.jointGap / 2);
  return { doors: [d], insetFront: half - (d + dw + endF) / 2, insetRear: half - (-d + dw + endR) / 2, single: true };
}

/**
 * A LINT car's doors and cab bogies, by the Desiro ML's rules (desiroLayout): two doors,
 * nominally either side of the middle at 38% / 62% of the car's length (as on the LINT
 * 54), never over a wheel nor the skirt's diagonal ends. A cab's bogie moves out towards
 * the nose (its frame kept 0.3 m inside the face) to make room; then the doors move in,
 * down to room for one window between them; failing that, one door in the middle. (The
 * shared bogie at a joint stays where it is.)
 */
function lintLayout(c: CarEnds): { doors: number[]; insetFront: number; insetRear: number } {
  const half = c.len / 2;
  const dh = LINT_DOOR_W / 2;
  const reach = (wb: number) => wb / 2 + S423_WHEEL_R + 0.1 + 0.5 * SKIRT.lean; // (the skirt's cut-out, and its diagonal)
  const minIn = 2.2 / 2 + 0.45 + 0.3;
  // Nearest a door's edge may come to each end: inside the cab bogie at its least inset,
  // or the shared bogie at the joint
  const limit = (cab: boolean) => (cab ? half - minIn - reach(2.2) : half - reach(2.7));
  const insetFor = (cab: boolean, doorEdge: number) => (cab ? Math.max(minIn, Math.min(S423_END_BOGIE, half - doorEdge - reach(2.2))) : S423_END_BOGIE);
  const d0 = Math.max(-0.117 * c.len, -limit(c.cabRear) + dh);
  const d1 = Math.min(0.117 * c.len, limit(c.cabFront) - dh);
  if (d1 - d0 >= LINT_DOOR_W + 2 * 0.43 + 1.0) return { doors: [d0, d1], insetFront: insetFor(c.cabFront, d1 + dh), insetRear: insetFor(c.cabRear, -d0 + dh) };
  return { doors: [0], insetFront: insetFor(c.cabFront, dh), insetRear: insetFor(c.cabRear, dh) };
}

/** A bogie's (or single axle's) centre, in from the car's end: a cab's face or the gangway end. */
function bogieInset(c: CarEnds, front: boolean): number {
  if (LINT) {
    const l = lintLayout(c);
    return front ? l.insetFront : l.insetRear;
  }
  if (DESIRO) {
    const l = desiroLayout(c);
    return front ? l.insetFront : l.insetRear;
  }
  return S423_END_BOGIE;
}

/**
 * An RhB EW II coach, or (cabCar) an ABt driving trailer with its cab at the rear: a
 * red body on its own two bogies, coupled to its neighbours by central couplers with a
 * gangway between coaches.
 */
/** A polygon with its corners rounded off (radius r, or less where the sides are short). */
function roundedPolygon(pts: THREE.Vector2[], r: number): THREE.Shape {
  const sh = new THREE.Shape();
  const n = pts.length;
  pts.forEach((p, i) => {
    const prev = pts[(i + n - 1) % n];
    const next = pts[(i + 1) % n];
    const a = prev.clone().sub(p);
    const b = next.clone().sub(p);
    const rr = Math.min(r, a.length() / 2, b.length() / 2);
    const p0 = p.clone().addScaledVector(a.normalize(), rr);
    const p1 = p.clone().addScaledVector(b.normalize(), rr);
    if (i === 0) sh.moveTo(p0.x, p0.y);
    else sh.lineTo(p0.x, p0.y);
    sh.quadraticCurveTo(p.x, p.y, p1.x, p1.y);
  });
  sh.closePath();
  return sh;
}

function makeRhbCoach(c: S423Car, index: number): Car {
  const g = new THREE.Group();
  const L = c.len;
  const W = RHB.width;
  const y = (h: number) => RAIL_TOP + h;
  const bb = y(RHB.bodyBottom);
  const eaves = y(RHB.eaves);
  const cab = c.kind === 'cabCar';
  const red = mat(RHB.red, { roughness: 0.45 });
  const dark = mat(RHB.under, { roughness: 0.7 });
  const glass = mat(0x1f262d, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const silver = mat(RHB.door, { roughness: 0.35, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const side = (o: THREE.Object3D, s: number) => {
    o.position.z = s * (W / 2 + 0.01);
    if (s < 0) o.rotation.y = Math.PI;
    return o;
  };

  // Body, arched silver roof, underframe, and the light band under the windows. The
  // driving trailer's cab end slopes back above the lights (by `rake` at the roof)
  // (as on the ABt 1701: leaning back gently from just above the buffer beam to the roof)
  const rake = cab ? 0.35 : 0;
  const knee = y(1.15); // (where the cab end starts to slope back)
  const x0 = -L / 2 + rake;
  // (the doors set back RHB.doorIndent into the body, in a niche from the floor to just
  // above them; elsewhere the body runs out to its full width)
  const doorXs = s423Doors(c);
  const spans = doorXs.map((x) => [x - RHB.doorW / 2, x + RHB.doorW / 2]).sort((p, q) => p[0] - q[0]);
  const nicheTop = y(RHB.doorTop) + 0.08;
  let from = x0;
  for (const [d0, d1] of spans) {
    if (d0 > from) g.add(box(d0 - from, eaves - bb, W, red, (from + d0) / 2, (bb + eaves) / 2, 0));
    g.add(box(d1 - d0, nicheTop - bb, W - 2 * RHB.doorIndent, red, (d0 + d1) / 2, (bb + nicheTop) / 2, 0));
    g.add(box(d1 - d0, eaves - nicheTop, W, red, (d0 + d1) / 2, (nicheTop + eaves) / 2, 0));
    // a step below the door, reaching out to the body's side
    // (hung from the body's bottom edge by two metal links, one at each end)
    for (const s of [-1, 1]) {
      const sz = s * (W / 2 - (RHB.doorIndent + 0.05) / 2);
      g.add(box(d1 - d0 - 0.1, 0.06, RHB.doorIndent + 0.05, dark, (d0 + d1) / 2, bb - 0.16, sz));
      // (the links at the step's back edge, by the door, in the step's colour)
      for (const e of [-1, 1]) g.add(box(0.04, 0.16, 0.04, dark, (d0 + d1) / 2 + e * ((d1 - d0) / 2 - 0.1), bb - 0.08, s * (W / 2 - RHB.doorIndent - 0.03)));
    }
    from = d1;
  }
  if (L / 2 > from) g.add(box(L / 2 - from, eaves - bb, W, red, (from + L / 2) / 2, (bb + eaves) / 2, 0));
  if (cab) {
    const prof = new THREE.Shape([new THREE.Vector2(-L / 2, bb), new THREE.Vector2(x0 + 0.001, bb), new THREE.Vector2(x0 + 0.001, eaves), new THREE.Vector2(x0, eaves), new THREE.Vector2(-L / 2, knee)]);
    g.add(mesh(new THREE.ExtrudeGeometry(prof, { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2), red));
  }
  g.add(mesh(new THREE.CylinderGeometry(W / 2, W / 2, L / 2 - x0, 40, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, RHB.roofRise / (W / 2), 1), mat(RHB.roof, { roughness: 0.4, metalness: 0.3 }), (x0 + L / 2) / 2, eaves, 0));
  // (no skirt: under the body only a small equipment box in the middle)
  g.add(box(1.8, 0.3, 1.4, dark, 0, bb - 0.15, 0));
  const bandMat = mat(RHB.band, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  {
    // (the band stops either side of each door's niche; at the cab, short of the sloping
    // front by as much as the cab's side window is)
    let bf = cab ? -L / 2 + (Math.max(0, y(RHB.band1) - knee) * rake) / (eaves - knee) + 0.15 : -L / 2;
    const bandRun = (a: number, b: number) => {
      if (b - a > 0.01) for (const s of [-1, 1]) g.add(box(b - a, y(RHB.band1) - y(RHB.band0), 0.01, bandMat, (a + b) / 2, (y(RHB.band0) + y(RHB.band1)) / 2, s * (W / 2 + 0.004)));
    };
    for (const [d0, d1] of spans) {
      bandRun(bf, d0);
      bf = d1;
    }
    bandRun(bf, L / 2);
  }
  // A few vents along the roof
  for (const k of [-0.36, -0.12, 0.12, 0.36]) g.add(box(0.5, 0.08, 0.35, mat(0x9aa0a5), k * L, eaves + RHB.roofRise + 0.03, 0));

  // Doors: silver, two narrow windows (the coach: one near each end; the driving
  // trailer: one behind its cab)
  const doors = s423Doors(c);
  const doorFrame = mat(0x2b2e31, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const x of doors) {
    for (const s of [-1, 1]) {
      const door = side(box(RHB.doorW, y(RHB.doorTop) - bb + 0.05, 0.012, silver, x, (bb - 0.05 + y(RHB.doorTop)) / 2, 0), s);
      door.position.z = s * (W / 2 - RHB.doorIndent + 0.01); // (at the back of its niche)
      g.add(door);
      for (const e of [-1, 1]) {
        // (in a dark border, like the passenger windows)
        const fr = side(mesh(new THREE.ShapeGeometry(roundedRect(0.22, 0.96, 0.08) as THREE.Shape, 4), doorFrame, x + e * 0.22, y(RHB.win[0]) + 0.45, 0), s);
        fr.position.z = s * (W / 2 - RHB.doorIndent + 0.024);
        g.add(fr);
        const geo = new THREE.ShapeGeometry(roundedRect(0.16, 0.9, 0.06) as THREE.Shape, 4);
        const m = side(mesh(geo, glass, x + e * 0.22, y(RHB.win[0]) + 0.45, 0), s);
        m.position.z = s * (W / 2 - RHB.doorIndent + 0.03); // (just in front of the door)
        g.add(m);
      }
    }
  }

  // Windows between the doors (the driving trailer: from its door to the far end)
  const a = cab ? doors[0] + RHB.doorW / 2 + 0.5 : doors[0] + RHB.doorW / 2 + 0.55;
  const b = cab ? L / 2 - 0.9 : doors[1] - RHB.doorW / 2 - 0.55;
  const n = Math.max(1, Math.round((b - a + RHB.pillar) / (RHB.winW + RHB.pillar)));
  const ww = (b - a - (n - 1) * RHB.pillar) / n;
  const [w0, w1] = RHB.win.map(y);
  const frame = mat(0x2b2e31, { roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (let k = 0; k < n; k++) {
    const cx = a + ww / 2 + k * (ww + RHB.pillar);
    for (const s of [-1, 1]) {
      g.add(side(mesh(new THREE.ShapeGeometry(roundedRect(ww + 0.08, w1 - w0 + 0.08, 0.12) as THREE.Shape, 6), frame, cx, (w0 + w1) / 2, 0), s));
      const m = side(mesh(new THREE.ShapeGeometry(roundedRect(ww, w1 - w0, 0.1) as THREE.Shape, 6), glass, cx, (w0 + w1) / 2, 0), s);
      m.position.z += Math.sign(m.position.z) * 0.004;
      g.add(m);
    }
  }

  // Lettering in white under the windows, in the middle
  loadLetterFont()
    .then((font) => {
      const geo = letterGeometry(font, stock.lettering, { capHeight: 0.24, depth: 0.004, tracking: 0.1, maxWidth: (b - a) * 0.8 });
      if (!geo) return;
      const m0 = mat(0xffffff, { roughness: 0.5 });
      for (const s of [1, -1]) {
        const m = mesh(geo, m0, (a + b) / 2, y(RHB.band0) - 0.4, s * (W / 2 + 0.014));
        m.rotation.y = s > 0 ? 0 : Math.PI;
        g.add(m);
      }
    })
    .catch((err) => console.warn('RhB lettering font failed to load', err));

  // Ends: a central coupler at each; a gangway to a neighbouring coach; the driving
  // trailer's cab at its rear: a near-flat front with a two-pane windscreen and lights
  for (const dir of [1, -1]) {
    const endX = (dir * L) / 2;
    const cabEnd = cab && dir < 0;
    g.add(box(0.35, 0.22, 0.3, dark, endX + dir * 0.175, y(RHB.coupler), 0));
    // (an end facing the Allegra, which has no gangway: the coach's own, folded back and unused)
    if (!cabEnd && dir > 0 && (S423_CARS[index - 1]?.kind ?? 'emu') === 'emu') {
      const rubber = mat(0x1b1c1e, { roughness: 0.95 });
      const gy0 = y(RHB.gangwayBottom); // (above the coupler)
      const gy1 = y(RHB.doorTop) + 0.05;
      for (const e of [-1, 1]) g.add(box(0.14, gy1 - gy0, 0.14, rubber, endX + 0.07, (gy0 + gy1) / 2, e * 0.63));
      g.add(box(0.14, 0.14, 1.4, rubber, endX + 0.07, gy1 - 0.07, 0));
      g.add(box(0.14, 0.1, 1.4, rubber, endX + 0.07, gy0 + 0.05, 0));
      // the end door inside it: grey like the side doors, set just proud of the end wall,
      // a window in its upper half, a handle
      const doorH = gy1 - gy0 - 0.25;
      const doorY = gy0 + 0.1 + doorH / 2;
      g.add(box(0.012, doorH, 0.9, silver, endX + 0.008, doorY, 0));
      g.add(box(0.01, doorH * 0.4 + 0.06, 0.56, mat(0x2b2e31, { roughness: 0.5 }), endX + 0.016, doorY + doorH * 0.18, 0)); // (its border)
      g.add(box(0.01, doorH * 0.4, 0.5, glass, endX + 0.022, doorY + doorH * 0.18, 0));
      g.add(box(0.03, 0.14, 0.03, mat(0xd9dcdf, { metalness: 0.6, roughness: 0.35 }), endX + 0.03, doorY - 0.1, 0.33));
    }
    if (cabEnd) {
      const face = endX - 0.01;
      const black = mat(0x15171a, { roughness: 0.35, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const frameD = mat(0x2b2e31, { roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      // the windscreen: two panes lying on the sloping upper end
      const run = eaves - knee;
      const slopeLen = Math.hypot(rake, run);
      const theta = Math.atan2(rake, run);
      const nx = -run / slopeLen;
      const ny = rake / slopeLen;
      for (const e of [-1, 1]) {
        // (a narrow pillar between them, 0.1 m; 0.2 m of red at the outer edges)
        const pw = W / 2 - 0.2 - 0.05;
        // (as tall as the passenger windows and level with them, measured upright)
        const [wy0, wy1] = RHB.win.map(y);
        const ph = ((wy1 - wy0) * slopeLen) / run;
        const pane = new THREE.ShapeGeometry(roundedRect(pw - 0.08, ph - 0.08, 0.08) as THREE.Shape, 6).rotateY(-Math.PI / 2).rotateZ(-theta);
        const wyc = (wy0 + wy1) / 2;
        const m = mesh(pane, black, -L / 2 + (rake * (wyc - knee)) / run + nx * 0.012, wyc + ny * 0.012, e * (0.05 + pw / 2));
        // (in a border like the passenger windows', taking the pane's old size: the pillar between stays as it was)
        const rim = new THREE.ShapeGeometry(roundedRect(pw, ph, 0.1) as THREE.Shape, 6).rotateY(-Math.PI / 2).rotateZ(-theta);
        const fm = mesh(rim, frameD, -L / 2 + (rake * (wyc - knee)) / run + nx * 0.006, wyc + ny * 0.006, e * (0.05 + pw / 2));
        fm.castShadow = false;
        g.add(fm);
        m.castShadow = false;
        g.add(m);
      }
      // cab side windows
      // cab side windows, between the nose and the door: one whose front edge follows the
      // slope of the front, and a square one behind it; both as tall as the passenger windows
      {
        const [wy0, wy1] = RHB.win.map(y);
        const slopeX = (yy: number) => endX + Math.max(0, yy - knee) * (rake / (eaves - knee)) + 0.15;
        const back = endX + 0.62;
        const tri = roundedPolygon([new THREE.Vector2(back - 0.04, wy0 + 0.04), new THREE.Vector2(back - 0.04, wy1 - 0.04), new THREE.Vector2(slopeX(wy1) + 0.04, wy1 - 0.04), new THREE.Vector2(slopeX(wy0) + 0.04, wy0 + 0.04)], 0.08);
        const sq = wy1 - wy0;
        const triRim = roundedPolygon([new THREE.Vector2(back, wy0), new THREE.Vector2(back, wy1), new THREE.Vector2(slopeX(wy1), wy1), new THREE.Vector2(slopeX(wy0), wy0)], 0.1);
        for (const s of [-1, 1]) {
          const r1 = mesh(new THREE.ShapeGeometry(triRim), frameD, 0, 0, s * (W / 2 + 0.008));
          r1.castShadow = false;
          g.add(r1);
          const r2 = side(mesh(new THREE.ShapeGeometry(roundedRect(sq, sq, 0.1) as THREE.Shape, 4), frameD, back + 0.1 + sq / 2, (wy0 + wy1) / 2, 0), s);
          r2.position.z -= s * 0.004;
          g.add(r2);
          const m1 = mesh(new THREE.ShapeGeometry(tri), mat(0x1f262d, { roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 0, 0, s * (W / 2 + 0.012));
          m1.castShadow = false;
          g.add(m1);
          const sqm = side(mesh(new THREE.ShapeGeometry(roundedRect(sq - 0.08, sq - 0.08, 0.08) as THREE.Shape, 4), glass, back + 0.1 + sq / 2, (wy0 + wy1) / 2, 0), s);
          sqm.position.z += s * 0.004;
          g.add(sqm);
        }
      }
      const front = index === 0;
      const rear = index === S423_CARS.length - 1;
      const n0 = new THREE.Vector3(-1, 0, 0);
      // (the lights on the upright part below the slope; the logo on the slope, lying on it)
      const faceAt = (yy: number) => face + Math.max(0, yy - knee) * (rake / (eaves - knee));
      const lampY = (bb + knee) / 2 + 0.03;
      for (const e of [-1, 1]) {
        lampOn(g, new THREE.Vector3(face, lampY, e * 0.85), n0, 0.09, lampMaterial('white', front));
        lampOn(g, new THREE.Vector3(face, lampY, e * 1.08), n0, 0.05, lampMaterial('red', rear));
      }

      // the logo above the lights, in the locos' framed style
      // a white light high in the middle, on the slope just under the roof
      const topY = eaves - 0.18;
      lampOn(g, new THREE.Vector3(faceAt(topY) + nx * 0.01, topY + ny * 0.01, 0), new THREE.Vector3(nx, ny, 0), 0.09, lampMaterial('white', front));
      const logoY = knee + 0.3;
      addEmblemAt(g, new THREE.Vector3(faceAt(logoY) + nx * 0.006, logoY + ny * 0.006, 0), new THREE.Vector3(nx, ny, 0), 0.42);
      addSnowplough(g, endX, -1, bb - 0.05, W - 0.6, dark);
    }
  }

  // Bogies: frames and wheels, near each end
  const xs: number[] = [];
  const frameZ = WHEEL_Z + 0.22;
  for (const cx of [L / 2 - RHB.bogieIn, -(L / 2 - RHB.bogieIn)]) {
    xs.push(cx + RHB.wheelbase / 2, cx - RHB.wheelbase / 2);
    for (const s of [-1, 1]) g.add(box(RHB.wheelbase + 0.7, 0.3, 0.14, dark, cx, RAIL_TOP + RHB.wheelR + 0.06, s * frameZ));
    const top = RAIL_TOP + RHB.wheelR + 0.21;
    if (bb - top > 0.02) g.add(box(0.8, bb - top + 0.02, 2 * frameZ + 0.14, dark, cx, (top + bb) / 2, 0));
  }
  const { wheels } = addWheels(g, xs, false, undefined, RHB.wheelR);
  const pivot = L / 2 - RHB.bogieIn;
  return { obj: g, offset: c.offset, wheels, rods: [], pivot, pivotFront: pivot, pivotBack: pivot };
}

function s423RunningGear(g: THREE.Group, c: S423Car, dark: THREE.Material): Car {
  const xs: number[] = [];
  // What links the running gear to the body: where the body stands clear of the bogie
  // frames (the FLIRT, LINT and Desiro ML sit higher than the S-Bahn), a bolster across
  // from the frames' tops up to the body's bottom
  const bb = S423_DIM.bodyBottom;
  const frameTop = RAIL_TOP + S423_WHEEL_R + 0.12 + 0.21;
  const frameZ = WHEEL_Z + 0.22;
  const bolster = (cx: number) => {
    if (bb - frameTop > 0.02) g.add(box(0.8, bb - frameTop + 0.02, 2 * frameZ + 0.14, dark, cx, (frameTop + bb) / 2, 0));
  };
  const bogie = (cx: number, wheelbase: number) => {
    xs.push(cx + wheelbase / 2, cx - wheelbase / 2);
    for (const side of [-1, 1]) {
      g.add(box(wheelbase + 0.9, 0.42, 0.14, dark, cx, RAIL_TOP + S423_WHEEL_R + 0.12, side * frameZ));
    }
    bolster(cx);
  };
  // A single axle: an axle box each side with a spring and a hanger up to the body
  const singleAxle = (x: number) => {
    xs.push(x);
    const hub = RAIL_TOP + S423_WHEEL_R;
    for (const side of [-1, 1]) {
      g.add(box(0.36, 0.3, 0.14, dark, x, hub, side * frameZ));
      g.add(box(1.2, 0.12, 0.14, dark, x, hub + 0.24, side * frameZ));
      if (bb - hub - 0.3 > 0.02) g.add(box(0.12, bb - hub - 0.3 + 0.02, 0.14, dark, x, (hub + 0.3 + bb) / 2, side * frameZ));
    }
  };
  // (Desiro ML: not articulated: a bogie near each end of every car)
  const ownFront = c.cabFront || DESIRO;
  const ownRear = c.cabRear || DESIRO;
  const inFront = DESIRO || LINT ? bogieInset(c, true) : S423_END_BOGIE;
  const inRear = DESIRO || LINT ? bogieInset(c, false) : S423_END_BOGIE;
  const single = DESIRO && desiroLayout(c).single;
  if (single) {
    singleAxle(c.len / 2 - inFront);
    singleAxle(-(c.len / 2 - inRear));
  }
  else {
    if (ownFront) bogie(c.len / 2 - inFront, endWheelbase());
    if (ownRear) bogie(-(c.len / 2 - inRear), endWheelbase());
    else bogie(-c.len / 2, 2.7);
  }
  const { wheels } = addWheels(g, xs, false, undefined, S423_WHEEL_R);

  const pivotFront = ownFront ? c.len / 2 - inFront : c.len / 2;
  const pivotBack = ownRear ? c.len / 2 - inRear : c.len / 2;
  return { obj: g, offset: c.offset, wheels, rods: [], pivot: (pivotFront + pivotBack) / 2, pivotFront, pivotBack };
}

/**
 * A BRB LINT car: white sides with a blue stripe along the top and blue skirts below,
 * an arched blue roof with a diesel equipment box on it, and two pairs of red doors
 * per side.
 */
function makeLintCar(c: S423Car, index: number): Car {
  const c0 = c;
  const D = S423_DIM;
  const L = LINT_LIVERY;
  const g = new THREE.Group();
  const W = D.width;
  const white = mat(L.white, { roughness: 0.5 });
  const blue = mat(BRB.blue, { roughness: 0.45 });
  const dark = mat(0x34383c, { roughness: 0.7 });
  const glass = mat(0x1a2128, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const [xa, xb] = s423Body(c);
  const bodyL = xb - xa;
  const mid = (xa + xb) / 2;
  const bb = D.bodyBottom;
  // At a cab the flat sides stop where the nose's flanks begin (set back by the rounding)
  const sa = c.cabRear ? xa + D.roofRise : xa;
  const sb = c.cabFront ? xb - D.roofRise : xb;
  const sideMid = (sa + sb) / 2;

  // Body: white, with the blue top stripe laid over it, and an arched blue roof
  g.add(box(sb - sa, D.eaves - bb, W, white, sideMid, (bb + D.eaves) / 2, 0));
  const stripeMat = mat(BRB.blue, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  g.add(box(sb - sa + 0.01, D.eaves - bb - L.topStripe, W + 0.012, stripeMat, sideMid, (bb + L.topStripe + D.eaves) / 2, 0));
  const roof = new THREE.CylinderGeometry(W / 2, W / 2, bodyL, 48, 1, false, 0, Math.PI)
    .rotateZ(Math.PI / 2)
    .scale(1, D.roofRise / (W / 2), 1);
  if (c.cabFront) curveRoofEnd(roof, bodyL / 2, -1, W / 2, D.roofRise);
  if (c.cabRear) curveRoofEnd(roof, -bodyL / 2, 1, W / 2, D.roofRise);
  g.add(mesh(roof, blue, mid, D.eaves, 0));
  // A grey stripe along the middle of the roof, as wide as the windscreen (and carried
  // over the nose to it): a narrower arc of the same roof, a touch above it
  {
    const c = LINT_FRONT.screenU;
    const r0 = W / 2 + 0.006;
    const stripe = new THREE.CylinderGeometry(r0, r0, bodyL, 32, 1, true, Math.acos(c), Math.acos(-c) - Math.acos(c))
      .rotateZ(Math.PI / 2)
      .scale(1, D.roofRise / (W / 2), 1);
    if (c0.cabFront) curveRoofEnd(stripe, bodyL / 2, -1, W / 2, D.roofRise);
    if (c0.cabRear) curveRoofEnd(stripe, -bodyL / 2, 1, W / 2, D.roofRise);
    const sm = mesh(stripe, mat(LINT_ROOF_GREY, { roughness: 0.55 }), mid, D.eaves, 0);
    sm.castShadow = false;
    g.add(sm);
  }
  // Diesel equipment (engine cooling, exhaust) in a box on the roof, mid-car
  // (its top level with the roof's crown, so it adds no height: it shows only where
  // the arched roof falls away to the sides)
  const boxH = D.roofRise;
  g.add(box(Math.min(4, bodyL * 0.3), boxH, 1.8, mat(0x55595e, { roughness: 0.7 }), mid, D.eaves + D.roofRise - boxH / 2 + 0.002, 0));
  // Engine and tanks under the floor
  g.add(box(bodyL * 0.45, 0.5, W - 0.5, dark, mid, bb - 0.25, 0));
  // Blue skirt panels hanging below the body along both sides, hiding the underfloor
  // equipment; cut away round the bogies (wheels plus a little clearance)
  {
    const SKIRT_H = 0.5;
    const gaps: [number, number][] = [];
    const around = (cx: number, wheelbase: number) => gaps.push([cx - wheelbase / 2 - S423_WHEEL_R - 0.1, cx + wheelbase / 2 + S423_WHEEL_R + 0.1]);
    if (c.cabFront) around(c.len / 2 - bogieInset(c, true), 2.2);
    if (c.cabRear) around(-(c.len / 2 - bogieInset(c, false)), 2.2);
    else around(-c.len / 2, 2.7);
    if (!c.cabFront) around(c.len / 2, 2.7); // (the next car's shared bogie)
    gaps.sort((p, q) => p[0] - q[0]);
    // Spans between the bogies; an end next to a bogie is diagonal (as on the Railjet),
    // one at the body's end square
    let from = sa;
    let fromDiag = false;
    const spans: [number, number, boolean, boolean][] = [];
    for (const [g0, g1] of gaps) {
      if (g0 > from) spans.push([from, Math.min(g0, sb), fromDiag, g0 < sb]);
      if (g1 > from) [from, fromDiag] = [g1, true];
    }
    if (from < sb) spans.push([from, sb, fromDiag, false]);
    const skirtMat = mat(BRB.blue, { roughness: 0.5, side: THREE.DoubleSide });
    const slant = SKIRT_H * SKIRT.lean;
    const top = bb + 0.02; // (tucked just up behind the body's bottom edge)
    for (const [a, b, diagA, diagB] of spans) {
      if (b - a < 2 * slant + 0.3) continue;
      const shape = new THREE.Shape([
        new THREE.Vector2(a, top),
        new THREE.Vector2(b, top),
        new THREE.Vector2(b - (diagB ? slant : 0), bb - SKIRT_H),
        new THREE.Vector2(a + (diagA ? slant : 0), bb - SKIRT_H),
      ]);
      for (const side of [-1, 1]) {
        // Thin double-sided panel flush with the body side: no shadows (they'd streak)
        const m = mesh(new THREE.ShapeGeometry(shape).translate(0, 0, side * (W / 2 - 0.002)), skirtMat);
        m.castShadow = false;
        m.receiveShadow = false;
        g.add(m);
      }
    }
  }

  // Two pairs of red sliding doors per side, with tall windows
  const doors = s423Doors(c);
  const doorW = LINT_DOOR_W;
  const doorTop = bb + L.topStripe - 0.07; // (up to just under the top stripe, down nearly to the bottom)
  const doorBottom = bb - 0.25; // (continuing halfway down the skirt)
  const red = mat(L.red, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const x of doors) {
    for (const side of [-1, 1]) {
      g.add(box(doorW, doorTop - doorBottom, 0.012, red, x, (doorBottom + doorTop) / 2, side * (W / 2 + 0.012)));
      g.add(box(0.025, doorTop - doorBottom, 0.016, dark, x, (doorBottom + doorTop) / 2, side * (W / 2 + 0.016)));
      // Door windows almost the full height of the door, with the same margin top and bottom
      const paneTop = doorTop - 0.17;
      const paneBottom = doorBottom + 0.17;
      for (const dx of [-0.41, 0.41]) {
        const geo = new THREE.ShapeGeometry(roundedRect(0.5, paneTop - paneBottom, 0) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        g.add(mesh(geo, glass, x + dx, (paneTop + paneBottom) / 2, side * (W / 2 + 0.024)));
      }
    }
  }

  // Big windows in the white, from just under the top stripe, between the doors and
  // ends (up to just short of the driver's door); between the doors (the low-floor
  // part) they come down lower
  const winTop = bb + L.topStripe - 0.06;
  const winBottom = bb + LINT_WIN_BOTTOM;
  const winBottomLow = bb + 0.71;
  const [pa, pb] = s423Saloon(c);
  // Window layout, tuned to the LINT 54 (at its real length: windows ~1.71 m wide with
  // 0.34 m pillars, 0.43 m from the doors, starting ~3.2 m behind the nose tip (no
  // driver's door: a white panel for the logo) and ending ~0.84 m before the joint).
  // Each gap gets as many windows as fit best at about that width, filling it exactly.
  const WIN = { target: 1.71, pillar: 0.34, doorGap: 0.43, cabEnd: 3.2 - D.nose, jointEnd: 0.84 - D.jointGap / 2 };
  const edges = [
    c.cabRear ? xa + WIN.cabEnd : pa + WIN.jointEnd,
    ...doors.flatMap((x) => [x - doorW / 2 - WIN.doorGap, x + doorW / 2 + WIN.doorGap]),
    c.cabFront ? xb - WIN.cabEnd : pb - WIN.jointEnd,
  ];
  for (let i = 0; i < edges.length; i += 2) {
    const [a, b] = [edges[i], edges[i + 1]];
    const span = b - a;
    if (span < 0.6) continue;
    const n = Math.max(1, Math.round((span + WIN.pillar) / (WIN.target + WIN.pillar)));
    const w = (span - (n - 1) * WIN.pillar) / n;
    const bottom = doors.length > 1 && i === 2 ? winBottomLow : winBottom; // (the middle span: between the doors)
    for (let k = 0; k < n; k++) {
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(roundedRect(w, winTop - bottom, 0) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        const m = mesh(geo, glass, a + w / 2 + k * (w + WIN.pillar), (winTop + bottom) / 2, side * (W / 2 + 0.012));
        m.castShadow = false;
        g.add(m);
      }
    }
  }

  // Lettering between the door and the nose (at each cab end), in blue, centred in
  // the white strip between the skirt and the windows
  loadLetterFont()
    .then((font) => {
      const clear = doorW / 2 + 0.3;
      const spans: [number, number][] = [];
      if (c.cabFront) spans.push([doors[doors.length - 1] + clear, xb - 0.3]);
      if (c.cabRear) spans.push([xa + 0.3, doors[0] - clear]);
      const CAP = 0.26;
      const letterMat = mat(BRB.blue, { roughness: 0.5 });
      for (const [a, b] of spans) {
        const geo = letterGeometry(font, stock.lettering, { capHeight: CAP, depth: 0.004, tracking: 0.12, maxWidth: Infinity });
        if (!geo) return;
        geo.computeBoundingBox();
        const fit = (b - a) / (geo.boundingBox!.max.x - geo.boundingBox!.min.x);
        if (CAP * Math.min(1, fit) < 0.14) {
          geo.dispose();
          continue;
        }
        if (fit < 1) geo.scale(fit, fit, 1);
        const y = (bb + winBottom) / 2 - (CAP * Math.min(1, fit)) / 2;
        for (const side of [1, -1]) {
          const m = mesh(geo, letterMat, (a + b) / 2, y, side * (W / 2 + 0.014));
          m.rotation.y = side > 0 ? 0 : Math.PI;
          g.add(m);
        }
      }
    })
    .catch((err) => console.warn('LINT lettering font failed to load', err));

  const n = S423_CARS.length;
  if (c.cabFront) buildS423Nose(g, 1, c.len / 2, { frontOfTrain: index === 0, rearOfTrain: false, bogieIn: bogieInset(c, true) });
  if (c.cabRear) buildS423Nose(g, -1, c.len / 2, { frontOfTrain: false, rearOfTrain: index === n - 1, bogieIn: bogieInset(c, false) });
  return s423RunningGear(g, c, dark);
}

/**
 * A BRB FLIRT 3 car: light grey body with a blue band from just below to just above
 * the windows, one central pair of yellow doors, and a flat roof cut off at the top of
 * the grey (level with the bottom of the curve), except over the front half of a cab
 * car, where the roof curves over in blue down to the nose.
 */
function makeFlirtCar(c: S423Car, index: number): Car {
  const D = S423_DIM;
  const g = new THREE.Group();
  const W = D.width;
  const grey = mat(BRB.grey, { roughness: 0.5 });
  const blue = mat(BRB.blue, { roughness: 0.45 });
  const roofBlack = mat(0x1d1f21, { roughness: 0.7 });
  const dark = mat(0x34383c, { roughness: 0.7 });
  const glass = mat(0x1a2128, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const [xa, xb] = s423Body(c);
  const mid = (xa + xb) / 2;
  const bb = D.bodyBottom;
  const top = D.eaves; // the flat roof: level with the bottom of the curved part
  const bandMat = mat(BRB.blue, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  // Roof: curved (blue) over the half of the body towards each cab, flat elsewhere
  // (level with where the curve starts). A railcar (cabs at both ends) has the curve
  // only over each cab's stretch, stopping before its pantographs, and is flat between.
  const railcar = c.cabFront && c.cabRear;
  const curveLen = S423_CAB_BODY;
  const curved: [number, number][] = [];
  const flat: [number, number][] = [];
  /** Where each end's pantograph is measured from (1 m in): a joint, or a railcar's curve end. */
  let pantoRefA = xa;
  let pantoRefB = xb;
  if (railcar) {
    curved.push([xb - curveLen, xb], [xa, xa + curveLen]);
    flat.push([xa + curveLen, xb - curveLen]);
    pantoRefA = xa + curveLen;
    pantoRefB = xb - curveLen;
  } else if (c.cabFront) {
    curved.push([mid, xb]);
    flat.push([xa, mid]);
  } else if (c.cabRear) {
    curved.push([xa, mid]);
    flat.push([mid, xb]);
  } else flat.push([xa, xb]);
  // (at a cab the flat sides stop where the nose's flanks begin, set back by the rounding)
  const sa = c.cabRear ? xa + D.roofRise : xa;
  const sb = c.cabFront ? xb - D.roofRise : xb;
  for (const [a, b] of curved) {
    const [a1, b1] = [a === xa ? sa : a, b === xb ? sb : b];
    g.add(box(b1 - a1, D.eaves - bb, W, grey, (a1 + b1) / 2, (bb + D.eaves) / 2, 0));
    const roof = new THREE.CylinderGeometry(W / 2, W / 2, b - a, 48, 1, false, 0, Math.PI)
      .rotateZ(Math.PI / 2)
      .scale(1, D.roofRise / (W / 2), 1);
    if (c.cabFront && b === xb) curveRoofEnd(roof, (b - a) / 2, -1, W / 2, D.roofRise);
    if (c.cabRear && a === xa) curveRoofEnd(roof, -(b - a) / 2, 1, W / 2, D.roofRise);
    g.add(mesh(roof, blue, (a + b) / 2, D.eaves, 0));
  }
  for (const [a, b] of flat) {
    g.add(box(b - a, top - bb, W, grey, (a + b) / 2, (bb + top) / 2, 0));
    // Black equipment box along the middle of the flat roof: from 2 m in from a joint
    // end to 2 m from the other, or (on a cab car) to where the curved roof starts.
    // At an end with a pantograph it starts 0.25 m clear of the folded arm's reach
    // (2.65 m in), for the raised one too; on a railcar it runs between the two.
    const inset = (p: Panto) => (p ? FOLDED_PANTO_REACH + 0.25 : 2);
    const a2 = a === pantoRefA ? a + inset(c.pantoRear) : a;
    const b2 = b === pantoRefB ? b - inset(c.pantoFront) : b;
    if (b2 - a2 > 0.5) g.add(box(b2 - a2, 0.32, 1.7, roofBlack, (a2 + b2) / 2, top + 0.16, 0));
  }
  // Blue band along both sides
  for (const side of [-1, 1]) {
    g.add(box(sb - sa, FLIRT_BAND.top - FLIRT_BAND.bottom, 0.01, bandMat, (sa + sb) / 2, bb + (FLIRT_BAND.bottom + FLIRT_BAND.top) / 2, side * (W / 2 + 0.004)));
  }
  // Equipment under the floor, between the bogies
  g.add(box((xb - xa) * 0.45, 0.45, W - 0.5, dark, mid, bb - 0.225, 0));
  // Low-floor skirt: the grey side comes further down, clear of a cab's end bogie
  // (bogie centre ± half its frame, plus a margin). At a gangway it covers the shared
  // bogie's wheels, then runs diagonally up from just beyond them to the body's end,
  // leaving the bogie's centre showing, as on the drawing
  {
    const half = endWheelbase() / 2 + 0.45 + 0.35;
    const ka = c.cabRear ? -(c.len / 2 - S423_END_BOGIE) + half : xa;
    const kb = c.cabFront ? c.len / 2 - S423_END_BOGIE - half : xb;
    // Each end's outline, from its top (y1) down to its bottom (y0), as distances in from
    // the end. At a cab: the other trains' diagonal, all the way up. At a gangway: from
    // just beyond the shared bogie's wheels (wheelbase 2.7 m) the same diagonal, up to a
    // shelf over the bogie's centre, then flat out to the body's end
    const lean = SKIRT.lean;
    const shelf = RAIL_TOP + FLIRT_SKIRT_SHELF;
    const wheelEdge = 2.7 / 2 - S423_WHEEL_R - 0.08; // (from the gangway's centre)
    const endOutline = (cab: boolean, gangwayIn: number, y0: number, y1: number): [number, number][] => {
      if (cab) return [[(bb - y1) * lean, y1], [(bb - y0) * lean, y0]];
      const diag = (y: number) => gangwayIn - (y - FLIRT_SKIRT) * lean; // (gangwayIn: the bottom corner, in from the body's end)
      if (y1 <= shelf) return [[diag(y1), y1], [diag(y0), y0]];
      return [[0, y1], [0, shelf], [diag(shelf), shelf], [diag(y0), y0]];
    };
    const inA = c.cabRear ? 0 : wheelEdge - (xa + c.len / 2);
    const inB = c.cabFront ? 0 : wheelEdge - (c.len / 2 - xb);
    const outline = (y0: number, y1: number) => {
      const a = endOutline(c.cabRear, inA, y0, y1).map(([d, y]) => new THREE.Vector2(ka + d, y));
      const b = endOutline(c.cabFront, inB, y0, y1).map(([d, y]) => new THREE.Vector2(kb - d, y)).reverse();
      return new THREE.Shape([...a, ...b]);
    };
    if (kb - ka > 2 * (bb - FLIRT_SKIRT) * lean + 0.5) {
      const skirt = new THREE.ExtrudeGeometry(outline(FLIRT_SKIRT, bb + 0.01), { depth: W, bevelEnabled: false }).translate(0, 0, -W / 2);
      g.add(mesh(skirt, grey));
      // with a blue line along its bottom edge
      const line = new THREE.ShapeGeometry(outline(FLIRT_SKIRT, RAIL_TOP + FLIRT_SKIRT_LINE));
      const lineMat = mat(BRB.blue, { roughness: 0.45, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      for (const side of [-1, 1]) {
        const m = mesh(line, lineMat, 0, 0, side * (W / 2 + 0.004));
        m.castShadow = false; // (thin double-sided panel)
        g.add(m);
      }
    }
  }

  // One central pair of yellow sliding doors, with two tall windows
  const doors = s423Doors(c);
  const doorW = FLIRT_DOOR.w;
  const doorTop = RAIL_TOP + 3.25;
  const doorBottom = RAIL_TOP + FLIRT_DOOR_BOTTOM;
  const yellow = mat(BRB.yellow, { roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const doorGapMat = mat(0x34383c, { roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  for (const x of doors) {
    for (const side of [-1, 1]) {
      g.add(box(doorW, doorTop - doorBottom, 0.012, yellow, x, (doorBottom + doorTop) / 2, side * (W / 2 + 0.01)));
      // (the gap between the leaves: depth-biased ahead of the yellow, so it still shows at a distance)
      g.add(box(0.025, doorTop - doorBottom, 0.016, doorGapMat, x, (doorBottom + doorTop) / 2, side * (W / 2 + 0.014)));
      const [p0, p1] = FLIRT_DOOR.pane.map((y) => RAIL_TOP + y);
      for (const dx of [-FLIRT_DOOR.paneX, FLIRT_DOOR.paneX]) {
        const geo = new THREE.ShapeGeometry(roundedRect(FLIRT_DOOR.paneW, p1 - p0, 0.1) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        g.add(mesh(geo, glass, x + dx, (p0 + p1) / 2, side * (W / 2 + 0.022)));
      }
    }
  }

  // Windows filling the spaces either side of the door: low in the low-floor part,
  // higher between a cab and its door (where the floor rises over the end bogie)
  const [pa, pb] = s423Saloon(c);
  // (at a cab they start over the middle of the end bogie's rear wheel, as on the drawing)
  const CAB_WIN_END = S423_END_BOGIE + endWheelbase() / 2 - D.nose; // (from the body's end, where the nose begins)
  const edges = [c.cabRear ? xa + CAB_WIN_END : pa + FLIRT_WIN.jointEnd, ...doors.flatMap((x) => [x - doorW / 2 - FLIRT_WIN.doorGap, x + doorW / 2 + FLIRT_WIN.doorGap]), c.cabFront ? xb - CAB_WIN_END : pb - FLIRT_WIN.jointEnd];
  for (let i = 0; i < edges.length; i += 2) {
    const [a, b] = [edges[i], edges[i + 1]];
    const span = b - a;
    if (span < 0.6) continue;
    // (as many windows of about the drawing's width as fit, with its pillars between)
    const P = FLIRT_WIN.pillar;
    const n = Math.max(1, Math.round((span + P) / (FLIRT_WIN.w + P)));
    const ww = (span - (n - 1) * P) / n;
    const cabSide = (i === 0 && c.cabRear) || (i === edges.length - 2 && c.cabFront);
    const [y0, y1] = (cabSide ? FLIRT_WIN.high : FLIRT_WIN.low).map((y) => RAIL_TOP + y);
    const winY = (y0 + y1) / 2;
    const winH = y1 - y0;
    for (let k = 0; k < n; k++) {
      for (const side of [-1, 1]) {
        const geo = new THREE.ShapeGeometry(roundedRect(ww, winH, 0.08) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        const m = mesh(geo, glass, a + ww / 2 + k * (ww + P), winY, side * (W / 2 + 0.012));
        m.castShadow = false;
        g.add(m);
      }
    }
  }

  // Lettering either side of the door (where there's room), in blue on the grey
  // below the band; left off where it would have to shrink too far
  loadLetterFont()
    .then((font) => {
      const clear = doorW / 2 + 0.3;
      const CAP = 0.26;
      const letterMat = mat(BRB.blue, { roughness: 0.5 });
      for (const [a, b] of [[pa + 0.3, doors[0] - clear], [doors[0] + clear, pb - 0.3]]) {
        const geo = letterGeometry(font, stock.lettering, { capHeight: CAP, depth: 0.004, tracking: 0.12, maxWidth: Infinity });
        if (!geo) return;
        geo.computeBoundingBox();
        const fit = (b - a) / (geo.boundingBox!.max.x - geo.boundingBox!.min.x);
        if (CAP * Math.min(1, fit) < 0.14) {
          geo.dispose();
          continue;
        }
        if (fit < 1) geo.scale(fit, fit, 1);
        const y = bb + FLIRT_BAND.bottom / 2 - (CAP * Math.min(1, fit)) / 2; // (centred between the top of the wheel arch and the band)
        for (const side of [1, -1]) {
          const m = mesh(geo, letterMat, (a + b) / 2, y, side * (W / 2 + 0.014));
          m.rotation.y = side > 0 ? 0 : Math.PI;
          g.add(m);
        }
      }
    })
    .catch((err) => console.warn('FLIRT lettering font failed to load', err));

  // Cabs and pantographs (raised at the front of the second car, folded at the rear of the second-last)
  const n = S423_CARS.length;
  if (c.cabFront) buildS423Nose(g, 1, c.len / 2, { frontOfTrain: index === 0, rearOfTrain: false });
  if (c.cabRear) buildS423Nose(g, -1, c.len / 2, { frontOfTrain: false, rearOfTrain: index === n - 1 });
  if (c.pantoFront) addS423Pantograph(g, pantoRefB - 1.0, -1, true, c.cabFront && !railcar ? undefined : top);
  if (c.pantoRear) addS423Pantograph(g, pantoRefA + 1.0, 1, false, c.cabRear && !railcar ? undefined : top);

  return s423RunningGear(g, c, dark);
}

/**
 * A 423 cab end (dir +1 front, −1 rear; face at dir·xFace): an upright lower front,
 * a big raked windscreen in a light grey surround, rounded corners, the grey band
 * carried round, a DB emblem below the windscreen, headlights and tail lights,
 * an automatic coupler and a snowplough.
 */
/**
 * Returns, for the Allegra, how far its windscreen's border (carried on up into the
 * roof) cuts back into the roof's arch at each z across, behind the nose's end;
 * otherwise null.
 */
function buildS423Nose(g: THREE.Group, dir: number, xFace: number, o: { frontOfTrain: boolean; rearOfTrain: boolean; bogieIn?: number }): ((z: number) => number) | null {
  const D = S423_DIM;
  const W = D.width;
  const bb = D.bodyBottom;
  // (FLIRT: light grey below the blue band, blue from the band up over the top)
  // (LINT: the rounded front all blue; the flat flanks white with the top stripe)
  // (Desiro ML: white, with a red lower front and the side bands carried along the flanks)
  const red = FLIRT ? mat(BRB.grey, { roughness: 0.5 }) : LINT ? mat(BRB.blue, { roughness: 0.45 }) : DESIRO_LOOK ? mat(DESIRO_L.white, { roughness: 0.45 }) : mat(DB_RED, { roughness: 0.45 });
  const grey = mat(0xc9cdd0, { roughness: 0.5 });
  const dark = mat(0x2a2e31, { roughness: 0.8 });
  const glass = mat(0x2a333c, { roughness: 0.12, metalness: 0.4 });
  const xF = dir * xFace;
  const xR = dir * (xFace - D.nose); // where the nose meets the body
  const rise = D.roofRise;
  const pr = noseRound(); // (the corners' rounding in plan)
  // (Allegra) The nose narrows in plan towards the front: full width as far forward as
  // the driver's door (so it stands on the flat side), then curving in to NOSE_TAPER
  // narrower at the tip
  // (the Allegra's plan is a semi-ellipse at each height instead: see surf)
  const taper = 0;
  const ellipse = ALLEGRA;
  const taperLen = ALLEGRA && DESIRO_L.cabDoor ? DESIRO_L.cabDoor.centre - DESIRO_L.cabDoor.w / 2 : D.nose; // (from the door's front edge)
  // (as on the drawing seen from the front: the windscreen ~55% of the train's width at
  // its foot and ~78% at its top, as the nose curves in towards its tip; lower down,
  // further forward, narrower still)
  const taperAt = (x: number, y: number) => {
    // (curving in: tangent to the side wall at the door, rounding over its first tenth
    // and then turning in steadily to the tip)
    const a = THREE.MathUtils.clamp(1 - ((xF - x) * dir) / taperLen, 0, 1);
    const r = 0.1;
    const along = a < r ? (a * a) / (2 * r) : a - r / 2;
    // (the same at every height: the corners carry on curving in right down to the foot)
    void y;
    return 1 - taper * along;
  };
  /** Narrows a geometry built at full width (z across, in place) to follow the taper. */
  const narrow = <G extends THREE.BufferGeometry>(geo: G): G => {
    if (!taper) return geo;
    const ps = geo.attributes.position;
    for (let i = 0; i < ps.count; i++) ps.setZ(i, ps.getZ(i) * taperAt(ps.getX(i), ps.getY(i)));
    ps.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  };
  // (Desiro ML: the cab's roof stands above the flat roof behind it)
  const eavesN = D.eaves + (DESIRO_LOOK ? DESIRO_L.cabRaise : 0);
  // The 423's profile, scaled to the body: the FLIRT's is the same shape and gradient
  const k = D.nose / 1.5;
  // (Allegra: leaning back a little from the foot, then curving back more and more into
  // the roof above the door)
  const curve = ALLEGRA
    ? new THREE.CubicBezierCurve(
        new THREE.Vector2(xF, bb),
        new THREE.Vector2(xF - dir * 0.15 * D.nose, bb + 0.55 * (eavesN - bb)),
        new THREE.Vector2(xF - dir * 0.88 * D.nose, eavesN - 0.01),
        new THREE.Vector2(xR, eavesN),
      )
    : new THREE.CubicBezierCurve(
        new THREE.Vector2(xF, bb),
        new THREE.Vector2(xF - dir * 0.12 * k, bb + (1.5 * (eavesN - bb)) / 2.45),
        new THREE.Vector2(xF - dir * 0.95 * k, eavesN - 0.02),
        new THREE.Vector2(xR, eavesN),
      );
  // Side profile extruded across the width (set back by the corner rounding)
  // (its back edge is where the body's flat sides end: set back by the rounding, so
  // the body's top corner doesn't stick out past the nose's set-back top)
  const profile = new THREE.Shape();
  profile.moveTo(xR - dir * pr, bb);
  for (const p of curve.getPoints(24)) profile.lineTo(p.x - dir * pr, p.y);
  profile.closePath();
  // (the flat flanks: white on the LINT, whose blue is the rounded front and a top stripe)
  // (tapered: built as upright strips, one every few cm along, with one at the taper's
  // start, so the narrowing is exact top to bottom rather than spread across big triangles)
  const flankMat = LINT ? mat(LINT_LIVERY.white, { roughness: 0.5 }) : red;
  // (none on the Allegra: its rounded front runs right back to the door)
  if (!taper && !ellipse) g.add(mesh(new THREE.ExtrudeGeometry(profile, { depth: W, bevelEnabled: false, steps: 1 }).translate(0, 0, -W / 2), flankMat));
  // The profile's top edge (the curve, set back by the rounding): its height at x
  const edgePts = curve.getPoints(200).map((p) => new THREE.Vector2(p.x - dir * pr, p.y));
  const curveYAt = (x: number) => {
    for (let i = 1; i < edgePts.length; i++) {
      const [a, b] = [edgePts[i - 1], edgePts[i]];
      if ((x - a.x) * (x - b.x) <= 0 && a.x !== b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
    return eavesN;
  };
  /** Both flanks' strip between heights lo and hi(x), from the nose's back to its front, tapered. */
  const flankStrips = (lo: number, hi: number, out: number, material: THREE.Material) => {
    const x0 = xR - dir * pr;
    const x1 = xF - dir * pr;
    const kink = xF - dir * taperLen;
    const xs = [...new Set([...Array.from({ length: 61 }, (_, i) => x0 + ((x1 - x0) * i) / 60), kink])].sort((a, b) => (a - b) * dir);
    for (const side of [-1, 1]) {
      const pos: number[] = [];
      const idx: number[] = [];
      let n = 0;
      for (const x of xs) {
        const top = Math.min(hi, curveYAt(x));
        if (top <= lo) continue;
        const zl = side * (W / 2 + out) * taperAt(x, lo);
        const zt = side * (W / 2 + out) * taperAt(x, top);
        pos.push(x, lo, zl, x, top, zt);
        if (n) idx.push(2 * n - 2, 2 * n, 2 * n - 1, 2 * n - 1, 2 * n, 2 * n + 1);
        n++;
      }
      if (n < 2) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const m = mesh(geo, material);
      m.castShadow = !out;
      g.add(m);
    }
  };
  if (taper) flankStrips(bb, eavesN + 1, 0, new THREE.MeshStandardMaterial({ color: (flankMat as THREE.MeshStandardMaterial).color, roughness: 0.5, side: THREE.DoubleSide }));
  // Side stripes carried on along the nose's flanks (the flat part of its sides):
  // the side profile clipped to the stripe's heights, laid just outside both flanks
  const flankStripe = (y0: number, y1: number, color: number) => {
    let poly = [new THREE.Vector2(xR - dir * pr, bb), ...curve.getPoints(48).map((p) => new THREE.Vector2(p.x - dir * pr, p.y))];
    const clip = (pts: THREE.Vector2[], keep: (p: THREE.Vector2) => boolean, y: number) => {
      const out: THREE.Vector2[] = [];
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        if (keep(a)) out.push(a);
        if (keep(a) !== keep(b)) out.push(new THREE.Vector2(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y));
      });
      return out;
    };
    const m0 = mat(color, { roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    if (taper) return flankStrips(y0, y1, 0.004, m0);
    if (ellipse) return;
    poly = clip(poly, (p) => p.y >= y0, y0);
    poly = clip(poly, (p) => p.y <= y1, y1);
    if (poly.length < 3) return;
    const geo = new THREE.ShapeGeometry(new THREE.Shape(poly));
    for (const side of [-1, 1]) {
      const m = mesh(narrow(geo.clone().translate(0, 0, side * (W / 2 + 0.004))), m0);
      m.castShadow = false;
      g.add(m);
    }
  };
  if (FLIRT) flankStripe(bb + FLIRT_BAND.bottom, bb + FLIRT_BAND.top, BRB.blue);
  else if (DESIRO_LOOK) {
    const L = DESIRO_L;
    flankStripe(RAIL_TOP + L.orangeTop, RAIL_TOP + L.redTop, L.red);
    flankStripe(RAIL_TOP + L.orangeBottom, RAIL_TOP + L.orangeTop, L.orange);
    flankStripe(RAIL_TOP + L.blackTop, RAIL_TOP + L.orangeBottom, L.red);
    if (RAIL_TOP + L.blackTop - bb > 0.005) flankStripe(bb, RAIL_TOP + L.blackTop, L.black);
  } else if (LINT) {
    flankStripe(bb + LINT_LIVERY.topStripe, D.eaves, BRB.blue); // (the top stripe carried on along the white flanks)
  } else {
    flankStripe(bb, bb + S423_STRIPES.dark, S423_STRIPES.colorDark);
    flankStripe(bb + S423_STRIPES.dark, bb + S423_STRIPES.silver, 0xc9cdd0);
    flankStripe(bb + S423_TOP_STRIPE.top - S423_TOP_STRIPE.h, bb + S423_TOP_STRIPE.top, 0xc9cdd0);
  }
  // Rounded surface: continues the roof's arch across, and rounds the corners in plan
  const H0 = eavesN - bb;
  const surf = (t: number, u: number) => {
    const p = curve.getPoint(t);
    const hu = H0 + rise * Math.sqrt(Math.max(0, 1 - u * u));
    // (Allegra: in plan, at each height, a semi-ellipse from the door's front edge (its
    // flank there, at full width) round to the nose's front at that height)
    const x = ellipse ? p.x - dir * Math.max(0, (p.x - xR) * dir) * archRound(u) : p.x - dir * pr * archRound(u);
    const yy = bb + ((p.y - bb) * hu) / H0;
    return new THREE.Vector3(x, yy, ((u * W) / 2) * taperAt(x, yy));
  };
  const normal = (t: number, u: number) => {
    const e = 1e-3;
    const dt = surf(Math.min(1, t + e), u).sub(surf(Math.max(0, t - e), u));
    const du = surf(t, Math.min(1, u + e)).sub(surf(t, Math.max(-1, u - e)));
    const nrm = dt.cross(du).normalize();
    if (nrm.x * dir + nrm.y < 0) nrm.negate();
    return nrm;
  };
  const tAtY = (u: number, y: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      if (surf(m, u).y < y) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const patch = (t0: (u: number) => number, t1: (u: number) => number, u0: number, u1: number, out: number, material: THREE.Material) => {
    const nt = 24;
    const nu = 24;
    const th0 = Math.acos(THREE.MathUtils.clamp(u0, -1, 1));
    const th1 = Math.acos(THREE.MathUtils.clamp(u1, -1, 1));
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= nt; i++) {
      for (let j = 0; j <= nu; j++) {
        const u = Math.cos(th0 + ((th1 - th0) * j) / nu);
        const tb = t0(u);
        const t = tb + ((t1(u) - tb) * i) / nt;
        const p = surf(t, u).addScaledVector(normal(t, u), out);
        pos.push(p.x, p.y, p.z);
        if (i > 0 && j > 0) {
          const a = (i - 1) * (nu + 1) + (j - 1);
          idx.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m0 = material as THREE.MeshStandardMaterial;
    const m = mesh(geo, new THREE.MeshStandardMaterial({ color: m0.color, roughness: m0.roughness, metalness: m0.metalness, emissive: m0.emissive, side: THREE.DoubleSide }));
    m.castShadow = false;
    g.add(m);
  };

  /**
   * (Allegra) The windscreen set into the nose. Its border's bottom (plane yB) is level;
   * its sides are the nose cut by two sloping planes, each through a point A on the nose
   * at yB (the two 50% of the train's width apart) and the lengthwise line where the roof
   * turns from red to grey. Between its sides the border runs straight across at every
   * height, from G-G' (0.17 m down the edge curve below A) right up to the roof's arch
   * (the nose in front of it cut away), red below A-A'; at G-G' a flat shelf fills
   * between it and the nose's curve. f(y): the planes' half-width at
   * height y.
   */
  const allegraWindscreenFrame = () => {
    const L = DESIRO_L;
    const yB = RAIL_TOP + L.win[0] - 0.05;
    const yT = RAIL_TOP + L.win[1] + 0.05;
    const yg = RAIL_TOP + ALLEGRA_GREY_FROM;
    const zA = 0.25 * W;
    const zg = (W / 2) * Math.sqrt(Math.max(0, 1 - ((yg - D.eaves) / D.roofRise) ** 2));
    const f = (y: number) => zA + ((zg - zA) * (y - yB)) / (yg - yB);
    const uAt = (y: number) => Math.min(0.999, f(y) / (W / 2));
    const onN = (u: number, y: number) => surf(tAtY(u, y), u);
    const X0 = (y: number) => onN(uAt(y), y).x;
    // (above the grey line the edge has left the nose, so the border's curve is carried on
    // up by itself: X continued past yg with the slope and curvature it has there, a
    // parabola fitted through three points just below)
    const [q1, q2, q3] = [yg - 0.25, yg - 0.15, yg - 0.05].map((yy) => X0(yy));
    const s2 = (q3 - 2 * q2 + q1) / 0.01;
    const s1 = (q3 - q1) / 0.2 + s2 * 0.1; // (the slope at yg − 0.05)
    const X = (y: number) => (y <= yg - 0.05 ? X0(y) : q3 + s1 * (y - yg + 0.05) + 0.5 * s2 * (y - yg + 0.05) ** 2);
    // (G: the edge curve AB carried on down below A, 0.17 m (half of 0.34) along it; the
    // border reaches down to G-G', with the level shelf there)
    let yG = yB;
    for (let arc = 0, prev = onN(uAt(yB), yB); arc < 0.17; ) {
      yG -= 0.001;
      const q = onN(uAt(yG), yG);
      arc += q.distanceTo(prev);
      prev = q;
    }
    return { yB, yT, yg, yG, f, uAt, onN, X };
  };
  type Frame = ReturnType<typeof allegraWindscreenFrame>;
  /**
   * (Allegra) Construction points, per side (u < 0, then u > 0): the curve CD is every
   * point 0.34 m along the nose's surface from the windscreen's side edge AB, square to it
   * and away from the middle (C from A, D from B); E and F on it at the heights of the
   * windscreen's border's top and bottom (the passenger windows' borders'). The cab's side
   * window's front edge runs along it.
   */
  const allegraCDEF = (AWf: Frame) => {
    const { yB, yT, uAt, onN } = AWf;
    const walk = (u0: number, y0: number, dA: THREE.Vector3, sgn: number, dist: number) => {
      let u = u0;
      let t = tAtY(u0, y0);
      const ds = 0.002;
      const e = 1e-4;
      for (let k = 0; k < Math.round(dist / ds); k++) {
        const St = surf(Math.min(1, t + e), u).sub(surf(Math.max(0, t - e), u)).divideScalar(Math.min(1, t + e) - Math.max(0, t - e));
        const Su = surf(t, Math.min(1, u + e)).sub(surf(t, Math.max(-1, u - e))).divideScalar(Math.min(1, u + e) - Math.max(-1, u - e));
        const n = St.clone().cross(Su).normalize();
        const v = n.clone().cross(dA).normalize();
        if (v.z * sgn < 0) v.negate();
        // (the step in (t, u): least squares of St dt + Su du = v ds)
        const a11 = St.dot(St), a12 = St.dot(Su), a22 = Su.dot(Su);
        const b1 = St.dot(v) * ds, b2 = Su.dot(v) * ds;
        const det = a11 * a22 - a12 * a12;
        t = THREE.MathUtils.clamp(t + (a22 * b1 - a12 * b2) / det, 0, 1);
        u = THREE.MathUtils.clamp(u + (a11 * b2 - a12 * b1) / det, -1, 1);
      }
      return surf(t, u);
    };
    return [-1, 1].map((sgn) => {
      const A = onN(sgn * uAt(yB), yB);
      const B = onN(sgn * uAt(yT), yT);
            // (the edge AB is the windscreen's side on the nose, carried on past A and B; from
      // each point on it, 0.34 m along the surface square to it: the curve CD)
      const Q = (yy: number) => onN(sgn * uAt(yy), yy);
      const off = (yy: number) => walk(sgn * uAt(yy), yy, Q(yy + 0.01).sub(Q(yy - 0.01)).normalize(), sgn, 0.34);
      const C = off(yB);
      const D = off(yT);
      const curve: THREE.Vector3[] = [];
      for (let i = 0; i <= 48; i++) curve.push(off(yB - 0.4 + ((yT - yB + 0.8) * i) / 48));
      const at = (yy: number) => {
        for (let k = 1; k < curve.length; k++) {
          const a = curve[k - 1];
          const b = curve[k];
          if ((a.y - yy) * (b.y - yy) <= 0 && a.y !== b.y) return a.clone().lerp(b, (yy - a.y) / (b.y - a.y));
        }
        return (yy < curve[0].y ? curve[0] : curve[curve.length - 1]).clone();
      };
      return { sgn, A, B, C, D, E: at(yT), F: at(yB), at };
    });
  };
  const dbl = (m: THREE.Material) => {
    const s0 = m as THREE.MeshStandardMaterial;
    return new THREE.MeshStandardMaterial({ color: s0.color, roughness: s0.roughness, metalness: s0.metalness, side: THREE.DoubleSide });
  };
  const gridMesh = (rows: number, cols: number, at: (i: number, j: number) => THREE.Vector3, m: THREE.Material) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const q = at(i / rows, j / cols);
        pos.push(q.x, q.y, q.z);
        if (i && j) {
          const a = (i - 1) * (cols + 1) + j - 1;
          idx.push(a, a + 1, a + cols + 1, a + 1, a + cols + 2, a + cols + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mm = mesh(geo, dbl(m));
    mm.castShadow = false;
    g.add(mm);
  };
  /** The nose's own surface between heights y0 and y1, from u = lo(y) to hi(y). */
  const noseBand = (y0: number, y1: number, lo: (y: number) => number, hi: (y: number) => number, m: THREE.Material, AWf: Frame) =>
    gridMesh(24, 24, (a, b) => {
      const y = y0 + (y1 - y0) * a;
      const u = lo(y) + (hi(y) - lo(y)) * b;
      return AWf.onN(u, y);
    }, m);
  const allegraNoseBase = (AWf: Frame) => {
    const { yG, yg, uAt } = AWf;
    patch(() => 0, (u) => tAtY(u, yG), -1, 1, 0, red); // (below the windscreen's G-G')
    noseBand(yG, yg, uAt, () => 1, red, AWf); // (beside it: the pillars and on round)
    noseBand(yG, yg, () => -1, (y) => -uAt(y), red, AWf);
    // (nothing above yg: the planes there are wider than the arch, so the border runs up to the roof)
  };
  const allegraWindscreen = (AWf: Frame) => {
    const { yB, yT, yg, yG, f, uAt, onN, X } = AWf;
    const L = DESIRO_L;
    const black = mat(L.black, { roughness: 0.4 });
    // the border: straight across at every height, between the sides, and carried on up
    // past the windscreen's top until it meets the top of the train (the roof's arch; the
    // nose in front of it cut away), the sloping planes bounding it all the way: column by
    // column across, from yB (or, outside A, from the plane) up to the arch
    const zgA = f(yg);
    const archTop = (z: number) => surf(1, THREE.MathUtils.clamp(z / (W / 2), -0.999, 0.999)).y;
    const lowAt = (z: number) => Math.max(yB, yB + ((Math.abs(z) - f(yB)) * (yg - yB)) / (zgA - f(yB)));
    // (black up to the grey line, yg; above it, the part that runs on up into the roof's
    // arch, the roof's light grey)
    gridMesh(40, 48, (a, b) => {
      const z = (2 * b - 1) * zgA * 0.999;
      const y = lowAt(z) + (Math.min(yg, archTop(z)) - lowAt(z)) * a;
      return new THREE.Vector3(X(y), y, z);
    }, black);
    gridMesh(24, 48, (a, b) => {
      const z = (2 * b - 1) * zgA * 0.999;
      const y0 = Math.min(yg, archTop(z));
      const y = y0 + (archTop(z) - y0) * a;
      return new THREE.Vector3(X(y), y, z);
    }, mat(L.roof, { roughness: 0.55 }));
    // the glass inside it, at the same offset as before
    gridMesh(20, 8, (a, b) => {
      const y = yB + 0.05 + (yT - yB - 0.1) * a;
      return new THREE.Vector3(X(y) + dir * 0.006, y, (2 * b - 1) * (f(y) - 0.05));
    }, glass);
    // the shelf at the bottom (red): flat, between the
    // straight edge and the nose's curve
    // below the border, down to G-G': red, straight across at every height in the same
    // way (the nose in front of it cut away)
    gridMesh(12, 24, (a, b) => {
      const y = yG + (yB - yG) * a;
      return new THREE.Vector3(X(y), y, (2 * b - 1) * f(y));
    }, red);
    for (const [y, m0] of [[yG, red]] as const) {
      const ua = uAt(y);
      gridMesh(1, 24, (a, b) => {
        const u = -ua + 2 * ua * b;
        const n = onN(u, y);
        return a ? n : new THREE.Vector3(X(y), y, n.z);
      }, m0);
    }
  };

  // (Allegra: the windscreen is set into the nose, so the nose's face is left open in
  // front of it: see allegraWindscreen)
  const AW = ellipse ? allegraWindscreenFrame() : null;
  if (!AW) patch(() => 0, () => 1, -1, 1, 0, red);
  else allegraNoseBase(AW);
  const panelY = FLIRT ? RAIL_TOP + FLIRT_WIN.driver[0] : DESIRO_LOOK ? RAIL_TOP + DESIRO_L.screenBottom : bb + (LINT ? 1.4 : 1.09); // (FLIRT: the windscreen's bottom, level with the driver's door window's)
  // (LINT) The dividing line: a plane, level across the train, through the cab side
  // windows' bottom edges, which run diagonally from the back corner (level with the
  // passenger windows' bottoms) down to the nose's edge at LINT_FRONT.line. Round the
  // front it curves, dipping lower in the middle where the nose reaches further forward.
  const winY0 = bb + LINT_WIN_BOTTOM;
  const winY1 = bb + LINT_LIVERY.topStripe - 0.06;
  const edgeX = (y: number) => curve.getPoint(tAtY(1, y)).x - dir * pr;
  const winBackX = edgeX(winY1) - dir * 0.12;
  const lineLowY = bb + LINT_FRONT.line;
  const lineLowX = edgeX(lineLowY);
  const lineY = (x: number) => winY0 + ((lineLowY - winY0) * (x - winBackX)) / (lineLowX - winBackX);
  /** Where the dividing line crosses the nose surface at u. */
  const tLine = (u: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 30; k++) {
      const m = (lo + hi) / 2;
      const p = surf(m, u);
      if (p.y < lineY(p.x)) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  if (LINT) {
    // Blue above the dividing line (LINT_FRONT.line) with the windscreen; below it white at the outer corners and black in the middle, under the
    // windscreen (that black carries on down the skirt)
    const F = LINT_FRONT;
    // Its top edge: a plane through the cab side windows' front top corners, square to
    // the nose's slope there (seen from the side, a line at right angles to the front)
    const t0 = tAtY(1, winY1);
    const tan = curve.getTangent(t0);
    const P0 = new THREE.Vector2(edgeX(winY1) - dir * 0.12, winY1);
    const screenTop = (u: number) => {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 30; k++) {
        const m = (lo + hi) / 2;
        const p = surf(m, u);
        if ((p.x - P0.x) * tan.x + (p.y - P0.y) * tan.y < 0) lo = m;
        else hi = m;
      }
      return (lo + hi) / 2;
    };
    patch((u) => tAtY(u, bb + LINT_FRONT.screenBottom), screenTop, -F.screenU, F.screenU, 0.012, glass);
    patch(screenTop, () => 1, -F.screenU, F.screenU, 0.008, mat(LINT_ROOF_GREY, { roughness: 0.55 })); // (the roof's grey stripe, down to the windscreen)
    const below = tLine;
    const whiteMat = mat(LINT_LIVERY.white, { roughness: 0.5 });
    patch(() => 0, below, -1, -F.blackU, 0.006, whiteMat);
    patch(() => 0, below, F.blackU, 1, 0.006, whiteMat);
    patch(() => 0, below, -F.blackU, F.blackU, 0.006, mat(0x141517, { roughness: 0.6 }));
    // Above the line, up to the windscreen: white in the centre (the lights and logo
    // go on it), blue at the edges
    patch(below, (u) => tAtY(u, bb + LINT_FRONT.screenBottom), -F.whiteU, F.whiteU, 0.006, whiteMat);
  } else if (DESIRO_LOOK) {
    // Red lower front, level with the side bands' top all the way round; the black
    // band along the bottom; a big black windscreen surround with the glass in it
    const L = DESIRO_L;
    // (not on the Allegra, whose nose is red already and open where its windscreen is set in)
    if (!AW) patch(() => 0, (u) => tAtY(u, RAIL_TOP + L.redTop), -1, 1, 0.006, mat(L.red, { roughness: 0.45 }));
    if (RAIL_TOP + L.blackTop - bb > 0.005) patch(() => 0, (u) => tAtY(u, RAIL_TOP + L.blackTop), -1, 1, 0.009, mat(L.black, { roughness: 0.5 }));
    // (the surround carried on up over the top and back along the raised cab roof)
    // (double-decker: as wide as the roof's dark stripe, which it runs into: out to where
    // the arch reaches the flat ends' height)
    const kd = L.deck ? (RAIL_TOP + L.deck.endTop - D.eaves) / D.roofRise : 0;
    const uSurround = L.deck ? Math.sqrt(Math.max(0, 1 - kd * kd)) : 0.86;
    if (L.cabDoor) {
      // (Allegra) the windscreen as tall as the passenger windows and level with them, in a
      // black border
      const [w0, w1] = L.win.map((h) => RAIL_TOP + h);
      void w0;
      void uSurround;
      allegraWindscreen(AW!);
      // a headlight high in the middle, on the border above the windscreen
      {
        const ly = (w1 + RAIL_TOP + ALLEGRA_GREY_FROM) / 2 + 0.02;
        const slope = (AW!.X(ly + 0.01) - AW!.X(ly - 0.01)) / 0.02;
        const n = new THREE.Vector3(1, -slope, 0).normalize().multiplyScalar(dir);
        if (n.x * dir < 0) n.negate();
        lampOn(g, new THREE.Vector3(AW!.X(ly), ly, 0).addScaledVector(n, -0.007), n, 0.1, // (its back just into the face: the face is flat across, so lampOn's 3 cm lift for curved noses would leave it floating)
           lampMaterial('white', o.frontOfTrain));
      }
      // (and the thin light line along the bottom of the sides carried right round the front)
      patch((u) => tAtY(u, RAIL_TOP + L.orangeBottom), (u) => tAtY(u, RAIL_TOP + L.orangeTop), -1, 1, 0.012, mat(L.orange, { roughness: 0.5 }));
    } else {
      patch((u) => tAtY(u, panelY), () => 1, -uSurround, uSurround, 0.01, mat(L.black, { roughness: 0.4 }));
      patch((u) => tAtY(u, panelY + 0.08), () => 0.83, -(uSurround - 0.06), uSurround - 0.06, 0.016, glass);
    }
  } else if (FLIRT) {
    // Blue from the band up and over the top; a big wraparound windscreen
    patch((u) => tAtY(u, bb + FLIRT_NOSE_BLUE), () => 1, -1, 1, 0.006, mat(BRB.blue, { roughness: 0.45 }));
    patch((u) => tAtY(u, panelY), () => 0.9, -0.84, 0.84, 0.012, glass);
  } else {
    // Grey band carried round the nose
    patch((u) => tAtY(u, bb), (u) => tAtY(u, bb + S423_STRIPES.dark), -1, 1, 0.006, mat(S423_STRIPES.colorDark, { roughness: 0.6 }));
    patch((u) => tAtY(u, bb + S423_STRIPES.dark), (u) => tAtY(u, bb + S423_STRIPES.silver), -1, 1, 0.006, grey);
    // Front panel: a tall dark grey panel from the roof edge down to just above the
    // headlights, with only narrow red strips beside it; the windscreen fills its
    // upper part
    const glassY = bb + 1.74;
    patch((u) => tAtY(u, panelY), () => 0.955, -0.8, 0.8, 0.01, mat(0x5a6066, { roughness: 0.5 }));
    patch((u) => tAtY(u, glassY), () => 0.875, -0.74, 0.74, 0.016, glass);
    patch(() => 0.955, () => 1, -S423_ROOF_STRIPE_U, S423_ROOF_STRIPE_U, 0.01, mat(S423_STRIPES.colorDark, { roughness: 0.6 })); // (the roof's dark grey stripe, down to the panel)
  }
  // Driver's door in the body just behind the nose: a red hinged door outlined by
  // its seams, with a window in the top half and (FLIRT) a grab handle either side (the LINT has none)
  if (!LINT && !DESIRO_LOOK) {
    // (the door as wide as one leaf of the passenger doors, its window as wide as theirs)
    const dw = FLIRT ? FLIRT_DRIVER_DOOR.w : S423_DOOR.w / 2;
    const winW = S423_DOOR.paneW;
    // (423: 1.8 m behind the nose tip; FLIRT: 2.56 m, just behind where the nose meets the roof)
    const dx = FLIRT ? xF - dir * FLIRT_DRIVER_DOOR.centre : xF - dir * S423_LAYOUT.cabDoorX;
    const y0 = bb + (FLIRT ? 0.06 : LINT ? 0.06 : S423_LAYOUT.cabDoorBottom);
    // (423: the door's top at the grey stripe's top, its window's top at the stripe's bottom)
    const y1 = FLIRT ? D.eaves - 0.12 : bb + S423_TOP_STRIPE.top;
    const winTop = FLIRT ? RAIL_TOP + FLIRT_WIN.driver[1] : y1 - S423_TOP_STRIPE.h;
    const seam = mat(FLIRT || LINT ? 0x10284f : 0x3a0a0e, { roughness: 0.8 });
    const doorGlass = mat(0x2a333c, { roughness: 0.12, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 0.01);
      // (423: the grey stripe across its top is the door's top edge, so the seams stop under it)
      const ys = FLIRT ? y1 : y1 - S423_TOP_STRIPE.h;
      if (FLIRT) g.add(box(dw + 0.03, 0.03, 0.006, seam, dx, y1, z));
      g.add(box(dw + 0.03, 0.03, 0.006, seam, dx, y0, z));
      for (const e of [-1, 1]) g.add(box(0.03, ys - y0, 0.006, seam, dx + (e * dw) / 2, (y0 + ys) / 2, z));
      // (423: its bottom halfway up the passenger windows; FLIRT: as on the drawing)
      const winH = winTop - (FLIRT ? RAIL_TOP + FLIRT_WIN.driver[0] : bb + S423_WIN.centre);
      const geo = new THREE.ShapeGeometry(roundedRect(winW, winH, 0.08) as THREE.Shape, 6);
      if (side < 0) geo.rotateY(Math.PI);
      // (depth-biased and clear of the FLIRT's blue band, so it doesn't flicker against it)
      const m = mesh(geo, doorGlass, dx, winTop - winH / 2, side * (W / 2 + 0.02));
      m.castShadow = false;
      g.add(m);
      // (FLIRT: a grab handle either side of it)
      if (FLIRT) for (const e of [-1, 1]) g.add(box(0.04, 0.5, 0.05, mat(0xb0b4b8, { metalness: 0.6, roughness: 0.4 }), dx + e * (dw / 2 + 0.08), bb + 0.85, side * (W / 2 + 0.03)));
    }
  }
  // DB emblem in the middle below the windscreen
  // (centred in the red band between the silver stripe and the front panel)
  // (FLIRT: the locos' framed emblem, on the blue between the band's bottom and the windscreen)
  const bandMid = bb + ((FLIRT ? FLIRT_NOSE_BLUE : LINT ? 0 : S423_STRIPES.silver) + (panelY - bb)) / 2;
  // (LINT: centred on the white panel's height there, between the curved line and the windscreen)
  const lintPanelMid = (u: number) => (surf(tLine(u), u).y + bb + LINT_FRONT.screenBottom) / 2;
  // (LINT: on the white panel between the dividing line and the windscreen)
  const te = tAtY(0, LINT ? lintPanelMid(0.56) : bandMid); // (LINT: level with the headlights)
  if (DESIRO_LOOK) {
    // The logo between the headlights, in the locos' framed style, white on the red
    const tl = tAtY(0, RAIL_TOP + DESIRO_L.lamps);
    addEmblemAt(g, surf(tl, 0).addScaledVector(normal(tl, 0), 0.01), normal(tl, 0), 0.45);
  } else if (FLIRT) addEmblemAt(g, surf(te, 0).addScaledVector(normal(te, 0), 0.01), normal(te, 0), 0.8 * (panelY - bb - FLIRT_NOSE_BLUE)); // the framed emblem, as on the locos (filling 80% of the blue's height)
  else if (LINT) addEmblemAt(g, surf(te, 0).addScaledVector(normal(te, 0), 0.01), normal(te, 0), 0.42, undefined, BRB.blue); // (in blue on the white panel)
  else addDbLogo(g, surf(te, 0).addScaledVector(normal(te, 0), 0.02), normal(te, 0), 0.34, stock.emblem, 1.2); // between the headlights
  // Lights: round headlights low in the corners (in black surrounds), red tail lights beside them
  // (FLIRT: in the grey below the blue, centred between the black panel's top and the band)
  const flirtLampY = (bb + FLIRT_BLACK_ABOVE + bb + FLIRT_NOSE_BLUE) / 2;
  // (LINT: on the white panel above the line, towards its ends)
  // (Allegra: further out, on the red corners beside the windscreen's line, not under it)
  for (const u of LINT ? [-0.56, 0.56] : ALLEGRA ? [-0.93, 0.93] : [-0.7, 0.7]) {
    const lampY = LINT ? lintPanelMid(u) : FLIRT ? flirtLampY : DESIRO_LOOK ? RAIL_TOP + DESIRO_L.lamps : bandMid;
    const t = tAtY(u, lampY);
    lampOn(g, surf(t, u).addScaledVector(normal(t, u), -0.012), normal(t, u), 0.16, mat(0x111214, { roughness: 0.4 }));
    lampOn(g, surf(t, u), normal(t, u), 0.11, lampMaterial('white', o.frontOfTrain));
    const u2 = u * 0.82;
    const t2 = tAtY(u2, lampY);
    lampOn(g, surf(t2, u2), normal(t2, u2), 0.06, lampMaterial('red', o.rearOfTrain));
  }
  // Automatic (Scharfenberg) coupler and a snowplough (on the LINT and FLIRT the coupler
  // sits higher, level with the body's bottom edge; the LINT's plough is skirt blue, showing below it)
  const couplerY = LINT || FLIRT ? bb : DESIRO_LOOK ? RAIL_TOP + DESIRO_L.coupler : bb - 0.2; // (LINT, FLIRT: centred on the top of the wheel arch)
  g.add(box(0.5, 0.28, 0.32, dark, xF + dir * 0.1, couplerY, 0));
  g.add(box(0.12, 0.38, 0.42, dark, xF + dir * 0.33, couplerY, 0));
  // (the Allegra's, with no nose skirt in front of it, further forward, under the coupler)
  // (and up only as far as the nose's bottom edge)
  addSnowplough(g, xF + (ALLEGRA ? dir * 0.35 : 0), dir, ALLEGRA ? bb : bb - 0.05, W - 0.6, // (full width: the nose hardly narrows down at its foot)
  LINT ? mat(BRB.blue, { roughness: 0.5 }) : dark);
  if (FLIRT || DESIRO) {
    // Buffers: a solid black block either side, outboard of the black panel, centred
    // at the coupler's height and standing out from the nose
    const blockMat = mat(0x141517, { roughness: 0.6 });
    for (const e of [-1, 1]) {
      const z = e * 1.0;
      const p = surf(tAtY(z / (W / 2), couplerY), z / (W / 2));
      g.add(box(0.2, 0.42, 0.34, blockMat, p.x + dir * 0.05, couplerY, z));
    }
  }
  if (LINT) {
    // Cab side window on each flank, as on the Railjet's driving trailer: a square back
    // edge where the nose's slope reaches the top (it stops where the roof goes flat),
    // its front edge following the slope a little in from it, and a diagonal bottom
    // edge: the dividing line, running from the back corner (level with the passenger
    // windows' bottoms) down to the nose's edge at LINT_FRONT.line; in a black surround
    const y1 = winY1;
    const backX = winBackX;
    const yLow = lineLowY;
    const outline = (inset: number) => {
      const bx = backX + dir * inset;
      const pts = [new THREE.Vector2(bx, lineY(bx) + inset), new THREE.Vector2(bx, y1 - inset)];
      const N = 40;
      let prev: THREE.Vector2 | null = null;
      for (let i = 0; i <= N; i++) {
        const y = y1 - inset - ((y1 - inset - yLow) * i) / N;
        const p = new THREE.Vector2(edgeX(y) - dir * (0.12 + inset), y);
        if (p.y < lineY(p.x) + inset) {
          if (prev) {
            // where the front edge crosses the (inset) dividing line
            const f = (prev.y - lineY(prev.x) - inset) / (prev.y - lineY(prev.x) - (p.y - lineY(p.x)));
            pts.push(prev.clone().lerp(p, f));
          }
          break;
        }
        pts.push(p);
        prev = p;
      }
      return new THREE.Shape(pts);
    };
    const surround = mat(0x111214, { roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const pane = mat(0x2a333c, { roughness: 0.12, metalness: 0.4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (const side of [-1, 1]) {
      for (const [inset, m0, out] of [[0, surround, 0.008], [0.06, pane, 0.012]] as const) {
        const m = mesh(new THREE.ShapeGeometry(outline(inset)), m0, 0, 0, side * (W / 2 + out));
        m.castShadow = false;
        g.add(m);
      }
    }
  }
  if (DESIRO_LOOK) {
    const L = DESIRO_L;
    // The driver's side window on each flank, just behind the nose
    const DW = L.driverWin;
    const [w0, w1] = DW.y.map((h) => RAIL_TOP + h);
    const pane = mat(0x1f262d, { roughness: 0.15, metalness: 0.3, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    if (L.cabDoor) {
      // (Allegra) A big side window filling the nose's flank, its front edge following the
      // nose's outline a little in from it, and the driver's door behind it: outlined by
      // its seams, a window in its top half, a grab handle either side
      const CD = L.cabDoor;
      // (the window from the driver's door's front edge (where the nose starts to curve in)
      // forward until its border meets the red corner pillar beside the windscreen)
      const backX = xF - dir * (D.nose - 0.03); // (where the nose's curve starts, not following the door)
      // (as tall as the passenger windows and level with them; roughly a triangle: its
      // upright back edge, its front edge following the nose's slope, meeting at the top)
      const top = RAIL_TOP + L.win[1];
      const bot = RAIL_TOP + L.win[0];
      // (its outline inset by `inset`: the border is the full outline, the glass inside it)
      const outline = (inset: number) => {
        const bx = backX + dir * inset;
        const pts: THREE.Vector2[] = [new THREE.Vector2(bx, bot + inset)];
        for (let i = 0; i <= 24; i++) {
          const yy = bot + inset + ((top - bot - 2 * inset) * i) / 24;
          const ex = edgeX(yy) - dir * inset;
          pts.unshift(new THREE.Vector2(dir > 0 ? Math.max(ex, bx) : Math.min(ex, bx), yy));
        }
        pts.push(new THREE.Vector2(bx, top - inset));
        return new THREE.ShapeGeometry(new THREE.Shape(pts));
      };
      const border = mat(0x2b2e31, { roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const paneD = mat(0x15171a, { roughness: 0.25, metalness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
      // (on the curved side of the nose: from the red pillar beside the windscreen back to
      // the door, where the nose meets the flat side)
      void outline;
      const uPillar = 0.86 + 0.06; // (outside the windscreen's border, 0.86 across)
      if (AW) {
        // (its border's bottom front corner at F, its front edge along the line EF (each
        // height's point on it brought onto the nose), its top and bottom level with the
        // passenger windows' borders'; the glass 5 cm inside the border all round)
        const NU = 64;
        const sideBand = (P: ReturnType<typeof allegraCDEF>[number], y0: number, y1: number, inset: number, out: number, m: THREE.Material) => {
          const sg = P.sgn;
          const rows = 24;
          // (per height: the arc length along the nose's level section from the flank
          // (|u| = 1) to each |u|, sampled, and the front edge's arc position on it)
          const rowAt = (yy: number) => {
            const us: number[] = [];
            const arc: number[] = [0];
            let prev = surf(tAtY(sg, yy), sg);
            us.push(1);
            let best = Infinity;
            let kb = 0;
            const target = P.at(yy);
            const dist = (uu: number) => surf(tAtY(sg * uu, yy), sg * uu).distanceToSquared(target);
            // (sampled evenly in angle, u = cos θ: near the flank the plan's quarter-ellipse
            // turns fast, and even steps in u would stretch the first one over many cm)
            for (let k = 1; k <= NU; k++) {
              const uu = Math.cos(((k / NU) * Math.PI) / 2);
              const q = surf(tAtY(sg * uu, yy), sg * uu);
              arc.push(arc[k - 1] + q.distanceTo(prev));
              us.push(uu);
              prev = q;
              const d = q.distanceToSquared(target);
              if (d < best) {
                best = d;
                kb = k;
              }
            }
            // (the nearest sample refined to the exact nearest point, so the edge is smooth)
            let lo = us[Math.min(NU, kb + 1)];
            let hi = us[Math.max(0, kb - 1)];
            for (let it = 0; it < 40; it++) {
              const m1 = lo + (hi - lo) / 3;
              const m2 = hi - (hi - lo) / 3;
              if (dist(m1) < dist(m2)) hi = m2;
              else lo = m1;
            }
            const uf = (lo + hi) / 2;
            const kf = (Math.acos(THREE.MathUtils.clamp(uf, 0, 1)) / (Math.PI / 2)) * NU;
            const k0 = Math.min(NU - 1, Math.floor(kf));
            const frontArc = arc[k0] + (arc[k0 + 1] - arc[k0]) * (kf - k0);
            return { us, arc, frontArc };
          };
          const R = Array.from({ length: rows + 1 }, (_, i) => rowAt(y0 + ((y1 - y0) * i) / rows));
          const uFromArc = (r: (typeof R)[number], a: number) => {
            if (a <= 0) return 1;
            for (let k = 1; k < r.arc.length; k++)
              if (r.arc[k] >= a) return Math.cos((((k - 1 + (a - r.arc[k - 1]) / (r.arc[k] - r.arc[k - 1])) / NU) * Math.PI) / 2);
            return r.us[r.us.length - 1];
          };
          // (the inset measured square to the front edge, so wider level where it leans)
          const lean = (i: number) => {
            const i0 = Math.max(0, i - 1);
            const i1 = Math.min(rows, i + 1);
            return (R[i1].frontArc - R[i0].frontArc) / (((y1 - y0) * (i1 - i0)) / rows);
          };
          gridMesh(rows, 16, (a, b) => {
            const i = Math.round(a * rows);
            const yy = y0 + (y1 - y0) * a;
            const fa = Math.max(0, R[i].frontArc - inset * Math.sqrt(1 + lean(i) ** 2));
            // (the back edge: the border's outside on the line where the nose's curve starts
            // (|u| = 1, the flat side); the glass 5 cm in from it, like the front)
            const back = Math.min(inset, fa);
            const uu = sg * uFromArc(R[i], back + (fa - back) * (1 - b));
            const t = tAtY(uu, yy);
            return surf(t, uu).addScaledVector(normal(t, uu), out);
          }, m);
        };
        for (const P of allegraCDEF(AW)) {
          sideBand(P, bot - 0.05, top + 0.05, 0, 0.01, border);
          sideBand(P, bot, top, 0.05, 0.014, paneD);
        }
      } else {
        patch((u) => tAtY(u, bot - 0.04), (u) => tAtY(u, top + 0.04), uPillar, 1, 0.01, border);
        patch((u) => tAtY(u, bot - 0.04), (u) => tAtY(u, top + 0.04), -1, -uPillar, 0.01, border);
        patch((u) => tAtY(u, bot), (u) => tAtY(u, top), uPillar + 0.025, 1, 0.014, paneD);
        patch((u) => tAtY(u, bot), (u) => tAtY(u, top), -1, -(uPillar + 0.025), 0.014, paneD);
      }
      const dx = xF - dir * CD.centre;
      const y0 = RAIL_TOP + CD.y[0];
      const y1 = RAIL_TOP + CD.y[1];
      const seam = mat(0x3a0a0e, { roughness: 0.8 });
      const handle = mat(0xd9dcdf, { metalness: 0.6, roughness: 0.35 });
      for (const side of [-1, 1]) {
        const z = side * (W / 2 + 0.01);
        g.add(box(CD.w + 0.03, 0.03, 0.006, seam, dx, y1, z));
        g.add(box(CD.w + 0.03, 0.03, 0.006, seam, dx, y0, z));
        for (const e of [-1, 1]) g.add(box(0.03, y1 - y0, 0.006, seam, dx + (e * CD.w) / 2, (y0 + y1) / 2, z));
        // (its window as on the drawing: about the passenger windows' height)
        const [dw0, dw1] = CD.win.map((h) => RAIL_TOP + h);
        const geo = new THREE.ShapeGeometry(roundedRect(CD.w - 0.2, dw1 - dw0, 0.06) as THREE.Shape, 6);
        if (side < 0) geo.rotateY(Math.PI);
        const m = mesh(geo, pane, dx, (dw0 + dw1) / 2, side * (W / 2 + 0.02));
        m.castShadow = false;
        g.add(m);
        for (const e of [-1, 1]) g.add(box(0.04, 1.1, 0.05, handle, dx + e * (CD.w / 2 + 0.08), y0 + 1.0, side * (W / 2 + 0.03)));
      }
    } else for (const side of [-1, 1]) {
      const geo = new THREE.ShapeGeometry(roundedRect(DW.x[1] - DW.x[0], w1 - w0, 0.08) as THREE.Shape, 6);
      if (side < 0) geo.rotateY(Math.PI);
      const m = mesh(geo, pane, xF - dir * (DW.x[0] + DW.x[1]) / 2, (w0 + w1) / 2, side * (W / 2 + 0.012));
      m.castShadow = false;
      g.add(m);
    }
    // (not on the KISS, whose nose reaches the full roof height)
    if (L.hump > 0) {
    // The cab's raised, arched roof carried back behind the nose, then dropping
    // straight down to the flat roof: the arch (its sides upright down to the flat roof)
    // extruded back over DESIRO_L.hump, closed by an upright end
    const flatTop = D.eaves + D.roofRise;
    const P: [number, number][] = []; // (z, height)
    P.push([-W / 2, flatTop]);
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI - (i / 24) * Math.PI;
      P.push([(Math.cos(a) * W) / 2, eavesN + Math.sin(a) * rise]);
    }
    P.push([W / 2, flatTop]);
    const x0 = xR;
    const x1 = xR - dir * L.hump;
    const pos: number[] = [];
    const idx: number[] = [];
    // (its front follows the nose's top edge, set back at the corners by the rounding, so
    // the two meet without the raised roof's corners sticking out over the nose)
    for (const [z, h] of P) pos.push(x0 - dir * pr * archRound(THREE.MathUtils.clamp((2 * z) / W, -1, 1)), h, z);
    for (const [z, h] of P) pos.push(x1, h, z);
    for (let i = 0; i < P.length - 1; i++) idx.push(i, P.length + i, i + 1, P.length + i, P.length + i + 1, i + 1);
    // (the upright end: a fan from the middle of its bottom edge)
    const c0 = pos.length / 3;
    pos.push(x1, flatTop, 0);
    for (let i = 0; i < P.length - 1; i++) idx.push(c0, P.length + i, P.length + i + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(mesh(geo, mat(L.white, { roughness: 0.45, side: THREE.DoubleSide })));
    // The windscreen's black surround carried on along its arched top, as wide as on the
    // front, back to the drop
    {
      const U = 0.87; // (a touch wider than the surround on the front, covering its edge)
      const a0 = Math.acos(U);
      const arch: [number, number][] = [];
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI - a0 - (i / 20) * (Math.PI - 2 * a0);
        arch.push([(Math.cos(a) * W) / 2, eavesN + Math.sin(a) * rise + 0.01]);
      }
      const bp: number[] = [];
      const bi: number[] = [];
      // (its front edge follows the nose's top edge, set back at the corners by the
      // rounding, and laps a little forward over the front's surround so no seam shows)
      for (const [z, h] of arch) bp.push(surf(0.97, (2 * z) / W).x, h, z);
      for (const [z, h] of arch) bp.push(x1, h, z);
      for (let i = 0; i < arch.length - 1; i++) bi.push(i, arch.length + i, i + 1, arch.length + i, arch.length + i + 1, i + 1);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
      bg.setIndex(bi);
      bg.computeVertexNormals();
      const bm = mesh(bg, mat(L.black, { roughness: 0.4, side: THREE.DoubleSide }));
      bm.castShadow = false;
      g.add(bm);
    }
    }
  }
  if (LINT || FLIRT || (DESIRO_LOOK && !ALLEGRA)) { // (the Allegra has none: open under its nose)
    // A skirt round the nose (the LINT's blue, the FLIRT's grey): a panel hanging from
    // the nose's bottom edge, following its rounded plan, and back along both sides to
    // just in front of the bogie (diagonal there); the coupler pokes out
    const SKIRT_H = LINT ? 0.5 : bb - (RAIL_TOP + (DESIRO_LOOK ? DESIRO_L.noseSkirt : FLIRT_NOSE_SKIRT));
    // (FLIRT: the black panel runs from the skirt's bottom to 0.43 m above the coupler, 1.5 times as wide as tall)
    const blackTop = FLIRT ? couplerY + FLIRT_BLACK_ABOVE : bb;
    const slant = SKIRT_H * SKIRT.lean;
    const flankX = xF - dir * ((o.bogieIn ?? S423_END_BOGIE) - endWheelbase() / 2 - S423_WHEEL_R - 0.1); // (front edge of the bogie's cut-out)
    const top: THREE.Vector3[] = [];
    const bot: THREE.Vector3[] = [];
    const push = (x: number, z: number, xb: number) => {
      top.push(new THREE.Vector3(x, bb + 0.02, z));
      bot.push(new THREE.Vector3(xb, bb - SKIRT_H, z));
    };
    push(flankX, -W / 2 + 0.002, flankX + dir * slant);
    for (let i = 0; i <= 24; i++) {
      const u = -Math.cos((i / 24) * Math.PI); // (denser round the corners)
      const p = surf(0, u);
      const z = THREE.MathUtils.clamp(p.z, -W / 2 + 0.002, W / 2 - 0.002);
      push(p.x, z, p.x);
    }
    push(flankX, W / 2 - 0.002, flankX + dir * slant);
    const pos: number[] = [];
    const idx: number[] = [];
    top.forEach((t, i) => {
      pos.push(t.x, t.y, t.z, bot[i].x, bot[i].y, bot[i].z);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = mesh(geo, mat(LINT ? BRB.blue : DESIRO_LOOK ? DESIRO_L.black : BRB.grey, { roughness: 0.5, side: THREE.DoubleSide }));
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
    if (DESIRO_LOOK) return roofCut(); // (its skirt is black all over: no separate centre panel)
    // A black panel down the skirt's middle, just in front of it (on the LINT, the
    // black under the windscreen carried on down)
    const bpos: number[] = [];
    const bidx: number[] = [];
    const blackU = FLIRT ? (1.5 * (blackTop - (bb - SKIRT_H))) / W : LINT_FRONT.blackU;
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const u = -blackU + (2 * blackU * i) / N;
      const p = surf(0, u);
      const x = p.x + dir * 0.004;
      bpos.push(x, bb + 0.02, p.z, x, bb - SKIRT_H, p.z);
      if (i) bidx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    }
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    bgeo.setIndex(bidx);
    bgeo.computeVertexNormals();
    const blackMat = mat(0x141517, { roughness: 0.6, side: THREE.DoubleSide });
    const bm = mesh(bgeo, blackMat);
    bm.castShadow = false;
    bm.receiveShadow = false;
    g.add(bm);
    // (on the FLIRT it carries on up the nose, above the coupler)
    if (FLIRT) patch(() => 0, (u) => tAtY(u, blackTop), -blackU, blackU, 0.008, blackMat);
  }
  return roofCut();
  function roofCut() {
    if (!AW) return null;
    const AWr = AW;
    return (z: number) => {
      const yt = surf(1, THREE.MathUtils.clamp(z / (W / 2), -0.999, 0.999)).y;
      return Math.abs(z) > AWr.f(AWr.yg) ? 0 : Math.max(0, dir * (xR - AWr.X(yt)));
    };
  }
}

/** The front logo, DB style: the Logo text in red in a red-outlined white rounded rectangle, at p facing n, height h (none if the text is empty). */
function addDbLogo(g: THREE.Group, p: THREE.Vector3, n: THREE.Vector3, h: number, label: string, maxW: number): void {
  if (!label) return;
  const red = mat(DB_RED, { roughness: 0.45, side: THREE.DoubleSide });
  const white = mat(0xffffff, { roughness: 0.5, side: THREE.DoubleSide });
  // Orientation from the normal directly: local +z along n, local +y as upright as possible
  const zAxis = n.clone().normalize();
  const xAxis = new THREE.Vector3(0, 1, 0).cross(zAxis).normalize();
  const yAxis = zAxis.clone().cross(xAxis);
  const e = new THREE.Group();
  e.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  e.position.copy(p);
  g.add(e);
  // The plate keeps its height and grows with the text (at least DB-logo proportions);
  // past maxW the text is squeezed to fit instead
  loadLetterFont()
    .then((font) => {
      const pad = h * 0.22;
      const text = letterGeometry(font, label, { capHeight: h * 0.6, depth: 0.003, tracking: 0.02, maxWidth: maxW - 2 * pad });
      if (!text) return;
      text.computeBoundingBox();
      const tb = text.boundingBox!;
      const w = THREE.MathUtils.clamp(tb.max.x - tb.min.x + 2 * pad, h * 1.45, maxW);
      e.add(mesh(new THREE.ShapeGeometry(roundedRect(w, h, h * 0.18) as THREE.Shape, 8), red));
      e.add(mesh(new THREE.ShapeGeometry(roundedRect(w - h * 0.14, h * 0.86, h * 0.12) as THREE.Shape, 8), white, 0, 0, 0.006));
      e.add(mesh(text, red, 0, -(tb.min.y + tb.max.y) / 2, 0.012));
    })
    .catch((err) => console.warn('S-Bahn logo font failed to load', err));
}

/** A single-arm pantograph raised to the contact wire, on a roof at height roofTop. */
/** How far in from the body's end a folded pantograph reaches (it stands 1 m in; its arm lies 1.6 m further in, plus the rod). */
const FOLDED_PANTO_REACH = 1.0 + 1.6 + 0.05;
function addS423Pantograph(g: THREE.Group, x: number, knee: number, raised: boolean, flatRoof?: number, plateColor?: number): void {
  // flatRoof: the height of a flat roof to stand on (otherwise it's sunk into the arched roof)
  // knee: +1 if the arm's knee points towards +x, −1 towards −x
  const D = S423_DIM;
  const metal = mat(0x8c9196, { metalness: 0.5, roughness: 0.4 });
  const dark = mat(0x2a2e31, { roughness: 0.8 });
  // Base plate sunk into the roof: its bottom outer edges just touch the roof's curve
  const plateW = 1.2;
  const plateH = 0.08;
  const halfW = D.width / 2;
  const roofAtEdge = D.eaves + D.roofRise * Math.sqrt(1 - (plateW / 2 / halfW) ** 2);
  const baseY = (flatRoof ?? roofAtEdge) + plateH / 2;
  g.add(box(1.1, plateH, plateW, plateColor === undefined ? metal : mat(plateColor, { roughness: 0.5 }), x, baseY, 0));
  const top = baseY + plateH / 2;
  // Raised: head at the contact wire. Folded: both arms lying flat above the plate.
  const headY = raised ? CONTACT_WIRE_Y - 0.06 : top + 0.22;
  const hinge = new THREE.Vector3(x - knee * 0.4, top + 0.05, 0);
  const kneeP = raised
    ? new THREE.Vector3(x + knee * 1.3, (top + headY) / 2 + 0.1, 0)
    : new THREE.Vector3(x + knee * 1.6, top + 0.12, 0);
  const headX = raised ? x + knee * 0.2 : x - knee * 0.2;
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const geo = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 8)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
      .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    g.add(mesh(geo, metal));
  };
  rod(hinge, kneeP, 0.05);
  for (const z of [-0.45, 0.45]) rod(kneeP, new THREE.Vector3(headX, headY, z), 0.03);
  g.add(box(0.12, 0.06, 1.95, dark, headX, headY, 0));
}

/**
 * Rubber bellows between two 423 bodies: a folded tube whose front ring is fixed
 * to one car's end and whose back ring is fixed to the next car's end, so on
 * curves it stretches on the outside and squashes on the inside with no gap.
 * Vertices are rewritten in world space every frame.
 */
function jointProfile(): [number, number][] {
  const D = S423_DIM;
  const hw = (D.width - 0.2) / 2;
  // (Allegra: from the skirt's bottom up to just under the grey roof, as on the drawing)
  const y0 = ALLEGRA ? RAIL_TOP + 0.25 : D.bodyBottom + 0.05;
  // (the FLIRT's: just under its flat roof; the Desiro ML's and KISS's: just under the flat
  // roof at their cars' ends)
  let y1 = ALLEGRA ? RAIL_TOP + 3.0 : DESIRO_LOOK && !DESIRO_L.archedRoof ? (DESIRO_L.deck ? RAIL_TOP + DESIRO_L.deck.endTop : D.eaves + D.roofRise) - 0.05 : D.eaves + (FLIRT ? -0.03 : 0.05);
  const r = 0.3;
  // (double-decker: its car ends are arched in section, so the top comes down until the
  // rounded top corners stay 3 cm inside that arch)
  if (DESIRO_L.deck && DESIRO) {
    const inside = (z: number, y: number) => y <= D.eaves || Math.abs(z) + 0.03 <= (D.width / 2) * Math.sqrt(Math.max(0, 1 - ((y - D.eaves) / D.roofRise) ** 2));
    const fits = (top: number) => Array.from({ length: 9 }, (_, i) => (i / 8) * (Math.PI / 2)).every((a) => inside(hw - r + Math.cos(a) * r, top - r + Math.sin(a) * r));
    while (y1 > D.eaves && !fits(y1)) y1 -= 0.01;
  }
  const pts: [number, number][] = [];
  const corner = (cz: number, cy: number, a0: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }

  };
  corner(hw - r, y1 - r, 0);
  corner(-hw + r, y1 - r, Math.PI / 2);
  corner(-hw + r, y0 + r, Math.PI);
  corner(hw - r, y0 + r, (3 * Math.PI) / 2);
  return pts;
}
let JOINT_PROFILE = jointProfile();
const JOINT_RINGS = 13;
const JOINT_EMBED = 0.1;
const jointMat = mat(0x1b1c1e, { roughness: 0.95, side: THREE.DoubleSide });

/** Whether the joint behind car k joins two loco-hauled coaches (a narrower gangway, between bodies that end at the car's ends). */
const isCoachJoint = (k: number) => (S423_CARS[k]?.kind ?? 'emu') !== 'emu';

/** A coach gangway's outline (across, height): a rounded rectangle about the end door. */
function coachGangwayProfile(): [number, number][] {
  const hw = 0.7;
  const y0 = RAIL_TOP + RHB.gangwayBottom;
  const y1 = RAIL_TOP + RHB.doorTop + 0.05;
  const r = 0.2;
  const pts: [number, number][] = [];
  const corner = (cz: number, cy: number, a0: number) => {
    for (let i = 0; i <= 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2);
      pts.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(hw - r, y1 - r, 0);
  corner(-hw + r, y1 - r, Math.PI / 2);
  corner(-hw + r, y0 + r, Math.PI);
  corner(hw - r, y0 + r, (3 * Math.PI) / 2);
  return pts;
}

function makeS423Joint(coach = false): THREE.Mesh {
  JOINT_PROFILE = jointProfile();
  const profile = coach ? coachGangwayProfile() : JOINT_PROFILE;
  const P = profile.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(JOINT_RINGS * P * 3), 3));
  const idx: number[] = [];
  for (let r = 0; r < JOINT_RINGS - 1; r++)
    for (let i = 0; i < P; i++) {
      const a = r * P + i;
      const b = r * P + ((i + 1) % P);
      idx.push(a, b, a + P, b, b + P, a + P);
    }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, jointMat);
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.profile = profile;
  return m;
}

const jointA = new THREE.Vector3();
const jointB = new THREE.Vector3();
function placeS423Joints(): void {
  const D = S423_DIM;
  s423Joints.forEach((j, n) => {
    const k = s423JointCars[n];
    const profile = j.userData.profile as [number, number][];
    const P = profile.length;
    const ahead = cars[k];
    const behind = cars[k + 1];
    ahead.obj.updateMatrixWorld();
    behind.obj.updateMatrixWorld();
    // (coaches' bodies run right to their ends)
    const gap = isCoachJoint(k) ? 0 : D.jointGap / 2;
    const xa = -S423_CARS[k].len / 2 + gap + JOINT_EMBED;
    const xb = S423_CARS[k + 1].len / 2 - gap - JOINT_EMBED;
    const cy = profile.reduce((a, p) => a + p[1], 0) / P;
    const pos = j.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let r = 0; r < JOINT_RINGS; r++) {
      const t = r / (JOINT_RINGS - 1);
      // Folds: every other ring tucked in a little, except the two end rings
      const tuck = r > 0 && r < JOINT_RINGS - 1 && r % 2 === 1 ? 0.06 : 0;
      for (let i = 0; i < P; i++) {
        const [z, y] = profile[i];
        const len = Math.hypot(z, y - cy);
        const f = tuck ? Math.max(0, 1 - tuck / len) : 1;
        const zz = z * f;
        const yy = cy + (y - cy) * f;
        ahead.obj.localToWorld(jointA.set(xa, yy, zz));
        behind.obj.localToWorld(jointB.set(xb, yy, zz));
        jointA.lerp(jointB, t);
        pos.setXYZ(r * P + i, jointA.x, jointA.y, jointA.z);
      }
    }
    pos.needsUpdate = true;
    j.geometry.computeVertexNormals();
  });
}

/**
 * Screw couplings between each pair of neighbouring vehicles' draw hooks: a pair
 * of side links with a threaded turnbuckle in the middle. Re-aimed every frame so
 * each stays straight between its hooks on curves; the links run along local z.
 */
const couplingIron = mat(0x2a2d31, { metalness: 0.4, roughness: 0.6 });
function makeCoupling(): THREE.Group {
  const c = new THREE.Group();
  for (const dx of [-0.072, 0.072]) c.add(box(0.041, 0.051, 1, couplingIron, dx, 0, 0));
  c.add(mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.164, 12).rotateX(Math.PI / 2), couplingIron)); // turnbuckle
  c.add(box(0.246, 0.025, 0.025, couplingIron, 0, 0.072, 0)); // its handle
  return c;
}
let couplings: THREE.Group[] = [];
const couplingFront = new THREE.Vector3();
const couplingBack = new THREE.Vector3();


/**
 * Gangway connections between neighbouring carriages: a rubber bellows of the
 * surrounds' shape joining their faces into a closed walkway. Its front face is
 * pinned to one carriage's surround and its back face to the other's every frame,
 * so on curves it stretches on the outside and squeezes on the inside instead of
 * leaving a wedge-shaped gap.
 */
interface GangwayLink {
  mesh: THREE.Mesh;
  /** Per vertex: across (local z of the carriages), height, and which end (+1 front, -1 back). */
  rest: Float32Array;
}

let gangwayLinks: GangwayLink[] = [];
function makeGangwayLink(): GangwayLink {
  // Exactly the surrounds' shape (see addCarriageEnd), so the three read as one piece
  const geo = new THREE.ExtrudeGeometry(gangwayShape(), { depth: 1, bevelEnabled: false, curveSegments: 10 });
  const pos = geo.attributes.position;
  const rest = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // across, mirrored: the extrusion runs towards the carriage ahead (their +x), so
    // without the mirror the mapping flips handedness and turns the faces inside out
    rest[i * 3] = -pos.getX(i);
    rest[i * 3 + 1] = pos.getY(i); // height (the outline is drawn at its real heights)
    rest[i * 3 + 2] = pos.getZ(i) > 0.5 ? 1 : -1; // extruded end: 1 = towards the carriage ahead
  }
  // ExtrudeGeometry's group 0 is the end caps, which would sit exactly on the
  // surrounds' faces and flicker; only the sides (group 1) are drawn.
  const link = new THREE.Mesh(geo, [new THREE.MeshBasicMaterial({ visible: false }), mat(0x1b1c1e, { roughness: 0.95 })]);
  link.frustumCulled = false; // its vertices move every frame
  return { mesh: link, rest };
}

/**
 * Build the train for the current rolling stock: locomotive, carriages, the
 * couplings between them, and gangway links between carriages. Any previous train
 * is removed first.
 */
function buildTrain(): void {
  for (const o of [...cars.map((c) => c.obj), ...couplings, ...gangwayLinks.map((l) => l.mesh), ...s423Joints]) {
    scene.remove(o);
    disposeTree(o);
  }
  s423Joints = [];
  if (S423) {
    cars = S423_CARS.map((c, i) => makeS423Car(c, i));
    couplings = [];
    gangwayLinks = [];
    // Bellows only within a unit, not between coupled cabs
    // (bellows within a unit; a gangway between loco-hauled coaches)
    s423JointCars = S423_CARS.flatMap((c, k) => {
      if (k >= S423_CARS.length - 1) return [];
      const emu = (c.kind ?? 'emu') === 'emu' && (S423_CARS[k + 1].kind ?? 'emu') === 'emu' && !c.cabRear;
      return emu || isCoachJoint(k) ? [k] : [];
    });
    s423Joints = s423JointCars.map((k) => makeS423Joint(isCoachJoint(k)));
    for (const o of [...cars.map((c) => c.obj), ...s423Joints]) scene.add(o);
    measureCars();
    return;
  }
  // On the Railjet the last carriage is a driving trailer (Steuerwagen)
  cabWindowLen = RJ_CAB_WINDOW_LEN;
  // (carriages first: the driving trailer sets the cab window length the loco matches)
  const carriages = CARRIAGE_OFFSETS.map((o, i) => makeCarriage(o, RAILJET && i === CARRIAGE_OFFSETS.length - 1));
  cars = [ELECTRIC ? makeTaurus() : makeLoco(), ...carriages];
  couplings = cars.slice(1).map(() => makeCoupling());
  gangwayLinks = cars.slice(2).map(() => makeGangwayLink());
  for (const o of [...cars.map((c) => c.obj), ...couplings, ...gangwayLinks.map((l) => l.mesh)]) scene.add(o);
  measureCars();
}

/** Each car's extent in its own frame (measured before it's placed on the track). */
function measureCars(): void {
  for (const c of cars) {
    c.obj.position.set(0, 0, 0);
    c.obj.rotation.set(0, 0, 0);
    c.obj.updateMatrixWorld(true);
    c.localBox = new THREE.Box3().setFromObject(c.obj);
  }
}
buildTrain();

const gangwayPoint = new THREE.Vector3();

function placeGangways(): void {
  const face = CARRIAGE_LEN / 2 + GANGWAY.depth; // surround's outer face, from the carriage centre
  gangwayLinks.forEach((link, j) => {
    const ahead = cars[j + 1];
    const behind = cars[j + 2];
    const pos = link.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const across = link.rest[i * 3];
      const y = link.rest[i * 3 + 1];
      // Both carriages' local +z is the same side, so "across" maps straight onto it
      if (link.rest[i * 3 + 2] > 0) ahead.obj.localToWorld(gangwayPoint.set(-face, y, across));
      else behind.obj.localToWorld(gangwayPoint.set(face, y, across));
      pos.setXYZ(i, gangwayPoint.x, gangwayPoint.y, gangwayPoint.z);
    }
    pos.needsUpdate = true;
    link.mesh.geometry.computeVertexNormals();
  });
}

/** Tip of a vehicle's rear draw hook, in its own frame. */
const rearHookX = (i: number) =>
  (i === 0 ? -LOCO_HALF - 0.144 - HOOK_REACH + LOCO_END_SHORTEN : -CARRIAGE_LEN / 2 - CARRIAGE_HOOK_REACH) + 0.041;
/** Outer face of a vehicle's rear buffer heads, in its own frame. */
const rearBufferFace = (i: number) => (i === 0 ? LOCO_BUFFER_FACE : -CARRIAGE_LEN / 2 - REAR_BUFFER_REACH);

function placeCouplings(): void {
  couplings.forEach((coupling, k) => {
    const ahead = cars[k];
    const behind = cars[k + 1];
    couplingFront.set(rearHookX(k), COUPLING_Y, 0);
    ahead.obj.localToWorld(couplingFront);
    couplingBack.set(CARRIAGE_LEN / 2 + CARRIAGE_HOOK_REACH - 0.041, COUPLING_Y, 0);
    behind.obj.localToWorld(couplingBack);
    coupling.position.addVectors(couplingFront, couplingBack).multiplyScalar(0.5);
    const len = couplingFront.distanceTo(couplingBack);
    coupling.children[0].scale.z = len;
    coupling.children[1].scale.z = len;
    coupling.lookAt(couplingFront);
  });
}

const wheelWorld = new THREE.Vector3();
const bufferPoint = new THREE.Vector3();

/**
 * A buffer head facing along dir (±1 on x). As on European stock, the right-hand
 * buffer (seen facing that end) is domed and the left-hand one flat, so where two
 * vehicles meet, each pair is domed against flat and they slide on curves.
 * The group's origin is the middle of the head's disc.
 */
function bufferHead(dir: number, z: number, material: THREE.Material): THREE.Group {
  const head = new THREE.Group();
  head.add(cylX(0.226, 0.062, material));
  // Facing +x, your right is -z; facing -x, it's +z
  const domed = dir > 0 ? z < 0 : z > 0;
  if (domed) {
    const R = 0.615;
    const cap = Math.asin(0.226 / R);
    const dome = new THREE.SphereGeometry(R, 20, 6, 0, TAU, 0, cap)
      .rotateZ(-dir * (Math.PI / 2)) // cap's axis along dir
      .translate(dir * (0.031 - R * Math.cos(cap)), 0, 0); // rim on the disc's face
    head.add(mesh(dome, material));
  }
  head.position.set(0, 1.558, z);
  return head;
}

/** Position a buffer's plunger and head to stick out `reach` from the end at endX (dir ±1). */
function setBufferReach(shaft: THREE.Object3D, head: THREE.Object3D, endX: number, dir: number, reach: number): void {
  const shaftLen = Math.max(0.021, reach - 0.062);
  shaft.scale.x = shaftLen;
  shaft.position.x = endX + (dir * shaftLen) / 2;
  head.position.x = endX + dir * (reach - 0.031);
}

function placeTrain(): void {
  for (const c of cars) {
    // The body rests on its two pivots, each on the track: it sits at their midpoint,
    // pointing from one to the other (on a curve that's slightly inside the track)
    const pf = c.pivotFront ?? c.pivot;
    const pb = c.pivotBack ?? c.pivot;
    const fwd = trackPose(state.s + c.offset + pf);
    const back = trackPose(state.s + c.offset - pb);
    const p = { yaw: Math.atan2(-(fwd.z - back.z), fwd.x - back.x) };
    // The centre lies on the chord between the pivots, pb from the back one
    const k = pb / (pf + pb);
    c.obj.position.set(back.x + (fwd.x - back.x) * k, 0, back.z + (fwd.z - back.z) * k);
    c.obj.rotation.y = p.yaw;
    c.obj.updateMatrixWorld();
    for (const w of c.wheels) {
      w.rotation.z = -state.s / (w.userData.radius ?? WHEEL_RADIUS);
      // Carriage wheels ride on bogies: each axle sits on the rails at its own
      // point along the track, turned to match it, under the rigid body. (The
      // locomotive's wheelbase is short enough to stay fixed, which also keeps
      // its coupling rods lined up.)
      if (!w.userData.follow) continue;
      const { axleX, side, offZ } = w.userData as { axleX: number; side: number; offZ?: number };
      const q = trackPose(state.s + c.offset + axleX);
      const z = offZ ?? side * WHEEL_Z; // (bogie frames and the like sit further out, or on the centre line)
      // Local +Z of a heading q.yaw points along (sin yaw, 0, cos yaw)
      wheelWorld.set(q.x + z * Math.sin(q.yaw), w.position.y, q.z + z * Math.cos(q.yaw));
      w.position.copy(c.obj.worldToLocal(wheelWorld));
      w.rotation.y = q.yaw - p.yaw;
    }
    // Rods don't rotate: they stay level and follow the crank pins round in a circle.
    for (const r of c.rods) {
      const a = -state.s / r.radius + r.phase; // the wheels' angle
      r.mesh.position.set(r.midX + r.crank * Math.cos(a), r.y + r.crank * Math.sin(a), r.z);
    }
    // Piston and connecting rod: the crosshead slides level with the axle; the
    // connecting rod links its pin to the main crank pin as the wheel turns.
    for (const d of c.drive ?? []) {
      const a = -state.s / d.radius + d.phase;
      const pinX = d.axleX + d.crank * Math.cos(a);
      const pinY = d.axleY + d.crank * Math.sin(a);
      const headX = pinX + Math.sqrt(d.conRod * d.conRod - (pinY - d.axleY) ** 2);
      d.crosshead.position.x = headX;
      d.conRodMesh.position.set((pinX + headX) / 2, (pinY + d.axleY) / 2, d.side * DRIVE_Z);
      d.conRodMesh.rotation.z = Math.atan2(d.axleY - pinY, headX - pinX);
      // Piston rod: from the crosshead forward into the cylinder
      const pistonLen = d.cylinderBack - headX + 0.103;
      d.pistonRod.scale.x = pistonLen;
      d.pistonRod.position.x = headX + pistonLen / 2;
    }
  }
  placeCouplings();
  placeGangways();
  placeS423Joints();
  // Sprung buffers: each carriage's front buffers extend to meet the rear buffers of
  // the vehicle ahead, never past full length, so on curves the inside pair compresses.
  for (let k = 1; k < cars.length; k++) {
    const ahead = cars[k - 1];
    const carriage = cars[k];
    for (const b of carriage.buffers ?? []) {
      bufferPoint.set(rearBufferFace(k - 1), 1.558, b.z);
      carriage.obj.worldToLocal(ahead.obj.localToWorld(bufferPoint));
      const reach = THREE.MathUtils.clamp(bufferPoint.x - CARRIAGE_LEN / 2 - 0.041, 0.123, BUFFER_REACH); // 0.041: the dome
      setBufferReach(b.shaft, b.head, CARRIAGE_LEN / 2, 1, reach);
    }
  }
}

// ---------------------------------------------------------------------------
// Steam & confetti
// ---------------------------------------------------------------------------

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
}

const puffGeo = new THREE.SphereGeometry(0.369, 10, 8);
const puffs: Particle[] = Array.from({ length: 70 }, () => {
  const m = new THREE.Mesh(
    puffGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, roughness: 1 }),
  );
  m.visible = false;
  scene.add(m);
  return { mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 };
});
let puffTimer = 0;

function updateSteam(dt: number, linearSpeed: number): void {
  if (HAS_STEAM) puffTimer += dt * (0.8 + (linearSpeed / SPEED_SCALE) * 0.8); // puff rate follows the scaled speed
  while (puffTimer >= 1) {
    puffTimer -= 1;
    const p = puffs.find((q) => q.life <= 0);
    if (!p) break;
    chimneyTip.getWorldPosition(p.mesh.position);
    if (p.mesh.position.x < tunnelMouthX - 1.23) continue; // still in the tunnel
    p.vel.set((Math.random() - 0.5) * 0.615, 2.255 + Math.random() * 1.025, (Math.random() - 0.5) * 0.615);
    p.life = p.max = 1.3 + Math.random() * 0.7;
    p.mesh.visible = true;
  }
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt;
    const k = 1 - p.life / p.max;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.scale.setScalar(1 + k * 2.5);
    (p.mesh.material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - k);
    if (p.life <= 0) p.mesh.visible = false;
  }
}

const confettiGeo = new THREE.PlaneGeometry(0.246, 0.451);
const confettiColors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0x9b59b6, 0xff7eb6];
const confetti: Particle[] = Array.from({ length: 220 }, (_, i) => {
  const m = new THREE.Mesh(
    confettiGeo,
    new THREE.MeshBasicMaterial({ color: confettiColors[i % confettiColors.length], side: THREE.DoubleSide, transparent: true }),
  );
  m.visible = false;
  scene.add(m);
  return { mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1 };
});

function burstConfetti(at: THREE.Vector3): void {
  for (const p of confetti) {
    p.mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 1.23, 0, (Math.random() - 0.5) * 1.23));
    const a = Math.random() * TAU;
    const s = 2.05 + Math.random() * 7.175;
    p.vel.set(Math.cos(a) * s, 8.2 + Math.random() * 10.25, Math.sin(a) * s);
    p.spin.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
    p.life = p.max = 3 + Math.random() * 2;
    p.mesh.visible = true;
  }
}

function updateConfetti(dt: number): void {
  for (const p of confetti) {
    if (p.life <= 0) continue;
    p.life -= dt;
    const pos = p.mesh.position;
    if (pos.y > 0.062) {
      p.vel.y -= 14.35 * dt;
      p.vel.multiplyScalar(1 - 1.2 * dt);
      pos.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
    } else {
      pos.y = 0.062;
      p.mesh.rotation.set(-Math.PI / 2, 0, p.mesh.rotation.z);
    }
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life);
    if (p.life <= 0) p.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Picking & motion
// ---------------------------------------------------------------------------

const pickBtn = document.getElementById('pick') as HTMLButtonElement;
const banner = document.getElementById('banner') as HTMLDivElement;
const namesInput = document.getElementById('names') as HTMLTextAreaElement;
const removeInput = document.getElementById('remove') as HTMLInputElement;
/**
 * Camera view (?view=): 'aerial' (the overview, flying in to a close-up on arrival),
 * 'platform' (down on the picked station's platform for the arrival: see platformView)
 * or 'driver' (riding just in front of the driver's window, facing forward).
 */
type CameraView = 'aerial' | 'platform' | 'driver';
const parseCameraView = (v: string | null): CameraView => (v === 'platform' || v === 'driver' ? v : 'aerial');
let cameraView: CameraView = parseCameraView(new URLSearchParams(location.search).get('view'));

/** Remembered so the banner can be re-rendered when the language changes. */
let bannerText: (() => string) | null = null;

function hideBanner(): void {
  banner.hidden = true;
  bannerText = null;
  fitHudUnderBanner();
}

function showBanner(text: () => string, win = false): void {
  bannerText = text;
  banner.hidden = false;
  banner.textContent = text();
  banner.classList.toggle('win', false);
  if (win) {
    void banner.offsetWidth; // restart the pop animation
    banner.classList.add('win');
  }
  fitHudUnderBanner();
}

/**
 * Keep the panel clear of the banner: where they'd overlap side by side (a narrow
 * screen), the panel starts below the banner instead (a top-anchored panel moves down;
 * one anchored at the bottom gets shorter, scrolling if need be).
 */
function fitHudUnderBanner(): void {
  const hud = document.querySelector<HTMLElement>('.hud');
  if (!hud) return;
  hud.style.removeProperty('top');
  hud.style.removeProperty('max-height');
  if (banner.hidden) return;
  // (the banner's layout box, not its rendered one: it pops in from a smaller scale)
  const b = { left: (innerWidth - banner.offsetWidth) / 2, right: (innerWidth + banner.offsetWidth) / 2, bottom: banner.offsetTop + banner.offsetHeight };
  const h = hud.getBoundingClientRect();
  if (h.right <= b.left - 8 || h.left >= b.right + 8) return; // (side by side: no clash)
  const limit = b.bottom + 8;
  // (the stylesheet anchors it at the bottom on narrow or short screens)
  if (matchMedia('(max-width: 700px), (max-height: 500px)').matches) hud.style.maxHeight = `${h.bottom - limit}px`;
  else if (h.top < limit) {
    hud.style.top = `${limit}px`;
    hud.style.maxHeight = `${innerHeight - limit - 16}px`;
  }
}
addEventListener('resize', fitHudUnderBanner, { signal: moduleListeners.signal });


function refreshStations(): void {
  for (const st of stations) {
    const mode: SignMode =
      st === state.winner ? 'winner' : state.removeAfterPick && state.picked.has(st.name) ? 'done' : 'normal';
    drawSign(st, mode);
  }
}

/** Trapezoid speed profile: gentle pull-away, cruise, long suspenseful braking. */
function travelProfile(u: number): number {
  const a = 0.3;
  const d = 0.5;
  const v = 1 / (1 - a / 2 - d / 2);
  if (u < a) return (v * u * u) / (2 * a);
  if (u < 1 - d) return v * (a / 2 + (u - a));
  const w = 1 - u;
  return 1 - (v * w * w) / (2 * d);
}

/** Picks a random person and sends the train there, a couple of laps round first for suspense. */
function pick(): void {
  dispatch(() => {
    const candidates = stations.filter((st) => !neverPicked(st.name) && !(state.removeAfterPick && state.picked.has(st.name)));
    if (!candidates.length) return null;
    return { winner: candidates[randInt(candidates.length)], laps: 2 + randInt(2) };
  });
}

/**
 * Skip one step of the animation (double-tap Tab). While the train is moving it
 * arrives on the spot, and the camera flight to the station then starts from
 * its beginning; pressing again while the camera is flying lands it.
 */
let skipRequested = false;
function skipAnimation(): void {
  if (state.run) state.run.t = state.run.duration;
  else if (flight) skipRequested = true;
}

/** Track distance from where the train is now to standing at `st`, after `laps` extra laps. */
function tripDistance(st: Station, laps: number): number {
  const C = circumference();
  const onRing = Math.max(state.s, 0);
  const leadIn = onRing - state.s; // distance still to go on the straight, if any
  // Stop with the train's midpoint level with the station, so it fills the platform.
  const target = ringS(st.angle) + LOCO_AHEAD;
  return leadIn + mod(target - onRing, C) + laps * C;
}

/** A trip requested while the train is still coming out of the tunnel; runs once it stops. */
let queuedTrip: (() => { winner: Station; laps: number } | null) | null = null;

function dispatch(choose: () => { winner: Station; laps: number } | null): void {
  if (state.run && !state.run.winner) {
    // Opening run in progress: depart as soon as the train reaches the home station
    queuedTrip = choose;
    pickBtn.disabled = true;
    hideBanner(); // (no departing message: the next banner pops up on arrival)
    return;
  }
  if (state.run) return;
  if (cameraView === 'driver' && driverLean > 0) {
    // Driver's view, leaning out at a station: lean back in, facing forward, first
    // (driverView departs once the view is straight ahead again)
    leanBackThen = choose;
    pickBtn.disabled = true;
    hideBanner();
    return;
  }
  const trip = choose();
  if (!trip) {
    showBanner(() => t('banner.everyonePicked', { reset: t('people.reset') }));
    stopRecording(); // (nowhere to go: end a recording rather than leave it running)
    return;
  }
  const { winner, laps } = trip;
  state.winner = null;
  refreshStations();

  const C = circumference();
  const delta = tripDistance(winner, laps);
  const duration = laps > 0 ? 5 + (delta / C) * 1.4 : 3 + (delta / C) * 5;
  state.run = { from: state.s, delta, duration, t: 0, winner, profile: 'trip' };
  pickBtn.disabled = true;
  if (inStationView) {
    // Back out to the overview to watch the train go round
    inStationView = false;
    userMovedCamera = false;
    if (cameraView !== 'driver') frameCamera(true);
  }
  hideBanner(); // (no departing message: the next banner pops up on arrival)
}

function finishRun(run: Run): void {
  if (run.winner) return arrive(run.winner);
  // Opening run: the train has pulled in at the home station
  state.run = null;
  state.pos = { on: 'branch', b: 0 };
  state.s = posToS(state.pos);
  pickBtn.disabled = false;
  if (recording) {
    // Recording: stand at the home station for a second, then set off for the draw
    pickBtn.disabled = true;
    setTimeout(() => {
      pickBtn.disabled = false;
      pick();
      pickBtn.disabled = true;
    }, 1000);
    return;
  }
  if (queuedTrip) {
    const choose = queuedTrip;
    queuedTrip = null;
    dispatch(choose);
  }
}

function arrive(winner: Station): void {
  state.run = null;
  state.pos = { on: 'ring', deg: stationDeg(winner) };
  state.s = posToS(state.pos);
  state.winner = winner;
  state.picked.add(winner.name);
  refreshStations();
  burstConfetti(winner.group.position.clone().setY(5.125));
  showBanner(() => t('banner.nextStop', { name: parseLabel(winner.name).title }), true);
  pickBtn.disabled = false;
  // Fly in to the station for a close-up of the train standing at it (with the
  // platform view, the camera is already down on the platform and stays there; with the
  // driver's view it rides on)
  if (cameraView === 'aerial') {
    const view = stationView(winner);
    flyCamera(view.pos, view.target);
  }
  inStationView = true;
  if (recording) {
    // Once the camera has landed on the station, hold for a second, then stop recording
    // (in the driver's view, once the driver has finished leaning out to the platform)
    const stop = () => setTimeout(stopRecording, 1000 + (cameraView === 'driver' ? (1 - driverLean) * DRIVER_LEAN_TIME * 1000 : 0));
    if (!flight) stop();
    else
      onFlightLanded = () => {
        onFlightLanded = null;
        stop();
      };
  }
}

// ---------------------------------------------------------------------------
// Recording a clip: back to the tunnel, out to the home station, a second's
// stop, off to a random station, and a second after the camera has landed there
// the recording stops and downloads (the 3D view only, recorded natively).
// ---------------------------------------------------------------------------

let recording: { rec: MediaRecorder; chunks: Blob[] } | null = null;
{
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="weather"]')];
  for (const radio of radios) {
    radio.checked = radio.value === weather;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      weather = parseWeather(radio.value);
      showWeather();
      const q = new URLSearchParams(location.search);
      if (weather !== 'clear') q.set('weather', weather);
      else q.delete('weather');
      const search = q.toString();
      history.replaceState(null, '', location.pathname + (search ? `?${search}` : ''));
    });
  }
}
{
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="camera-view"]')];
  for (const radio of radios) {
    radio.checked = radio.value === cameraView;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      cameraView = parseCameraView(radio.value);
      controls.enabled = cameraView !== 'driver';
      if (cameraView !== 'driver') setCameraNear(CAMERA_NEAR);
      if (cameraView !== 'driver') {
        // Left the driver's view: no one to lean back in, so a waiting trip goes now
        driverLean = 0;
        const choose = leanBackThen;
        leanBackThen = null;
        if (choose) dispatch(choose);
      }
      if (cameraView !== 'driver') resetCamera(); // back to the overview, or the close-up if the train is standing at someone's station
      const q = new URLSearchParams(location.search);
      if (cameraView !== 'aerial') q.set('view', cameraView);
      else q.delete('view');
      const search = q.toString();
      history.replaceState(null, '', location.pathname + (search ? `?${search}` : ''));
    });
  }
  controls.enabled = cameraView !== 'driver';
}
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const cancelRecordBtn = document.getElementById('record-cancel') as HTMLButtonElement;

function startRecording(): void {
  if (recording) return;
  const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(renderer.domElement.captureStream(60), {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 10_000_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    if (rec === cancelledRec) return; // (cancelled: nothing to save)
    const type = rec.mimeType || 'video/webm';
    const url = URL.createObjectURL(new Blob(chunks, { type }));
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    Object.assign(document.createElement('a'), { href: url, download: `train.${ext}` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  recording = { rec, chunks };
  recordBtn.disabled = true;
  cancelRecordBtn.hidden = false;
  pickBtn.disabled = true;
  // Back to the start: the train in the tunnel, no one picked, the overview
  queuedTrip = null;
  leanBackThen = null;
  state.winner = null;
  refreshStations();
  hideBanner();
  inStationView = false;
  userMovedCamera = false;
  flight = null;
  frameCamera();
  startOpeningRun();
  placeTrain();
  rec.start();
}

function stopRecording(): void {
  if (!recording) return;
  recording.rec.stop();
  recording = null;
  recordBtn.disabled = false;
  pickBtn.disabled = false;
  cancelRecordBtn.hidden = true;
}

/** The recorder last cancelled (its clip is thrown away, not saved). */
let cancelledRec: MediaRecorder | null = null;
/** Stop recording without saving; the train carries on as it is. */
function cancelRecording(): void {
  if (!recording) return;
  cancelledRec = recording.rec;
  stopRecording();
}

recordBtn.addEventListener('click', startRecording);
cancelRecordBtn.addEventListener('click', cancelRecording);

function animateStations(time: number): void {
  for (const st of stations) {
    const isWinner = st === state.winner;
    // (standing on the platform; the picked person jumps, landing back on it)
    st.figure.position.y = PLATFORM_HEIGHT + (isWinner ? Math.abs(Math.sin(time * 6)) * 0.718 : 0);
    st.accentMat.emissive.setHex(isWinner ? 0xffd54f : 0x000000);
    st.accentMat.emissiveIntensity = isWinner ? 0.3 + 0.3 * Math.sin(time * 5) : 0;
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

namesInput.value = state.names.join('\n');

pickBtn.addEventListener('click', pick);

/** Time of the last Tab press, for spotting a double-tap. */
let lastTab = 0;

addEventListener('keydown', (e) => {
  if (e.repeat) return; // holding a key mustn't fire again the moment the train stops
  const el = document.activeElement;
  const typing = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
  if (e.code === 'Space') {
    if (typing || el instanceof HTMLButtonElement) return;
    e.preventDefault();
    pick();
  } else if (e.code === 'Tab' && !e.shiftKey) {
    if (typing) return; // keep normal Tab behaviour in the People panel
    e.preventDefault();
    const now = performance.now();
    if (now - lastTab < 450) {
      lastTab = 0;
      skipAnimation();
    } else lastTab = now;
  }
}, { signal: moduleListeners.signal });

document.getElementById('apply')!.addEventListener('click', () => {
  if (state.run) return;
  const names = parseNames(namesInput.value);
  if (!names.length) {
    showBanner(() => t('banner.needName'));
    return;
  }
  state.names = names;
  state.picked = new Set([...state.picked].filter((n) => names.includes(n)));
  namesInput.value = names.join('\n');
  saveNames(names);
  buildWorld();
  hideBanner();
});

// Shuffles the list in the text box only; "Update stations" then applies it.
document.getElementById('shuffle')!.addEventListener('click', () => {
  const names = parseNames(namesInput.value);
  for (let i = names.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [names[i], names[j]] = [names[j], names[i]];
  }
  namesInput.value = names.join('\n');
});

document.getElementById('reset')!.addEventListener('click', () => {
  state.picked.clear();
  refreshStations();
  hideBanner();
});

removeInput.addEventListener('change', () => {
  state.removeAfterPick = removeInput.checked;
  refreshStations();
});

// Rolling stock: locomotive, number and length of carriages. Applying rebuilds the
// train and the layout in place (no reload); the train keeps its position (on the
// ring in degrees, on the branch between landmarks), and the URL is updated so a
// reload or a shared link shows the same train (starting from the tunnel again).
/** Switch to new rolling stock without reloading. */
function applyStock(next: RollingStock): void {
  if (state.run) finishRun(state.run); // finish any journey first (it was planned in the old train's metres)
  stock = next;
  deriveStock();
  buildTrain();
  buildWorld(); // places the train from state.pos
  placeTrain();
  resetCamera(); // the train has changed: back to the default view (the picked station, if any)
  syncStockUrl();
}

/** Branding (logo, lettering) only changes the train's paintwork: rebuild just the train, in place. */
function applyBranding(emblem: string, lettering: string): void {
  stock = { ...stock, emblem, lettering };
  buildTrain();
  placeTrain();
  syncStockUrl();
}

/** Keeps the URL in step with the rolling stock (defaults left out to keep it short), without reloading. */
function syncStockUrl(): void {
  const q = new URLSearchParams(location.search);
  if (stock.loco !== 'compact') q.set('train', stock.loco);
  else q.delete('train');
  if (stock.carriages !== 1) q.set('carriages', String(stock.carriages));
  else q.delete('carriages');
  if (stock.length !== null) q.set('length', String(stock.length));
  else q.delete('length');
  if (stock.emblem !== DEFAULT_EMBLEM) q.set('logo', stock.emblem);
  else q.delete('logo');
  if (stock.lettering !== DEFAULT_LETTERING) q.set('lettering', stock.lettering);
  else q.delete('lettering');
  const search = q.toString();
  history.replaceState(null, '', location.pathname + (search ? `?${search}` : ''));
}
{
  const locoSelect = document.getElementById('loco') as HTMLSelectElement;
  const carriagesInput = document.getElementById('carriages') as HTMLInputElement;
  const lengthInput = document.getElementById('carriage-length') as HTMLInputElement;
  const emblemInput = document.getElementById('emblem') as HTMLInputElement;
  const letteringInput = document.getElementById('lettering') as HTMLInputElement;
  const showLengthDefault = () => {
    lengthInput.placeholder = String(DEFAULT_LENGTH[locoSelect.value as LocoKind] ?? 9);
  };
  locoSelect.addEventListener('change', showLengthDefault);
  const showStock = () => {
    locoSelect.value = stock.loco;
    carriagesInput.value = String(stock.carriages);
    lengthInput.value = stock.length === null ? '' : String(stock.length);
    showLengthDefault();
  };
  showStock();
  document.getElementById('rolling-apply')!.addEventListener('click', () => {
    const q = new URLSearchParams();
    q.set('train', locoSelect.value);
    q.set('carriages', carriagesInput.value);
    q.set('length', lengthInput.value);
    q.set('logo', stock.emblem); // (branding has its own section)
    q.set('lettering', stock.lettering);
    applyStock(parseStock(q.toString())); // parseStock clamps to the allowed ranges
    showStock();
  });
  // Enter in any of the fields applies, like submitting a form
  for (const el of [locoSelect, carriagesInput, lengthInput]) {
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        document.getElementById('rolling-apply')!.click();
      }
    });
  }
  document.getElementById('rolling-reset')!.addEventListener('click', () => {
    applyStock({ ...parseStock(''), emblem: stock.emblem, lettering: stock.lettering });
    showStock();
  });

  // Branding: applies as you type (coalesced to one rebuild per frame)
  const showBranding = () => {
    emblemInput.value = stock.emblem;
    letteringInput.value = stock.lettering;
  };
  showBranding();
  let pending = 0;
  for (const el of [emblemInput, letteringInput]) {
    el.addEventListener('input', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => applyBranding(emblemInput.value.trim(), letteringInput.value.trim()));
    });
  }
  document.getElementById('branding-reset')!.addEventListener('click', () => {
    applyBranding(DEFAULT_EMBLEM, DEFAULT_LETTERING);
    showBranding();
  });
}

const langSelect = document.getElementById('lang') as HTMLSelectElement;

// The panel can be folded away to just its heading and the pick button (from the
// start on a phone, upright or sideways, where it would cover most of the view)
{
  const hud = document.querySelector<HTMLElement>('.hud')!;
  const toggle = document.getElementById('hud-toggle') as HTMLButtonElement;
  const setCollapsed = (collapsed: boolean) => {
    hud.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    fitHudUnderBanner();
  };
  const small = matchMedia('(max-width: 600px), (max-height: 500px)'); // (a phone, upright or sideways)
  // (while the example names are still there, it stays open with People shown, so the
  // list gets filled in first)
  const defaultNames = () => state.names.join('\n') === DEFAULT_NAMES.join('\n');
  if (defaultNames()) (document.getElementById('settings') as HTMLDetailsElement).open = true;
  setCollapsed(small.matches && !defaultNames());
  toggle.addEventListener('click', () => setCollapsed(!hud.classList.contains('collapsed')));
  // (picking someone folds it away on a small screen, to watch the train go)
  document.getElementById('pick')!.addEventListener('click', () => {
    if (small.matches && !defaultNames()) setCollapsed(true);
  });
}

function applyLanguage(): void {
  translatePage();
  if (bannerText) banner.textContent = bannerText();
  if (!myName) updateHomeSign();
}

function redrawAllSigns(): void {
  for (const st of [...stations, ...(homeStation ? [homeStation] : [])]) drawSign(st, st.mode ?? 'normal', true);
}

function updateHomeSign(): void {
  if (!homeStation) return;
  homeStation.name = homeName();
  showHomeStation();
  // Your name may bring its own pills, which can shift the colour assignment.
  assignPillColors([...state.names, homeStation.name]);
  redrawAllSigns();
}

const meInput = document.getElementById('me') as HTMLInputElement;
meInput.value = myName;
meInput.addEventListener('input', () => {
  myName = meInput.value.trim();
  try {
    if (myName) localStorage.setItem(ME_KEY, myName);
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* storage unavailable */
  }
  updateHomeSign();
});

// Signs are first drawn with a fallback font; redraw once the sign font is in.
loadSignFonts()
  .then(redrawAllSigns)
  .catch((err) => console.warn('Sign font failed to load', err));

langPicker(langSelect, applyLanguage);

applyLanguage();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

state.pos = { on: 'branch', b: 0 }; // at the home station; buildWorld turns this into s
buildWorld();

// Dev server hot reload: state carried over from the module being replaced (only in
// memory, during the swap; a normal reload always starts fresh from the tunnel)
interface HotState {
  pos: TrainPos;
  picked: string[];
  removeAfterPick: boolean;
  camPos: number[];
  camTarget: number[];
  userMovedCamera: boolean;
  winner: string | null;
}
const hot = import.meta.hot?.data?.state as HotState | undefined;
if (hot) {
  state.pos = hot.pos;
  state.picked = new Set(hot.picked);
  state.removeAfterPick = hot.removeAfterPick;
  removeInput.checked = hot.removeAfterPick;
  state.s = posToS(state.pos);
  state.winner = stations.find((st) => st.name === hot.winner) ?? null;
  refreshStations();
  if (state.winner) {
    const name = parseLabel(state.winner.name).title;
    showBanner(() => t('banner.nextStop', { name }), false);
  }
  camera.position.fromArray(hot.camPos);
  controls.target.fromArray(hot.camTarget);
  userMovedCamera = hot.userMovedCamera;
  controls.update();
  // (driver's view: straight to leaning out if standing at someone's station, rather
  // than leaning out all over again)
  driverLean = state.winner ? 1 : 0;
}

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    if (state.run) finishRun(state.run);
    data.state = {
      pos: state.pos,
      picked: [...state.picked],
      removeAfterPick: state.removeAfterPick,
      camPos: camera.position.toArray(),
      camTarget: controls.target.toArray(),
      userMovedCamera,
      winner: state.winner?.name ?? null,
    } satisfies HotState;
    // Tear down: stop drawing, drop listeners (cloning the panel removes its element
    // listeners), free the GPU and remove the canvas
    renderer.setAnimationLoop(null);
    moduleListeners.abort();
    controls.dispose();
    const hud = document.querySelector('.hud')!;
    hud.replaceWith(hud.cloneNode(true));
    banner.hidden = true;
    // (fleet page: drop this module's panel; the new one reads the choices from the history state)
    if (fleetUI) {
      fleetUI.panel.remove();
      fleetUI.labels.remove();
    }
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    renderer.dispose();
    renderer.domElement.remove();
  });
}

// Opening: the train comes out of the tunnel and brakes to a stop at the home station
// (skipped after a dev server hot reload, which keeps the train where it was).
/** The train comes out of the tunnel and brakes to a stop at the home station. */
function startOpeningRun(): void {
  // Whole train round the bend inside the tunnel. In the driver's view, far enough
  // round it that the tunnel mouth is out of sight (the gentler the bend, the further:
  // ~6·√R), though never so far that the back of the train runs off the bend
  const R = state.radius;
  const into = cameraView === 'driver' ? THREE.MathUtils.clamp(6 * Math.sqrt(R), 6.15, (Math.PI / 2) * R - TRAIN_LENGTH - 2) : 6.15;
  const from = tunnelCurveX - into - TRAIN_FRONT;
  const delta = homeStartS - from;
  state.s = from;
  state.pos = sToPos(from);
  state.run = { from, delta, duration: 1.5 + delta / (8.2 * SPEED_SCALE), t: 0, winner: null, profile: 'brake' };
  // The pick button stays enabled: pressing it now queues a departure for when the train stops.
}
if (!hot) startOpeningRun();
placeTrain();

// Dev only: lets scripted screenshots (e.g. Playwright) aim the camera
if (import.meta.env.DEV) Object.assign(window, { __debug: { scene, camera, controls, state, joints: () => s423Joints, cars: () => cars.map((c) => ({ x: c.obj.position.x, z: c.obj.position.z, offset: c.offset })), stockCars: () => S423_CARS, desiroDoors: () => S423_CARS.map((c) => s423Doors(c).length).join(","), lintInfo: () => S423_CARS.map((c) => s423Doors(c).map((d) => d.toFixed(1)).join("/") + "@" + (c.cabFront ? bogieInset(c, true).toFixed(2) : "-")).join(" "), trainLength: () => TRAIN_LENGTH, cabWindowLen: () => cabWindowLen, insideSolid: (p: THREE.Vector3) => insideSolid(p), aTree: () => [...treeGrid.values()][5][0], groundHoles: () => { const ray = new THREE.Raycaster(); const meshes: THREE.Object3D[] = []; scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === groundMat) meshes.push(o); }); const R = state.radius; const out: string[] = []; const span = Math.max(656, R * 10) * 1.6; for (let i = 0; i < 200; i++) for (let j = 0; j < 200; j++) { const x = -span / 2 + (span * i) / 200 + 0.37; const z = -span / 2 + (span * j) / 200 + 0.21; ray.set(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)); if (!ray.intersectObjects(meshes, false).length) out.push(`${x.toFixed(0)},${z.toFixed(0)}`); } return out.length + " " + out.slice(0, 12).join(" "); }, flying: () => !!flight, terrainX: () => tunnelMouthX, platformView: (i: number) => platformView(stations[i]) } });

let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  let speed = 0;
  const run = state.run;
  if (run) {
    run.t += dt;
    const u = Math.min(run.t / run.duration, 1);
    const prev = state.s;
    const p = run.profile === 'brake' ? 1 - (1 - u) * (1 - u) : travelProfile(u);
    state.s = run.from + run.delta * p;
    state.pos = sToPos(state.s);
    speed = dt > 0 ? (state.s - prev) / dt : 0;
    // Platform view: once the train is close, the camera goes down to the picked
    // station's platform to watch it pull in
    // (PLATFORM_VIEW.lead seconds before it stops, flying down over PLATFORM_VIEW.flight)
    if (run.winner && !run.platformShown && cameraView === 'platform' && run.duration - run.t < PLATFORM_VIEW.lead) {
      run.platformShown = true;
      const view = platformView(run.winner);
      flyCamera(view.pos, view.target, PLATFORM_VIEW.flight);
    }
    if (u >= 1) finishRun(run);
  }

  placeTrain();
  updateSteam(dt, speed);
  updateConfetti(dt);
  updatePoints(dt);
  animateStations(now / 1000);
  if (cameraView === 'driver') {
    flight = null;
    driverView(dt);
  } else {
    updateFlight(dt);
    controls.update();
  }
  skipRequested = false;
  updateSnowfall(dt);
  updateRainfall(dt);
  updateFog();
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Fleet page (/fleet/): every train, side-on, at its possible lengths and carriage
// counts, built with the same code as the layout's train
// ---------------------------------------------------------------------------

const FLEET = /\/fleet\/?$/.test(location.pathname);
const FLEET_KINDS: LocoKind[] = ['compact', 'full', 'taurus', 'railjet', 's423', 'flirt', 'lint', 'desiro', 'kiss', 'rjkiss', 'allegra'];
const FLEET_COUNTS = Array.from({ length: 12 }, (_, i) => i + 1);
/** Lengths offered (besides each type's default). */
const FLEET_LENGTHS = Array.from({ length: (30 - MIN_LENGTH) / 2 + 1 }, (_, i) => MIN_LENGTH + 2 * i);
/** Height of each row: room for a raised pantograph. */
const FLEET_ROW = 7;

/** The fleet page's controls (so a hot reload can take them over). */
let fleetUI: { panel: HTMLElement; labels: HTMLElement; sels: HTMLSelectElement[] } | null = null;

function startFleet(): void {
  const fleetScene = new THREE.Scene();
  fleetScene.background = new THREE.Color(0xf4f6f8);
  fleetScene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f94, 1.6));
  const light = new THREE.DirectionalLight(0xffffff, 1.8);
  light.position.set(10, 20, 30);
  fleetScene.add(light);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  cam.position.set(0, 0, 50);
  const rows = new THREE.Group();
  fleetScene.add(rows);

  // Controls: a panel in place of the picker's (hidden, not removed: the picker's code
  // still looks its elements up, also after a hot reload)
  document.querySelector<HTMLElement>('.hud')!.style.display = 'none';
  // The choices are kept in the history entry's state (not the URL), so a reload shows the same
  const kept = (history.state as { fleet?: string[] } | null)?.fleet ?? [];
  const panel = document.createElement('div');
  panel.className = 'hud fleet-panel';
  const kindName = (k: LocoKind) => t(`stock.${k}` as MessageKey);
  // (texts carry data-i18n, so a change of language re-translates them: translatePage)
  const tr = <E extends HTMLElement>(el: E, key: MessageKey): E => {
    el.dataset.i18n = key;
    el.textContent = t(key);
    return el;
  };
  const option = (value: string, key?: MessageKey, text?: string) => {
    const o = new Option(text ?? '', value);
    if (key) tr(o, key);
    return o;
  };
  const select = (label: MessageKey, options: HTMLOptionElement[], initial: string) => {
    const field = document.createElement('label');
    field.className = 'field';
    const span = tr(document.createElement('span'), label);
    const sel = document.createElement('select');
    sel.add(option('all', 'fleet.all'));
    for (const o of options) sel.add(o);
    sel.value = initial;
    field.append(span, sel);
    panel.append(field);
    return sel;
  };
  const setTitle = () => (document.title = `${t('fleet.title')} - ${t('app.title')}`);
  setTitle();
  // Heading and the language picker, as on the main page's panel
  const headRow = document.createElement('div');
  headRow.className = 'hud-head';
  const head = tr(document.createElement('h1'), 'fleet.title');
  const langSel = document.createElement('select');
  langSel.dataset.i18nAriaLabel = 'app.language';
  headRow.append(head, langSel);
  panel.append(headRow);
  const kindSel = select('stock.train', FLEET_KINDS.map((k) => option(k, `stock.${k}` as MessageKey)), kept?.[0] ?? 'all');
  const countSel = select('stock.carriages', FLEET_COUNTS.map((n) => option(String(n), undefined, String(n))), kept?.[1] ?? '3');
  const lengthSel = select('stock.length', [option('default', 'fleet.default'), ...FLEET_LENGTHS.map((l) => option(String(l), undefined, `${l} m`))], kept?.[2] ?? 'default');
  // (a kept choice no longer offered falls back to the first option)
  for (const sel of [kindSel, countSel, lengthSel]) if (sel.selectedIndex < 0) sel.selectedIndex = 0;
  document.body.append(panel);
  const labels = document.createElement('div');
  labels.className = 'fleet-labels';
  document.body.append(labels);
  const sels = [kindSel, countSel, lengthSel];
  fleetUI = { panel, labels, sels };
  // ("All" in more than one list: keep the first, the others to their defaults)
  sels.forEach((sel, i) => {
    if (sel.value === 'all' && sels.slice(0, i).some((o) => o.value === 'all')) sel.value = ['all', '3', 'default'][i];
  });
  // "All" in one list only: it's offered in each while none of the others is on it
  const updateAll = () => {
    for (const sel of sels) (sel.options[0] as HTMLOptionElement).disabled = sels.some((o) => o !== sel && o.value === 'all');
  };

  let rowInfo: { y: number; loco: LocoKind; carriages: number; carLen: number; len: number }[] = [];
  let widest = 10;
  const fit = () => {
    const w = innerWidth;
    const h = innerHeight;
    const margin = 3;
    const left = -widest - margin;
    const right = margin;
    const top = FLEET_ROW + 1;
    const bottom = -FLEET_ROW * Math.max(rowInfo.length - 1, 0) - 1;
    // Fit both ways, keeping the aspect ratio
    const sx = (right - left) / w;
    const sy = (top - bottom) / h;
    const sc = Math.max(sx, sy);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    Object.assign(cam, { left: cx - (w * sc) / 2, right: cx + (w * sc) / 2, top: cy + (h * sc) / 2, bottom: cy - (h * sc) / 2 });
    cam.updateProjectionMatrix();
    labels.replaceChildren(
      ...rowInfo.map((r) => {
        const el = document.createElement('div');
        el.textContent = `${kindName(r.loco)} · ${r.carriages} × ${r.carLen} m · ${r.len.toFixed(1)} m`;
        // (above the train, right-aligned to its front: it never runs off the page's edge)
        const p = new THREE.Vector3(0, r.y + 5.2, 0).project(cam);
        el.style.left = `${((p.x + 1) / 2) * w}px`;
        el.style.top = `${((1 - p.y) / 2) * h}px`;
        return el;
      }),
    );
  };

  let generation = 0;
  const build = async () => {
    const gen = ++generation;
    updateAll();
    for (const c of [...rows.children]) {
      rows.remove(c);
      disposeTree(c);
    }
    const pick = <T,>(sel: HTMLSelectElement, all: T[], one: (v: string) => T) => (sel.value === 'all' ? all : [one(sel.value)]);
    const kinds = pick(kindSel, FLEET_KINDS, (v) => v as LocoKind);
    const counts = pick(countSel, FLEET_COUNTS, Number);
    const lengths = pick<number | null>(lengthSel, [null, ...FLEET_LENGTHS], (v) => (v === 'default' ? null : Number(v)));
    await loadLetterFont();
    rowInfo = [];
    widest = 10;
    trackOverride = (sx: number) => ({ x: sx, z: 0, yaw: 0 });
    let i = 0;
    for (const loco of kinds) {
      for (const carriages of counts) {
        for (const length of lengths) {
          if (gen !== generation) return; // (changed again meanwhile)
          stock = { ...stock, loco, carriages, length };
          deriveStock();
          buildTrain();
          state.s = -TRAIN_FRONT; // (the front of the train at x = 0)
          placeTrain();
          const row = new THREE.Group();
          row.position.y = -i * FLEET_ROW;
          rows.add(row);
          for (const o of [...cars.map((c) => c.obj), ...couplings, ...gangwayLinks.map((l) => l.mesh), ...s423Joints]) row.add(o);
          cars = [];
          couplings = [];
          gangwayLinks = [];
          s423Joints = [];
          s423JointCars = [];
          widest = Math.max(widest, TRAIN_LENGTH);
          rowInfo.push({ y: -i * FLEET_ROW, loco, carriages, carLen: stockLength(stock), len: TRAIN_LENGTH });
          i++;
          // Let this train's lettering (added once the font's promise settles) be made
          // while the globals are still set for it
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    // A length of track under each train: the near rail
    const railMat = mat(0x4a4f55, { metalness: 0.4, roughness: 0.5 });
    const from = -widest - 2;
    const to = 2;
    for (const row of rows.children) {
      const track = new THREE.Group();
      track.add(box(to - from, RAIL_H, RAIL_W, railMat, (from + to) / 2, RAIL_Y, RAIL_HALF_GAUGE));
      row.add(track);
    }
    fit();
  };
  const remember = () => history.replaceState({ ...(history.state ?? {}), fleet: sels.map((sel) => sel.value) }, '');
  for (const sel of sels) {
    sel.addEventListener('change', () => {
      remember();
      build();
    });
  }
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    fit();
  }, { signal: moduleListeners.signal });
  langPicker(langSel, () => {
    setTitle(); // (translatePage just set the main page's)
    fit(); // (the row labels)
  });
  renderer.setAnimationLoop(() => renderer.render(fleetScene, cam));
  build();
}
if (FLEET) startFleet();
