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

/** The path segments of a SKILL.md the call reads, else undefined. */
function skillReadSegments(toolName: string, args: unknown): string[] | undefined {
  if (toolName !== "read") return undefined;
  const segments = pathArg(args)?.split(/[\\/]/) ?? [];
  return segments.at(-1) === "SKILL.md" ? segments : undefined;
}

/** The skill folder name when the call reads a skill's SKILL.md, else undefined. */
export function skillReadName(toolName: string, args: unknown): string | undefined {
  const segments = skillReadSegments(toolName, args);
  return segments && (segments.at(-2) ?? "");
}

/** The skill's `<plugin>:<skill>` name when the call reads a SKILL.md inside a
 *  plugin (`plugins/<plugin>/skills/<skill>/SKILL.md`, the plugin folder being
 *  the plugin's name), the bare folder name for a SKILL.md anywhere else, and
 *  undefined when the call is not a skill read. */
export function skillReadQualifiedName(toolName: string, args: unknown): string | undefined {
  const segments = skillReadSegments(toolName, args);
  if (!segments) return undefined;
  const [plugins, plugin, skills, skill] = segments.slice(-5, -1);
  if (plugins === "plugins" && plugin && skills === "skills" && skill) return `${plugin}:${skill}`;
  return segments.at(-2) ?? "";
}

// Dev: packages/desktop/resources/docs; packaged: <app>/Contents/Resources/docs
// on macOS, <app>/resources/docs elsewhere.
const DOCS_DIR_SEGMENT = /\/resources\/docs\/[^/]+$/i;
const DOCS_ENV_REFERENCE = /\$\{?ACCOUNTANT24_DOCS\b\}?/;

/** Whether the call reads the bundled documentation: a file under the docs
 *  folder with the read tool, or a command spelling `$ACCOUNTANT24_DOCS`. */
export function isDocsReadCall(toolName: string, args: unknown): boolean {
  if (toolName === "read") {
    const path = pathArg(args);
    return path !== undefined && DOCS_DIR_SEGMENT.test(path.replace(/\\/g, "/"));
  }
  if (toolName === "bash") {
    const { command } = (args ?? {}) as { command?: unknown };
    return typeof command === "string" && DOCS_ENV_REFERENCE.test(command);
  }
  return false;
}
