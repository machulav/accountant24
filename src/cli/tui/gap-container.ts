import { Container } from "@mariozechner/pi-tui";

export class GapContainer extends Container {
  private gap: number;
  private trailingGap: number;
  constructor(gap: number = 1, trailingGap: number = 0) {
    super();
    this.gap = gap;
    this.trailingGap = trailingGap;
  }
  render(width: number): string[] {
    const lines: string[] = [];
    let hasContent = false;
    for (const child of this.children) {
      const childLines = child.render(width);
      // Strip leading/trailing empty lines — GapContainer owns all spacing
      let start = 0;
      while (start < childLines.length && childLines[start] === "") start++;
      let end = childLines.length;
      while (end > start && childLines[end - 1] === "") end--;
      if (start >= end) continue;
      const trimmed = childLines.slice(start, end);
      if (hasContent && this.gap > 0) {
        for (let g = 0; g < this.gap; g++) lines.push("");
      }
      lines.push(...trimmed);
      hasContent = true;
    }
    if (hasContent && this.trailingGap > 0) {
      for (let g = 0; g < this.trailingGap; g++) lines.push("");
    }
    return lines;
  }
}
