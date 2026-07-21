// IPC payload types shared by the main and renderer processes — the single
// definition of shapes that cross the window.api bridge.
//
// Types only: no runtime code, no DOM or Node types. This file is checked by
// BOTH tsconfig projects (browser and node), and both sides use `import type`,
// so nothing from here exists at runtime and nothing crosses the build boundary.

// ---- Ledger mentions (@-mention picker data) ------------------------------

/** Entity names available to the chat composer's @-mention popover, sourced
 *  from `hledger` against the workspace journal. */
export interface LedgerMentions {
  accounts: string[];
  payees: string[];
  tags: string[];
}

// ---- App settings (app-owned config in ~/Accountant24/app-settings.json) ---

/** The app's own settings schema (app-owned keys, distinct from pi's config,
 *  which we don't write). */
export interface AppSettings {
  /** Model new chats start with, as a `provider/modelId` id. Applied via the set_model RPC. */
  defaultModel?: string;
  /** `provider/modelId` ids the user can pick from in chat. Empty/absent = all enabled. */
  enabledModels?: string[];
  /** Anonymous usage analytics opt-out. Absent = on (the default). */
  analyticsEnabled?: boolean;
  /** One-time analytics milestones already consumed (e.g. "app_installed",
   *  "user_first_message_sent"), so each is emitted at most once per install.
   *  Written and read by the main process only; the renderer never touches it. */
  onceEvents?: string[];
}

// ---- Skills (Settings → Skills) --------------------------------------------

/** A skill the agent can use: native (embedded in the app bundle) or
 *  third-party (a folder in ~/Accountant24/skills). */
export interface SkillInfo {
  /** Skill identity: the store folder name for third-party skills, the
   *  frontmatter name for native ones. */
  name: string;
  description: string;
  enabled: boolean;
  /** Built into the app bundle: always enabled, cannot be removed/disabled. */
  native?: boolean;
  /** GitHub `owner/repo` it was added from; absent = dropped in manually. */
  source?: string;
  /** Present when the folder's SKILL.md fails validation. */
  error?: string;
}

export interface SkillAddRequest {
  /** `owner/repo` or a github.com URL (optionally /tree/<ref>/<subpath>). */
  source: string;
  ref?: string;
  subpath?: string;
  /** Frontmatter names to add; absent = every skill found. */
  skills?: string[];
}
