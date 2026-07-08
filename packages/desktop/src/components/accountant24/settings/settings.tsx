// The Settings surface: a large overlay with a left category nav and a content
// pane. Models is the first (and currently only) page; General / Appearance /
// About are placeholders for where future pages slot in. Built on the shadcn
// Dialog so it gets focus trapping and Esc-to-close for free.

import { CpuIcon, KeyboardIcon, PlugIcon, ShieldIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import { cn } from "@/lib/utils";
import { appApi } from "@/rpc/api";
import { AnalyticsSettings } from "./analytics-settings";
import { ModelsSettings } from "./models-settings";
import { ProvidersSettings } from "./providers-settings";
import { ShortcutsSettings } from "./shortcuts-settings";

export type SettingsSection = "providers" | "models" | "shortcuts" | "privacy";

const NAV: { id: SettingsSection; label: string; icon: typeof CpuIcon }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "models", label: "Models", icon: CpuIcon },
  { id: "privacy", label: "Privacy", icon: ShieldIcon },
  { id: "shortcuts", label: "Shortcuts", icon: KeyboardIcon },
];

export function Settings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [section, setSection] = useState<SettingsSection>("providers");
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    appApi
      .version()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[min(900px,92vw)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <nav className="bg-muted/30 flex w-48 shrink-0 flex-col gap-0.5 border-r p-2">
          <div className="text-muted-foreground px-2 pt-2 pb-3 text-xs font-semibold tracking-wide uppercase">
            Settings
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <Button
                key={item.id}
                variant="ghost"
                size="sm"
                onClick={() => setSection(item.id)}
                className={cn(
                  "justify-start gap-2 px-2 font-normal",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Button>
            );
          })}
          {/* Links to the full release history (each release carries its
              changelog section as notes). Opens in the system browser via the
              window-open handler. */}
          {version && (
            <div className="text-muted-foreground/70 mt-auto flex items-center justify-center gap-1.5 px-2 pb-1 text-xs">
              <span>v{version}</span>
              <span aria-hidden>·</span>
              <a
                href="https://github.com/machulav/accountant24/releases"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Changelog
              </a>
            </div>
          )}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {section === "providers" && <ProvidersSettings />}
          {section === "models" && <ModelsSettings />}
          {section === "shortcuts" && <ShortcutsSettings />}
          {section === "privacy" && <AnalyticsSettings />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
