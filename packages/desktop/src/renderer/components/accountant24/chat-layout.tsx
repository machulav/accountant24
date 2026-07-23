import { AssistantRuntimeProvider, CompositeAttachmentAdapter } from "@assistant-ui/react";
import { usePiRuntime } from "@assistant-ui/react-pi";
import { LandmarkIcon, SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/shadcn/sidebar";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useUpdateStatus } from "@/hooks/use-update-status";
import { deriveChatTitle } from "@/lib/chatTitle";
import { cn } from "@/lib/utils";
import { agentBridge } from "@/runtime/agentBridge";
import { createElectronPiClient } from "@/runtime/electronPiClient";
import { ArchivingImageAttachmentAdapter, WorkspaceFileAttachmentAdapter } from "@/runtime/fileAttachmentAdapter";
import { PiClientContext } from "@/runtime/modelsContext";
import { NetWorthView } from "./net-worth-view";
import { Settings } from "./settings/settings";
import { loadSidebarWidth, SidebarResizeHandle } from "./sidebar-resize";
import { Thread } from "./thread";
import { ThreadList, ThreadListNew } from "./thread-list";
import { UpdateBanner } from "./update-banner";

/** Hide/show toggle. Offset clear of the macOS traffic lights whenever the
 *  sidebar isn't occupying the left edge (collapsed, or mobile drawer mode). */
function SidebarToggle() {
  const { state, isMobile } = useSidebar();
  const offset = isMobile || state === "collapsed";
  // top-[5px]: centers the 32px button at 21px — visually on the traffic
  // lights' center line. Tuned by eye: the nominal math (12px circles at
  // trafficLightPosition y=14 → center 20px) renders slightly higher than
  // where macOS actually draws the lights.
  return <SidebarTrigger className={cn("app-no-drag absolute top-[5px] z-30", offset ? "left-20" : "left-2")} />;
}

export function ChatLayout() {
  // pi is the single source of truth; the official react-pi runtime renders it
  // over a custom client that talks to our extension-enabled sidecar.
  const client = useMemo(() => createElectronPiClient(), []);
  // Every attached file is archived into the workspace. Routed by MIME:
  //  - model-readable images → archived AND sent as image content (vision)
  //  - everything else (PDF, CSV, …) → archived AND sent as a workspace path the
  //    agent reads/extracts (pi carries only text + images to the model)
  // The "*" adapter must be last (it handles all remaining types).
  // Image filenames are lost once pi projects them to bare `image` parts, so the
  // adapter reports each sent image's name here. `pending` collects the current
  // send; `run` maps each session to the snapshot taken at its agent_start so a
  // run is titled only from its own images (not images left over from an
  // earlier, already-titled chat) — keyed per session because runs on several
  // chats can be in flight at once.
  const imageNames = useRef<{ pending: string[]; run: Map<string, string[]> }>({ pending: [], run: new Map() });
  const attachments = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new ArchivingImageAttachmentAdapter((name) => imageNames.current.pending.push(name)),
        new WorkspaceFileAttachmentAdapter("*"),
      ]),
    [],
  );
  const runtime = usePiRuntime({ client, adapters: { attachments } });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which view fills the inset. The chat is never unmounted (see below); the
  // The Net Worth page mounts fresh on each open so it always shows current data.
  const [view, setView] = useState<"chat" | "net-worth">("chat");
  const showChat = useCallback(() => setView("chat"), []);
  // Non-null once an update is downloaded and staged; drives the footer banner.
  const updateVersion = useUpdateStatus();
  // Read once on mount; afterwards SidebarResizeHandle mutates the CSS var live.
  const [sidebarWidth] = useState(loadSidebarWidth);

  useKeyboardShortcuts({
    newChat: () => {
      setView("chat");
      void runtime.threads.switchToNewThread();
    },
    openSettings: () => setSettingsOpen(true),
  });

  // react-pi stubs out generateTitle, so a new chat keeps its placeholder name.
  // When a still-untitled chat finishes its first run, title it from the first
  // user message via the thread item's own rename — an optimistic, single-thread
  // update (no list refetch) that also persists the name. Titled chats are
  // skipped, so this never clobbers a manual rename or fires twice. Everything
  // is keyed by the event's sessionPath (= threadId), so a run finishing in a
  // background chat titles THAT chat, not the one being viewed.
  useEffect(() => {
    return agentBridge.addEventListener((e) => {
      // Claim this run's images before agent_end so a later message can't
      // retitle. The pending images belong to this session: they were attached
      // in the composer whose send started this very run.
      if (e.type === "agent_start") {
        imageNames.current.run.set(e.sessionPath, imageNames.current.pending);
        imageNames.current.pending = [];
        return;
      }
      if (e.type !== "agent_end") return;
      const sentImages = imageNames.current.run.get(e.sessionPath) ?? [];
      imageNames.current.run.delete(e.sessionPath);
      let item: ReturnType<typeof runtime.threads.getItemById>;
      try {
        item = runtime.threads.getItemById(e.sessionPath);
      } catch {
        return; // session unknown to the thread list — nothing to title
      }
      if (item.getState().title) return;
      // Fetch the first user message from the session's transcript — works the
      // same for the viewed and background chats, and arrives already
      // normalized (skill blocks collapsed) by the client's snapshot path.
      // One extra RPC, paid only on the first run of a still-untitled chat.
      void client
        .getThread(e.sessionPath)
        .then((snapshot) => {
          if (item.getState().title) return; // a rename landed meanwhile
          const messages = snapshot.messages as Array<{ role?: string; content?: unknown }>;
          const firstUser = messages.find((m) => m.role === "user");
          const content = Array.isArray(firstUser?.content)
            ? (firstUser.content as { type?: string; text?: string }[])
            : [];
          const texts = content.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text ?? "");
          // Title from the first user message: its text (markers stripped,
          // mentions as plain labels), or the attached file/image names for an
          // attachment-only message. `sentImages` are the names the adapter
          // reported for this run, since images are gone from the transcript.
          const title = deriveChatTitle({ texts, imageNames: sentImages });
          if (title) void item.rename(title);
        })
        .catch(() => undefined);
    });
  }, [runtime, client]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PiClientContext.Provider value={client}>
        <SidebarProvider className="h-dvh" style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
          <Sidebar>
            <SidebarHeader>
              {/* spacer + drag region so the header clears the overlaid traffic lights */}
              <div className="app-drag-region h-7" />
              <ThreadListNew onSelect={showChat} />
            </SidebarHeader>
            <SidebarContent className="scroll-fade">
              <ThreadList onSelectThread={showChat} highlightActive={view === "chat"} />
            </SidebarContent>
            <SidebarFooter>
              {updateVersion && <UpdateBanner version={updateVersion} />}
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={view === "net-worth"} onClick={() => setView("net-worth")}>
                    <LandmarkIcon className="size-4" />
                    Net Worth
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton onClick={() => setSettingsOpen(true)}>
                    <SettingsIcon className="size-4" />
                    Settings
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
            <SidebarResizeHandle />
          </Sidebar>
          <SidebarInset className="relative min-w-0">
            <div className="app-drag-region absolute inset-x-0 top-0 z-20 h-7" />
            <SidebarToggle />
            {/* The chat stays mounted (display:none) while the Net Worth is open:
                the composer's editor state, scroll position, and any in-flight
                streaming all survive the round trip. */}
            <div className={cn("flex min-h-0 flex-1 flex-col", view !== "chat" && "hidden")}>
              <Thread />
            </div>
            {view === "net-worth" && <NetWorthView />}
          </SidebarInset>
          <Settings open={settingsOpen} onOpenChange={setSettingsOpen} />
        </SidebarProvider>
      </PiClientContext.Provider>
    </AssistantRuntimeProvider>
  );
}
