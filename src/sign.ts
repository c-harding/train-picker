// Station name boards in the style of DB station signs: a dark blue board with
// the name in white and the lines serving it as coloured pills on the right.

import '@fontsource/fira-sans/600.css';
import '@fontsource/fira-sans/700.css';

/** Fira Sans: the closest open font to DB's signage typeface in look and feel. */
const FONT_FAMILY = 'Fira Sans';

export async function loadSignFonts(): Promise<void> {
  // Fontsource splits the font by script; load the Latin ranges names will use.
  const sample = 'AaZzÄäÖöÜüßÉéŁłŚśČčĞğ0123456789';
  await Promise.all([
    document.fonts.load(`600 92px "${FONT_FAMILY}"`, sample),
    document.fonts.load(`700 40px "${FONT_FAMILY}"`, sample),
  ]);
}

const font = (weight: number, px: number) => `${weight} ${px}px "${FONT_FAMILY}", system-ui, sans-serif`;

const COLORS = {
  board: '#0c1a63',
  text: '#f2f2f2',
  doneBoard: '#4b5263',
  doneText: '#aab0bc',
  highlight: '#ffd800',
};

// Pill colours: well separated hues that all carry white text and stand out
// against the dark blue board.
const C = {
  green: '#1f9d3a',
  red: '#d0142c',
  purple: '#7b2d9b',
  orange: '#e86a10',
  blue: '#0a7cc4',
  teal: '#00877a',
  magenta: '#d1237f',
  lime: '#6a8f00',
  slate: '#5c6f84',
  gold: '#b58900',
};
/** Preferred colour for a numbered line, so e.g. S1 is green and S2 red when possible. */
const BY_NUMBER = [C.green, C.red, C.purple, C.orange, C.blue, C.teal, C.magenta, C.lime, C.slate, C.gold];
/** Order in which free colours are handed out: each as different as possible from those before. */
const MOST_DISTINCT = [C.red, C.green, C.blue, C.orange, C.purple, C.teal, C.magenta, C.lime, C.slate, C.gold];

let assigned = new Map<string, string>();

function hashColor(label: string): string {
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return MOST_DISTINCT[((h % MOST_DISTINCT.length) + MOST_DISTINCT.length) % MOST_DISTINCT.length];
}

/**
 * Give every distinct pill label in the list its own colour (as long as there
 * are colours left): numbered lines get their usual colour unless it is taken,
 * the rest get the most distinct colours still free.
 */
export function assignPillColors(rawNames: string[]): void {
  const labels = [...new Set(rawNames.flatMap((n) => parseLabel(n).pills))];
  const num = (l: string) => /(\d+)$/.exec(l)?.[1];
  const numbered = labels.filter(num).sort((a, b) => Number(num(a)) - Number(num(b)) || a.localeCompare(b));
  const others = labels.filter((l) => !num(l)).sort((a, b) => a.localeCompare(b));
  const used = new Set<string>();
  const map = new Map<string, string>();
  const give = (label: string, preferred?: string) => {
    const color =
      (preferred && !used.has(preferred) ? preferred : MOST_DISTINCT.find((c) => !used.has(c))) ?? hashColor(label);
    used.add(color);
    map.set(label, color);
  };
  for (const l of numbered) give(l, BY_NUMBER[(Number(num(l)) - 1 + BY_NUMBER.length * 100) % BY_NUMBER.length]);
  for (const l of others) give(l);
  assigned = map;
}

export function pillColor(label: string): string {
  return assigned.get(label) ?? hashColor(label);
}

export interface StationLabel {
  title: string;
  pills: string[];
}

/** "Lukas [S1] [S2]" → { title: "Lukas", pills: ["S1", "S2"] } */
export function parseLabel(raw: string): StationLabel {
  const pills: string[] = [];
  let title = raw.trim();
  const trailingPill = /\s*\[([^[\]]+)\]\s*$/;
  for (let m = trailingPill.exec(title); m; m = trailingPill.exec(title)) {
    pills.unshift(m[1].trim());
    title = title.slice(0, m.index).trimEnd();
  }
  return { title: title || raw.trim(), pills: title ? pills : [] };
}

export type SignMode = 'normal' | 'winner' | 'done';

const H = 160;
const PAD_X = 44;
const TITLE_PX = 92;
const PILL_W = 150; // constant width, whatever the label
const PILL_H = 78;
const PILL_GAP = 18;
const TITLE_TO_PILLS = 36;
const MAX_W = 1400;

/** Draws a board for the given station name, sized to fit its text. */
export function drawSignCanvas(raw: string, mode: SignMode): HTMLCanvasElement {
  const { title, pills } = parseLabel(raw);
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;

  // Measure first, shrinking very long names, then size the canvas to fit.
  const pillsW = pills.length ? TITLE_TO_PILLS + pills.length * PILL_W + (pills.length - 1) * PILL_GAP : 0;
  let titlePx = TITLE_PX;
  ctx.font = font(600, titlePx);
  let titleW = ctx.measureText(title).width;
  while (PAD_X * 2 + titleW + pillsW > MAX_W && titlePx > 40) {
    titlePx -= 4;
    ctx.font = font(600, titlePx);
    titleW = ctx.measureText(title).width;
  }
  c.width = Math.ceil(Math.max(260, PAD_X * 2 + titleW + pillsW));
  c.height = H;
  const w = c.width;

  const done = mode === 'done';
  ctx.fillStyle = done ? COLORS.doneBoard : COLORS.board;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, H, 10);
  ctx.fill();

  if (mode === 'winner') {
    ctx.strokeStyle = COLORS.highlight;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, H - 12, 6);
    ctx.stroke();
  }

  // Name, left-aligned like the real boards
  const midY = H / 2;
  ctx.font = font(600, titlePx);
  ctx.fillStyle = done ? COLORS.doneText : COLORS.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, PAD_X, midY + titlePx * 0.04);
  if (done) {
    ctx.strokeStyle = COLORS.doneText;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(PAD_X, midY);
    ctx.lineTo(PAD_X + titleW, midY);
    ctx.stroke();
  }

  // Line pills
  let x = PAD_X + titleW + TITLE_TO_PILLS;
  for (const label of pills) {
    ctx.globalAlpha = done ? 0.5 : 1;
    ctx.fillStyle = pillColor(label);
    ctx.beginPath();
    ctx.roundRect(x, midY - PILL_H / 2, PILL_W, PILL_H, PILL_H / 2);
    ctx.fill();
    let px = 56;
    ctx.font = font(700, px);
    while (ctx.measureText(label).width > PILL_W - 28 && px > 24) {
      px -= 2;
      ctx.font = font(700, px);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + PILL_W / 2, midY + 2);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    x += PILL_W + PILL_GAP;
  }
  return c;
}
