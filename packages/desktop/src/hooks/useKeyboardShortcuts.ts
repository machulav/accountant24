import { useEffect, useRef } from "react";
import { matchShortcut, type ShortcutName } from "@/lib/shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutName, (e: KeyboardEvent) => void>>;

/** Bind global keyboard shortcuts. Each handler maps to a combo in `SHORTCUTS`;
 *  matching and `preventDefault` are handled here. Handlers may change between
 *  renders without rebinding the listener. */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const names = Object.keys(handlersRef.current) as ShortcutName[];
      const matched = matchShortcut(e, names);
      if (matched) {
        e.preventDefault();
        handlersRef.current[matched]?.(e);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
