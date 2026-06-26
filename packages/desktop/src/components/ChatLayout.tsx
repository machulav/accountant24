import { AssistantRuntimeProvider, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAgentModels } from "../hooks/useAgentModels";
import { agentAdapter } from "../runtime/agentAdapter";
import { ModelsContext } from "../runtime/modelsContext";
import { piThreadListAdapter } from "../runtime/piThreadListAdapter";
import type { ModelOption } from "./assistant-ui/model-selector";
import { Thread } from "./assistant-ui/thread";
import { ThreadList } from "./assistant-ui/thread-list";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";

/** Hide/show toggle. Offset clear of the macOS traffic lights whenever the
 *  sidebar isn't occupying the left edge (collapsed, or mobile drawer mode). */
function SidebarToggle() {
  const { state, isMobile } = useSidebar();
  const offset = isMobile || state === "collapsed";
  return <SidebarTrigger className={cn("absolute top-1.5 z-30", offset ? "left-20" : "left-2")} />;
}

export function ChatLayout() {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useLocalRuntime(agentAdapter),
    adapter: piThreadListAdapter,
  });
  const { value, models, selectModel } = useAgentModels();

  const options: ModelOption[] = useMemo(
    () => models.map((m) => ({ id: `${m.provider}/${m.id}`, name: m.name, description: m.provider })),
    [models],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ModelsContext.Provider value={{ value, models: options, onSelect: selectModel }}>
        <SidebarProvider className="h-dvh">
          <Sidebar>
            {/* spacer + drag region so the list clears the overlaid traffic lights */}
            <SidebarHeader data-tauri-drag-region className="h-7" />
            <SidebarContent className="px-2">
              <ThreadList />
            </SidebarContent>
          </Sidebar>
          <SidebarInset className="relative min-w-0">
            <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-7" />
            <SidebarToggle />
            <Thread />
          </SidebarInset>
        </SidebarProvider>
      </ModelsContext.Provider>
    </AssistantRuntimeProvider>
  );
}
