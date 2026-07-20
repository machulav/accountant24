// The Settings surface: a large overlay with a left category nav and a content
// pane. Built on the shadcn Dialog (focus trapping, Esc-to-close) with the
// stock Sidebar components rendered inline (collapsible="none") for the nav —
// the same shadcn pattern as its settings-dialog example.

import { CpuIcon, InfoIcon, KeyboardIcon, PlugIcon, ShieldIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
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
import { AboutSettings } from "./about-settings";
import { AnalyticsSettings } from "./analytics-settings";
import { ModelsSettings } from "./models-settings";
import { ProvidersSettings } from "./providers-settings";
import { ShortcutsSettings } from "./shortcuts-settings";
import { SkillsSettings } from "./skills-settings";
import { StarCallout } from "./star-callout";

export type SettingsSection = "providers" | "models" | "skills" | "shortcuts" | "privacy" | "about";

const NAV: { id: SettingsSection; label: string; icon: typeof CpuIcon }[] = [
  { id: "providers", label: "Providers", icon: PlugIcon },
  { id: "models", label: "Models", icon: CpuIcon },
  { id: "skills", label: "Skills", icon: ZapIcon },
  { id: "privacy", label: "Privacy", icon: ShieldIcon },
  { id: "shortcuts", label: "Shortcuts", icon: KeyboardIcon },
  { id: "about", label: "About", icon: InfoIcon },
];

export function Settings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [section, setSection] = useState<SettingsSection>("providers");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[min(900px,92vw)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        {/* min-h-full: the provider defaults to min-h-svh, which would overflow
            the fixed-height dialog. --sidebar-width is the supported knob for
            sizing the nav column. */}
        <SidebarProvider className="min-h-full" style={{ "--sidebar-width": "14rem" } as React.CSSProperties}>
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
            {/* The --radius override mirrors what stock SidebarHeader/
                SidebarContent set for their children (and stock SidebarFooter
                omits), so the callout's rounded-xl matches the nav pills. */}
            <SidebarFooter className="[--radius:var(--radius-xl)]">
              <StarCallout />
            </SidebarFooter>
          </Sidebar>
          <main className="min-w-0 flex-1 overflow-y-auto">
            {section === "providers" && <ProvidersSettings />}
            {section === "models" && <ModelsSettings />}
            {section === "skills" && <SkillsSettings />}
            {section === "shortcuts" && <ShortcutsSettings />}
            {section === "privacy" && <AnalyticsSettings />}
            {section === "about" && <AboutSettings />}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
