import chalk from "chalk";
import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
} from "@mariozechner/pi-tui";

export interface AppTheme {
  logo: (s: string) => string;
  logoTagline: (s: string) => string;
  userMessage: (s: string) => string;
  loaderActive: (s: string) => string;
  loaderInactive: (s: string) => string;
  toolIcon: (s: string) => string;
  toolLabel: (s: string) => string;
  toolArgs: (s: string) => string;
  toolSpinner: (s: string) => string;
  toolError: (s: string) => string;
}

export interface Theme {
  editor: EditorTheme;
  markdown: MarkdownTheme;
  app: AppTheme;
}

export function createTheme(): Theme {
  const selectList: SelectListTheme = {
    selectedPrefix: (t) => chalk.green(t),
    selectedText: (t) => chalk.green(t),
    description: (t) => chalk.dim(t),
    scrollInfo: (t) => chalk.dim(t),
    noMatch: (t) => chalk.dim(t),
  };

  const editor: EditorTheme = {
    borderColor: (t) => chalk.dim(t),
    selectList,
  };

  const markdown: MarkdownTheme = {
    heading: (t) => chalk.bold.green(t),
    link: (t) => chalk.blue(t),
    linkUrl: (t) => chalk.dim.blue(t),
    code: (t) => chalk.yellow(t),
    codeBlock: (t) => chalk.white(t),
    codeBlockBorder: (t) => chalk.dim(t),
    quote: (t) => chalk.italic(t),
    quoteBorder: (t) => chalk.dim(t),
    hr: (t) => chalk.dim(t),
    listBullet: (t) => chalk.green(t),
    bold: (t) => chalk.bold(t),
    italic: (t) => chalk.italic(t),
    strikethrough: (t) => chalk.strikethrough(t),
    underline: (t) => chalk.underline(t),
  };

  const app: AppTheme = {
    logo: (t) => chalk.green(t),
    logoTagline: (t) => chalk.white(t),
    userMessage: (t) => chalk.black(chalk.bgGreen(t)),
    loaderActive: (t) => chalk.green(t),
    loaderInactive: (t) => chalk.dim(t),
    toolIcon: chalk.green,
    toolLabel: chalk.bold,
    toolArgs: chalk.dim,
    toolSpinner: chalk.green,
    toolError: chalk.red,
  };

  return { editor, markdown, app };
}
