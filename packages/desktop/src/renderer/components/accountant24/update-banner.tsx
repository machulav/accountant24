import { SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { updateApi } from "@/rpc/api";
import { SidebarCallout } from "./sidebar-callout";

/** Shown in the sidebar footer once an update is downloaded and staged. Clicking
 *  it quits, applies the update, and relaunches (see `updateApi.install`). */
export const UpdateBanner: FC<{ version: string }> = ({ version }) => {
  return (
    <SidebarCallout
      icon={SparklesIcon}
      title="Update available"
      subtitle={`Relaunch to install v${version}`}
      onClick={() => void updateApi.install()}
    />
  );
};
