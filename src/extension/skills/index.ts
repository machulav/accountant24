/**
 * Absolute path to the built-in skills directory that ships with the
 * accountant24 extension. pi-coding-agent's DefaultResourceLoader scans
 * this directory for subdirectories containing SKILL.md.
 *
 * Add new built-in skills as sibling directories (e.g. ./foo/SKILL.md);
 * no code changes are required — discovery is automatic.
 */
export function getBuiltinSkillsDir(): string {
  return import.meta.dirname;
}
