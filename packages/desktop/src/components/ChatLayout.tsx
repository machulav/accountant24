import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { usePiRuntime } from "@assistant-ui/react-pi";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { agentBridge } from "../runtime/agentBridge";
import { createElectronPiClient } from "../runtime/electronPiClient";
import { PiClientContext } from "../runtime/modelsContext";
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
  // pi is the single source of truth; the official react-pi runtime renders it
  // over a custom client that talks to our extension-enabled sidecar.
  const client = useMemo(() => createElectronPiClient(), []);
  const runtime = usePiRuntime({ client });

  // react-pi stubs out generateTitle, so a new chat keeps its placeholder name.
  // When a still-untitled chat finishes its first run, title it from the first
  // user message via the thread item's own rename — an optimistic, single-thread
  // update (no list refetch) that also persists the name. Titled chats are
  // skipped, so this never clobbers a manual rename or fires twice.
  useEffect(() => {
    return agentBridge.addEventListener((e) => {
      if (e.type !== "agent_end") return;
      const item = runtime.threads.mainItem;
      if (item.getState().title) return;
      const firstUser = runtime.thread.getState().messages.find((m) => m.role === "user");
      const text = (firstUser?.content ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return;
      void item.rename(text.length > 60 ? `${text.slice(0, 60).trimEnd()}…` : text);
    });
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PiClientContext.Provider value={client}>
        <SidebarProvider className="h-dvh">
          <Sidebar>
            {/* spacer + drag region so the list clears the overlaid traffic lights */}
            <SidebarHeader className="app-drag-region h-7" />
            <SidebarContent className="px-2">
              <ThreadList />
            </SidebarContent>
          </Sidebar>
          <SidebarInset className="relative min-w-0">
            <div className="app-drag-region absolute inset-x-0 top-0 z-20 h-7" />
            <SidebarToggle />
            <Thread />
          </SidebarInset>
        </SidebarProvider>
      </PiClientContext.Provider>
    </AssistantRuntimeProvider>
  );
}
