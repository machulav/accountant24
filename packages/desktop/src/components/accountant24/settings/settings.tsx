// The Settings surface: a large overlay with a left category nav and a content
// pane. Built on the shadcn Dialog (focus trapping, Esc-to-close) with the
// stock Sidebar components rendered inline (collapsible="none") for the nav —
// the same shadcn pattern as its settings-dialog example.

import { CpuIcon, KeyboardIcon, PlugIcon, ShieldIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/shadcn/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/shadcn/sidebar";
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
        {/* min-h-full: the provider defaults to min-h-svh, which would overflow
            the fixed-height dialog. --sidebar-width is the supported knob for
            sizing the nav column. */}
        <SidebarProvider className="min-h-full" style={{ "--sidebar-width": "12rem" } as React.CSSProperties}>
          <Sidebar collapsible="none" className="border-r">
            <SidebarContent>
              {/* pt-3: lines the eyebrow's text up with the content pane's
                  section titles (py-5 → 20px from the dialog top); the stock
                  p-2 leaves it 4px higher. */}
              <SidebarGroup className="pt-3">
                {/* Eyebrow treatment (uppercase + tracking) so the small size
                    reads as a deliberate overline, not a shrunken dialog title;
                    select-none because it's chrome, not content. */}
                <SidebarGroupLabel className="tracking-wide uppercase select-none">Settings</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {NAV.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton isActive={item.id === section} onClick={() => setSection(item.id)}>
                          <item.icon />
                          {item.label}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            {/* Links to the full release history (each release carries its
                changelog section as notes). Opens in the system browser via the
                window-open handler. */}
            {version && (
              <SidebarFooter>
                <div className="text-muted-foreground/70 flex items-center justify-center gap-1.5 text-xs">
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
              </SidebarFooter>
            )}
          </Sidebar>
          <main className="min-w-0 flex-1 overflow-y-auto">
            {section === "providers" && <ProvidersSettings />}
            {section === "models" && <ModelsSettings />}
            {section === "shortcuts" && <ShortcutsSettings />}
            {section === "privacy" && <AnalyticsSettings />}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
