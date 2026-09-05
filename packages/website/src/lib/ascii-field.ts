// The ASCII field's frames: a few sine waves sampled onto a density ramp, one
// character per cell. Pure, so the component's script only draws what it gets
// back, and a frame can be checked without a browser.

/** Characters from empty to dense; a frame is made of these only. */
export const RAMP = "  ..::--==++3377$€£₴¥";

/** One character cell in CSS px: IBM Plex Mono at `font` px has this advance width; `height` is the line. */
export const CELL = { font: 11, width: 6.6, height: 14 } as const;

/** The most device pixels per CSS pixel the field is drawn at: past 2 the
 *  extra sharpness is invisible in a dim 11px glyph and the bitmap only
 *  costs memory and fill time. */
const MAX_SCALE = 2;

/** How many cells cover a box of `width` x `height` px. */
export function cellsFor(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.ceil(width / CELL.width), rows: Math.ceil(height / CELL.height) };
}

/** The bitmap behind a canvas of `width` x `height` CSS px on a screen with
 *  `devicePixelRatio` device pixels per CSS pixel: its size in device pixels,
 *  and the scale the drawing context needs so CSS px coordinates land right. */
export function backingSize(
  width: number,
  height: number,
  devicePixelRatio: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(Math.max(devicePixelRatio, 1), MAX_SCALE);
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

/** One frame of `cols` x `rows` cells at time `t` in seconds: one string per row. */
export function renderAsciiFrame(cols: number, rows: number, t: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    // The character cell is ~2x taller than wide; scale y so blobs stay round.
    const gy = y * 2.1;
    let line = "";
    for (let x = 0; x < cols; x++) {
      const v =
        Math.sin(x * 0.052 + gy * 0.041 + t * 0.7) +
        Math.sin(x * 0.031 - gy * 0.067 - t * 0.5) +
        Math.sin(x * 0.083 + gy * 0.023 + t * 0.35) +
        Math.sin(x * 0.017 + gy * 0.052 - t * 0.85);
      // A per-cell hash breaks up flat runs into grainy cloud edges.
      const grain = Math.sin(x * 12.9898 + y * 78.233) * 0.9;
      // Bias toward empty so the field reads as drifting clouds, not a wall.
      const index = Math.round(((v + grain + 4.9) / 9.8) * (RAMP.length - 1) * 2 - RAMP.length * 0.65);
      line += RAMP[Math.max(0, Math.min(index, RAMP.length - 1))];
    }
    lines.push(line);
  }
  return lines;
}
