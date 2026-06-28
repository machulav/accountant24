import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
} from "@assistant-ui/react";
import { usePiRuntime } from "@assistant-ui/react-pi";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { mentionsToPlainText } from "../lib/mentions";
import { extractAttachmentRefs } from "../lib/attachmentMarker";
import { agentBridge } from "../runtime/agentBridge";
import { createElectronPiClient } from "../runtime/electronPiClient";
import {
  ArchivingImageAttachmentAdapter,
  WorkspaceFileAttachmentAdapter,
} from "../runtime/fileAttachmentAdapter";
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
  return (
    <SidebarTrigger
      className={cn("app-no-drag absolute top-[7px] z-30", offset ? "left-20" : "left-2")}
    />
  );
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
  // send; `run` is the snapshot taken at agent_start so a run is titled only from
  // its own images (not images left over from an earlier, already-titled chat).
  const imageNames = useRef<{ pending: string[]; run: string[] }>({ pending: [], run: [] });
  const attachments = useMemo(
    () =>
      new CompositeAttachmentAdapter([
        new ArchivingImageAttachmentAdapter((name) => imageNames.current.pending.push(name)),
        new WorkspaceFileAttachmentAdapter("*"),
      ]),
    [],
  );
  const runtime = usePiRuntime({ client, adapters: { attachments } });

  // react-pi stubs out generateTitle, so a new chat keeps its placeholder name.
  // When a still-untitled chat finishes its first run, title it from the first
  // user message via the thread item's own rename — an optimistic, single-thread
  // update (no list refetch) that also persists the name. Titled chats are
  // skipped, so this never clobbers a manual rename or fires twice.
  useEffect(() => {
    return agentBridge.addEventListener((e) => {
      // Claim this run's images before agent_end so a later message can't retitle.
      if (e.type === "agent_start") {
        imageNames.current.run = imageNames.current.pending;
        imageNames.current.pending = [];
        return;
      }
      if (e.type !== "agent_end") return;
      const sentImages = imageNames.current.run;
      imageNames.current.run = [];
      const item = runtime.threads.mainItem;
      if (item.getState().title) return;
      const firstUser = runtime.thread.getState().messages.find((m) => m.role === "user");
      const parts = (firstUser?.content ?? [])
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => extractAttachmentRefs(p.text));
      // Render mention directives as their plain label so a title never shows
      // raw `:account[…]` syntax.
      const text = mentionsToPlainText(parts.map((p) => p.text).join(" "))
        .replace(/\s+/g, " ")
        .trim();
      // An attachment-only message has no visible text; fall back to the file
      // name(s) so the chat doesn't keep its "New Chat" placeholder (and so a
      // reload doesn't surface the raw "[[attachment]]{…}" marker as the title).
      // Documents carry their name in the message marker; images are gone from
      // the transcript, so use the names the adapter reported for this run.
      const title =
        text ||
        [...parts.flatMap((p) => p.refs).map((r) => r.name), ...sentImages].join(", ");
      if (!title) return;
      void item.rename(title.length > 60 ? `${title.slice(0, 60).trimEnd()}…` : title);
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
