import { extname } from "node:path";
import { fileTypeFromBuffer } from "file-type";

const EXT_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export async function detectMimeType(buffer: Buffer, filePath: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) return detected.mime;

  const ext = extname(filePath).toLowerCase();
  return EXT_MIME_MAP[ext] ?? "application/octet-stream";
}
