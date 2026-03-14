import chalk from "chalk";
import type { EditorTheme, MarkdownTheme, SelectListTheme } from "@mariozechner/pi-tui";

export interface Theme {
  editor: EditorTheme;
  markdown: MarkdownTheme;
}

export function createTheme(): Theme {
  const selectList: SelectListTheme = {
    selectedPrefix: (t) => chalk.cyan(t),
    selectedText: (t) => chalk.cyan(t),
    description: (t) => chalk.dim(t),
    scrollInfo: (t) => chalk.dim(t),
    noMatch: (t) => chalk.dim(t),
  };

  const editor: EditorTheme = {
    borderColor: (t) => chalk.dim(t),
    selectList,
  };

  const markdown: MarkdownTheme = {
    heading: (t) => chalk.bold.cyan(t),
    link: (t) => chalk.blue(t),
    linkUrl: (t) => chalk.dim.blue(t),
    code: (t) => chalk.yellow(t),
    codeBlock: (t) => chalk.white(t),
    codeBlockBorder: (t) => chalk.dim(t),
    quote: (t) => chalk.italic(t),
    quoteBorder: (t) => chalk.dim(t),
    hr: (t) => chalk.dim(t),
    listBullet: (t) => chalk.cyan(t),
    bold: (t) => chalk.bold(t),
    italic: (t) => chalk.italic(t),
    strikethrough: (t) => chalk.strikethrough(t),
    underline: (t) => chalk.underline(t),
  };

  return { editor, markdown };
}
