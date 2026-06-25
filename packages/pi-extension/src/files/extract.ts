import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectMimeType } from "./mime";

export interface ExtractFileResult {
  filePath: string;
  mimeType: string;
  pageCount?: number;
  text: string;
}

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

const MIN_CHARS_PER_PAGE = 50;

export async function extractFile(filePath: string): Promise<ExtractFileResult> {
  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  const mimeType = await detectMimeType(buffer, filePath);

  let text: string;
  let pageCount: number | undefined;

  if (mimeType === "application/pdf") {
    const result = await extractPdf(filePath);
    text = result.text;
    pageCount = result.pageCount;
  } else if (SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    text = await ocrImage(filePath);
  } else {
    const supported = ["application/pdf", ...SUPPORTED_IMAGE_TYPES].join(", ");
    throw new Error(`Unsupported file type: ${mimeType}. Supported: ${supported}.`);
  }

  return { filePath, mimeType, pageCount, text };
}

async function extractPdf(filePath: string): Promise<{ text: string; pageCount: number }> {
  const raw = await runPdftotext(filePath);

  // pdftotext separates pages with \f (form feed), with a trailing \f
  const pages = raw.split("\f");
  if (pages.length > 0 && pages[pages.length - 1].trim() === "") {
    pages.pop();
  }

  const pageCount = Math.max(pages.length, 1);
  const totalChars = pages.reduce((sum, p) => sum + p.trim().length, 0);
  const avgCharsPerPage = totalChars / pageCount;

  if (avgCharsPerPage >= MIN_CHARS_PER_PAGE) {
    const formatted = pages.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`).join("\n\n");
    return { text: formatted, pageCount };
  }

  return await ocrPdfPages(filePath, pageCount);
}

async function ocrPdfPages(filePath: string, pageCount: number): Promise<{ text: string; pageCount: number }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "ocr-"));
  try {
    const ocrPages: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const imgPrefix = join(tmpDir, "page");
      await runPdftocairo(filePath, imgPrefix, i);
      const text = await runTesseract(`${imgPrefix}.png`);
      ocrPages.push(`--- Page ${i} (OCR) ---\n${text}`);
    }
    return { text: ocrPages.join("\n\n"), pageCount };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function ocrImage(filePath: string): Promise<string> {
  try {
    return await runTesseract(filePath);
  } catch {
    return "";
  }
}

// ── CLI helpers ────────────────────────────────────────────────────────

async function runPdftotext(filePath: string): Promise<string> {
  return await runCli(["pdftotext", filePath, "-"], "pdftotext");
}

async function runPdftocairo(filePath: string, outputPrefix: string, page: number): Promise<void> {
  await runCli(
    ["pdftocairo", "-png", "-r", "300", "-f", String(page), "-l", String(page), "-singlefile", filePath, outputPrefix],
    "pdftocairo",
  );
}

async function runTesseract(imagePath: string): Promise<string> {
  return await runCli(["tesseract", imagePath, "stdout", "-l", "eng"], "tesseract");
}

const BREW_PACKAGE: Record<string, string> = {
  tesseract: "tesseract",
  pdftotext: "poppler",
  pdftocairo: "poppler",
};

async function runCli(cmd: string[], name: string): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`${name} exited with code ${exitCode}: ${stderr.trim()}`);
    }

    return stdout.trim();
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      const pkg = BREW_PACKAGE[name] ?? name;
      throw new Error(`${name} CLI not found. Install via: brew install ${pkg}`);
    }
    throw err;
  }
}
