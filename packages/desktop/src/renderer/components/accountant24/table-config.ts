"use client";

// Persisted table configuration shared by the data pages (Transactions,
// Net Worth) — the same best-effort localStorage idiom as the sidebar
// width: load validates the stored value field by field and falls back to
// the page's defaults, save never throws. Each page brings its own storage
// key, default visibility, and known-column list (see
// transactions-columns.ts / net-worth-columns.ts).

import { functionalUpdate, type Updater } from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";

/** Everything the grid lets the user shape: column visibility and resized
 *  widths. Column order is fixed by the column definitions on every page;
 *  it is neither user-changeable nor persisted. */
export interface TableConfig {
  visibility: Record<string, boolean>;
  sizing: Record<string, number>;
}

/** The persisted config over the defaults; unknown columns, non-bool
 *  visibility, and non-positive widths are dropped, so a stale or garbled
 *  entry can never hide or break a table. `sizableColumns` lists every leaf
 *  column id the sizing validation accepts — it can exceed the visibility
 *  keys (chrome columns resize but never hide). Stored widths clamp to
 *  `minSizes`: a resize drag past a column's minimum persists the raw
 *  sub-minimum value (the grid clamps only at render), and letting it back
 *  into the model would make every later width computation lie. */
export function loadStoredTableConfig(
  key: string,
  defaultVisibility: Record<string, boolean>,
  sizableColumns: readonly string[],
  minSizes: Record<string, number> = {},
): TableConfig {
  const config: TableConfig = { visibility: { ...defaultVisibility }, sizing: {} };
  let stored: unknown;
  try {
    stored = JSON.parse(window.localStorage.getItem(key) ?? "");
  } catch {
    return config;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return config;
  const s = stored as { visibility?: unknown; sizing?: unknown };
  if (typeof s.visibility === "object" && s.visibility !== null) {
    for (const [id, visible] of Object.entries(s.visibility)) {
      if (id in defaultVisibility && typeof visible === "boolean") config.visibility[id] = visible;
    }
  }
  if (typeof s.sizing === "object" && s.sizing !== null) {
    for (const [id, width] of Object.entries(s.sizing)) {
      if (sizableColumns.includes(id) && typeof width === "number" && Number.isFinite(width) && width > 0) {
        config.sizing[id] = Math.max(width, minSizes[id] ?? 0);
      }
    }
  }
  return config;
}

export function saveStoredTableConfig(key: string, config: TableConfig): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(config));
  } catch {
    // Persistence is best-effort; the session keeps its in-memory state.
  }
}

/** How long after the last config change (a resize drag emits one per
 *  pointer move) the table config is written to localStorage. */
const SAVE_CONFIG_DELAY_MS = 250;

/** The pages' table-config state: loaded once on mount, updated field by
 *  field, persisted debounced — an onChange column resize updates state on
 *  every pointer move, and a synchronous localStorage write per move would
 *  put disk I/O on the drag frame path. One write lands shortly after the
 *  last change; the just-loaded initial config never writes back. */
export function useTableConfig(
  load: () => TableConfig,
  save: (config: TableConfig) => void,
): {
  config: TableConfig;
  applyConfig: <K extends keyof TableConfig>(field: K, updater: Updater<TableConfig[K]>) => void;
} {
  const [config, setConfig] = useState<TableConfig>(load);

  const applyConfig = <K extends keyof TableConfig>(field: K, updater: Updater<TableConfig[K]>) =>
    setConfig((prev) => ({ ...prev, [field]: functionalUpdate(updater, prev[field]) }));

  const savedConfig = useRef(config);
  const configRef = useRef(config);
  configRef.current = config;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (savedConfig.current === config) return;
    const timer = setTimeout(() => {
      savedConfig.current = config;
      saveRef.current(config);
    }, SAVE_CONFIG_DELAY_MS);
    return () => clearTimeout(timer);
  }, [config]);
  // Flush a pending write on unmount: a page that unmounts on view switch
  // (Net Worth) would otherwise lose a change made within the debounce
  // window — the timer above is cleaned up with the component.
  useEffect(
    () => () => {
      if (savedConfig.current !== configRef.current) saveRef.current(configRef.current);
    },
    [],
  );

  return { config, applyConfig };
}
