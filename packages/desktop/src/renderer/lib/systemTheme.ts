// Keeps the shadcn `.dark` class on <html> in sync with the OS appearance.
// The theme tokens in index.css switch on that class; Electron's renderer
// matchMedia follows nativeTheme, so no main-process wiring is needed.

export function syncSystemTheme(): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", media.matches);
  apply();
  media.addEventListener("change", apply);
}
