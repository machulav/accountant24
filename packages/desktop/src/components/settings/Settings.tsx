// The Settings surface: a large overlay with a left category nav and a content
// pane. Models is the first (and currently only) page; General / Appearance /
// About are placeholders for where future pages slot in. Built on the shadcn
// Dialog so it gets focus trapping and Esc-to-close for free.

import { useState } from "react";
import { CpuIcon, PlugIcon, ShieldIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AnalyticsSettings } from "./AnalyticsSettings";
import { ModelsSettings } from "./ModelsSettings";
import { ProvidersSettings } from "./ProvidersSettings";

export type SettingsSection = "providers" | "models" | "privacy";

const NAV: { id: SettingsSection; label: string; icon: typeof CpuIcon }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "models", label: "Models", icon: CpuIcon },
  { id: "privacy", label: "Privacy", icon: ShieldIcon },
];

export function Settings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [section, setSection] = useState<SettingsSection>("providers");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[min(900px,92vw)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <nav className="bg-muted/30 flex w-48 shrink-0 flex-col gap-0.5 border-r p-2">
          <div className="text-muted-foreground px-2 pt-2 pb-3 text-xs font-semibold tracking-wide uppercase">
            Settings
          </div>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === section;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {section === "providers" && <ProvidersSettings />}
          {section === "models" && <ModelsSettings />}
          {section === "privacy" && <AnalyticsSettings />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
