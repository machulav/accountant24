// The ASCII field's frames: a few sine waves sampled onto a density ramp, one
// character per cell. Pure, so the first frame can be rendered at build time
// (the field then paints with the HTML, before any script runs) and the
// component's script draws the following ones with the same function.

/** Characters from empty to dense; a frame is made of these only. */
export const RAMP = "  ..::--==++3377$€£₴¥";

/** One character cell in CSS px: the 11px IBM Plex Mono advance width and the line height. */
const CELL = { width: 6.6, height: 14 } as const;

/** How many cells cover a box of `width` x `height` px. */
export function cellsFor(width: number, height: number): { cols: number; rows: number } {
  return { cols: Math.ceil(width / CELL.width), rows: Math.ceil(height / CELL.height) };
}

/** One frame of `cols` x `rows` cells at time `t` in seconds, every row ending in a newline. */
export function renderAsciiFrame(cols: number, rows: number, t: number): string {
  let out = "";
  for (let y = 0; y < rows; y++) {
    // The character cell is ~2x taller than wide; scale y so blobs stay round.
    const gy = y * 2.1;
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
      out += RAMP[Math.max(0, Math.min(index, RAMP.length - 1))];
    }
    out += "\n";
  }
  return out;
}
