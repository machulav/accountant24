// Skills and the app's bundled documentation are read with pi's generic tools:
// a skill activates by reading its SKILL.md, and the documentation is reached
// through the ACCOUNTANT24_DOCS env var (a bash `cat "$ACCOUNTANT24_DOCS/<page>.md"`,
// or a read of the resolved path under the app's resources/docs). The renderer
// has no paths of its own, so both are recognized from the call's target alone,
// like memory (memory-tool.ts). A miss is cosmetic (the call keeps its generic
// Read File / Run Command label), never broken.
function pathArg(args: unknown): string | undefined {
  const { path, file_path } = (args ?? {}) as { path?: unknown; file_path?: unknown };
  const raw = path ?? file_path;
  return typeof raw === "string" ? raw : undefined;
}

/** The skill folder name when the call reads a skill's SKILL.md, else undefined. */
export function skillReadName(toolName: string, args: unknown): string | undefined {
  if (toolName !== "read") return undefined;
  const segments = pathArg(args)?.split(/[\\/]/) ?? [];
  if (segments.at(-1) !== "SKILL.md") return undefined;
  return segments.at(-2) ?? "";
}

// Dev: packages/desktop/resources/docs; packaged: <app>/Contents/Resources/docs
// on macOS, <app>/resources/docs elsewhere.
const DOCS_DIR_SEGMENT = /\/resources\/docs\/([^/]+)$/i;
const DOCS_ENV_REFERENCE = /\$\{?ACCOUNTANT24_DOCS\b\}?/;
// Every page path spelled after the env var in a shell command; a page name
// ends at whitespace or shell punctuation.
const DOCS_ENV_PAGE = /\$\{?ACCOUNTANT24_DOCS\}?\/([^\s"'`;|&)<>]+)/g;

/** The documentation page name from a file name: `settings.md` → `settings`. */
const pageName = (file: string) => file.replace(/\.md$/i, "");

/** The documentation pages a call reads, as bare page names (`settings`), when
 *  the call targets the bundled docs; undefined when it does not. Empty when
 *  the docs are touched without a page (`echo $ACCOUNTANT24_DOCS`). */
export function docsReadPages(toolName: string, args: unknown): string[] | undefined {
  if (toolName === "read") {
    const match = pathArg(args)?.replace(/\\/g, "/").match(DOCS_DIR_SEGMENT);
    return match ? [pageName(match[1])] : undefined;
  }
  if (toolName === "bash") {
    const { command } = (args ?? {}) as { command?: unknown };
    if (typeof command !== "string" || !DOCS_ENV_REFERENCE.test(command)) return undefined;
    const pages = [...command.matchAll(DOCS_ENV_PAGE)].map((m) => pageName(m[1].split("/").at(-1) ?? ""));
    return [...new Set(pages)];
  }
  return undefined;
}
