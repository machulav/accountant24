// The 404 page names the address that was asked for, so a typo is visible at
// a glance. Pure, so the page's script stays a few lines and the rules are
// unit-tested.

/** Longest path worth quoting; anything longer (crawler probes, tracking junk) reads as noise. */
const MAX_LENGTH = 80;

/**
 * The path to quote in the sentence, decoded for reading, or null when the
 * generic wording ("this address") reads better: the site root, an empty
 * path, or one too long to sit in a sentence.
 */
export function missingPathLabel(pathname: string): string | null {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // A malformed escape: quote the raw path rather than nothing.
  }
  if (path === "" || path === "/" || path.length > MAX_LENGTH) return null;
  return path;
}
