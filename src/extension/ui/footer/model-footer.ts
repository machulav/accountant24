import type { Theme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface AutocompleteAware {
  isShowingAutocomplete(): boolean;
}

export class ModelFooter implements Component {
  private modelName = "";
  private editor: AutocompleteAware | null = null;

  constructor(
    private tui: TUI,
    private theme: Theme,
  ) {}

  setEditor(editor: AutocompleteAware): void {
    this.editor = editor;
  }

  setModel(name: string): void {
    this.modelName = name;
    this.tui.requestRender(true);
  }

  invalidate(): void {}

  dispose(): void {}

  render(width: number): string[] {
    if (!this.modelName) return [];
    if (this.editor?.isShowingAutocomplete()) return [];
    const styled = this.theme.fg("dim", this.modelName);
    const pad = Math.max(0, width - visibleWidth(styled));
    return [truncateToWidth(`${" ".repeat(pad)}${styled}`, width)];
  }
}
