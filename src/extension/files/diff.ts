import { diffLines } from "diff";

/**
 * Generate a diff string in the format expected by pi-coding-agent's `renderDiff()`:
 * `+{lineNum} {content}`, `-{lineNum} {content}`, ` {lineNum} {content}`, ` {pad} ...`
 *
 * The context/skip logic is required because `renderDiff` only colorizes — it doesn't
 * compute context windows. The `diff` package gives raw hunks, so we format them here.
 */
export function generateDiff(oldContent: string, newContent: string, ctx = 4): string {
  const parts = diffLines(oldContent, newContent);
  const w = String(Math.max(oldContent.split("\n").length, newContent.split("\n").length)).length;
  const out: string[] = [];
  let oln = 1;
  let nln = 1;
  let changed = false;

  const line = (prefix: string, num: number, text: string) => out.push(`${prefix}${String(num).padStart(w)} ${text}`);
  const dots = () => out.push(` ${"".padStart(w)} ...`);

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const lines = p.value.endsWith("\n") ? p.value.slice(0, -1).split("\n") : p.value.split("\n");

    if (p.added) {
      for (const l of lines) line("+", nln++, l);
      changed = true;
    } else if (p.removed) {
      for (const l of lines) line("-", oln++, l);
      changed = true;
    } else {
      const next = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
      const show = (l: string) => {
        line(" ", oln++, l);
        nln++;
      };
      const advance = (n: number) => {
        dots();
        oln += n;
        nln += n;
      };

      const head = changed ? Math.min(ctx, lines.length) : 0;
      const tail = next ? Math.min(ctx, lines.length - head) : 0;
      const skip = lines.length - head - tail;

      lines.slice(0, head).forEach(show);
      if (skip > 0 && (changed || next)) advance(skip);
      else {
        oln += skip;
        nln += skip;
      }
      lines.slice(lines.length - tail).forEach(show);
      changed = false;
    }
  }
  return out.join("\n");
}
