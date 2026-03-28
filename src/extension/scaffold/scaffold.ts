import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ACCOUNTANT24_HOME } from "../config.js";

const TEMPLATE_DIR = join(import.meta.dirname, "template");

function writeIfNotExists(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content);
  }
}

function collectTemplateFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectTemplateFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

export function ensureScaffolded(baseDir?: string): void {
  const home = baseDir ?? ACCOUNTANT24_HOME;

  for (const dir of ["ledger", "sessions"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }

  for (const templatePath of collectTemplateFiles(TEMPLATE_DIR)) {
    const relPath = relative(TEMPLATE_DIR, templatePath);
    const outputPath = join(home, relPath);
    mkdirSync(join(outputPath, ".."), { recursive: true });
    writeIfNotExists(outputPath, readFileSync(templatePath, "utf-8"));
  }
}
