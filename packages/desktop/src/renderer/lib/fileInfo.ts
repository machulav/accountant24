// Display metadata for attachment cards, derived from a filename: the type
// label shown under the name, a coarse kind for picking an icon, and a human
// file size. Framework-free so both the composer (which knows the byte size)
// and the message renderer (which only has the name) share one vocabulary.

/** Lowercase extension of a filename, or "" when there is none. Hidden files
 *  (".env") and trailing dots don't count as extensions. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot + 1);
  return /^[a-z0-9]{1,8}$/i.test(ext) ? ext.toLowerCase() : "";
}

/** Uppercase type label for the card's description line ("PDF"), or "" when
 *  the name carries no extension. */
export function fileTypeLabel(name: string): string {
  return extensionOf(name).toUpperCase();
}

export type FileKind = "document" | "spreadsheet" | "image";

const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "numbers", "ods"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "svg",
  "tif",
  "tiff",
]);

/** Coarse bucket for choosing the card's icon. Image kinds still occur for
 *  files: formats the model can't read (heic, svg, …) travel as files. */
export function fileKind(name: string): FileKind {
  const ext = extensionOf(name);
  if (SPREADSHEET_EXTENSIONS.has(ext)) return "spreadsheet";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  return "document";
}

/** Human file size in decimal units, macOS-style: "532 B", "245 KB", "1.2 MB". */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded =
    unit === 0 ? String(value) : value >= 9.95 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${units[unit]}`;
}
