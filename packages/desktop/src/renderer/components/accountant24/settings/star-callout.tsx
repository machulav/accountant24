// The settings sidebar's star-the-repo callout. Rendered in the SidebarFooter;
// opens the repo in the system browser via the window-open handler.

import { StarIcon } from "lucide-react";
import { SidebarCallout } from "../sidebar-callout";

export function StarCallout() {
  return (
    <SidebarCallout
      icon={StarIcon}
      title="Enjoying the app?"
      subtitle="Star us on GitHub"
      // biome-ignore lint/a11y/useAnchorContent: useRender injects the callout content into the anchor at runtime
      render={<a href="https://github.com/machulav/accountant24" target="_blank" rel="noreferrer" />}
    />
  );
}
