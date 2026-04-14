import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import Tesseract from "tesseract.js";
import { definePDFJSModule, extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { FILES_DIR } from "../config";

export interface ExtractFileResult {
  storedPath: string;
  originalPath: string;
  mimeType: string;
  pageCount?: number;
  text: string;
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

const MIN_CHARS_PER_PAGE = 50;

const EXT_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

let pdfjsConfigured = false;

export async function extractFile(filePath: string): Promise<ExtractFileResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const buffer = await readFile(filePath);
  const mimeType = await detectMimeType(buffer, filePath);

  let text: string;
  let pageCount: number | undefined;

  if (mimeType === "application/pdf") {
    const result = await extractPdf(buffer);
    text = result.text;
    pageCount = result.pageCount;
  } else if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    text = await ocrImage(buffer);
  } else {
    const supported = ["application/pdf", ...SUPPORTED_IMAGE_TYPES].join(", ");
    throw new Error(`Unsupported file type: ${mimeType}. Supported: ${supported}.`);
  }

  const storedPath = storeFile(filePath, buffer);
  return { storedPath, originalPath: filePath, mimeType, pageCount, text };
}

async function detectMimeType(buffer: Buffer, filePath: string): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) return detected.mime;

  const ext = extname(filePath).toLowerCase();
  return EXT_MIME_MAP[ext] ?? "application/octet-stream";
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  const data = new Uint8Array(buffer);
  const { totalPages, text: pages } = await extractText(data, { mergePages: false });

  const totalChars = pages.reduce((sum, p) => sum + p.trim().length, 0);
  const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0;

  if (avgCharsPerPage >= MIN_CHARS_PER_PAGE) {
    const formatted = pages.map((pageText, i) => `--- Page ${i + 1} ---\n${pageText.trim()}`).join("\n\n");
    return { text: formatted, pageCount: totalPages };
  }

  return await ocrPdfPages(buffer, totalPages);
}

async function ocrPdfPages(buffer: Buffer, pageCount: number): Promise<{ text: string; pageCount: number }> {
  await ensurePdfjsPolyfills();
  if (!pdfjsConfigured) {
    await definePDFJSModule(() => import("pdfjs-dist"));
    pdfjsConfigured = true;
  }
  const doc = await getDocumentProxy(new Uint8Array(buffer));

  const worker = await Tesseract.createWorker("eng");
  try {
    const ocrPages: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const pngBuffer = await renderPageAsImage(doc, i, {
        scale: 2.0,
        canvasImport: () => import("@napi-rs/canvas"),
      });
      const {
        data: { text },
      } = await worker.recognize(Buffer.from(pngBuffer));
      ocrPages.push(`--- Page ${i} (OCR) ---\n${text.trim()}`);
    }
    return { text: ocrPages.join("\n\n"), pageCount };
  } finally {
    await worker.terminate();
  }
}

async function ocrImage(buffer: Buffer): Promise<string> {
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(buffer, "eng", { errorHandler: () => {} });
    return text.trim();
  } catch {
    return "";
  }
}

async function ensurePdfjsPolyfills(): Promise<void> {
  if (typeof globalThis.DOMMatrix !== "undefined") return;

  const canvas = await import("@napi-rs/canvas");
  // @ts-expect-error — polyfilling browser globals for pdfjs-dist
  globalThis.DOMMatrix = canvas.DOMMatrix;
  globalThis.DOMRect = canvas.DOMRect;
  globalThis.DOMPoint = canvas.DOMPoint;
  // @ts-expect-error
  globalThis.Path2D = canvas.Path2D;
  // @ts-expect-error
  globalThis.ImageData = canvas.ImageData;
}

function storeFile(originalPath: string, buffer: Buffer): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  const dir = join(FILES_DIR, year, month);
  mkdirSync(dir, { recursive: true });

  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  const name = `${timestamp}_${basename(originalPath)}`;
  const storedPath = deduplicatePath(dir, name);
  writeFileSync(storedPath, buffer);

  return storedPath;
}

function deduplicatePath(dir: string, name: string): string {
  const target = join(dir, name);
  if (!existsSync(target)) return target;

  const ext = extname(name);
  const base = ext.length > 0 ? name.slice(0, -ext.length) : name;

  for (let counter = 2; counter <= 1000; counter++) {
    const candidate = join(dir, `${base}-${counter}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Too many files with the same name: ${name}`);
}
