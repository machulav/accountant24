const TITLE = "Accountant24";

export function buildLogoLine(width: number): string {
  const prefixLen = 2 + 1 + TITLE.length + 1;
  const fillLen = Math.max(0, width - prefixLen);
  return `── ${TITLE} ${"─".repeat(fillLen)}`;
}
