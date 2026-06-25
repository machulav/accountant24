import { AssistantRuntimeProvider, useLocalRuntime, useRemoteThreadListRuntime } from "@assistant-ui/react";
import { useMemo } from "react";
import { useAgentModels } from "../hooks/useAgentModels";
import { agentAdapter } from "../runtime/agentAdapter";
import { ModelsContext } from "../runtime/modelsContext";
import { piThreadListAdapter } from "../runtime/piThreadListAdapter";
import type { ModelOption } from "./assistant-ui/model-selector";
import { Thread } from "./assistant-ui/thread";
import { ThreadList } from "./assistant-ui/thread-list";
import { TooltipProvider } from "./ui/tooltip";

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
      <TooltipProvider>
        <ModelsContext.Provider value={{ value, models: options, onSelect: selectModel }}>
          <div className="bg-background text-foreground relative flex h-dvh">
            {/* Draggable strip across the top; macOS traffic lights overlay it natively. */}
            <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-7" />
            <aside className="bg-sidebar w-64 shrink-0 overflow-y-auto border-r p-2 pt-9">
              <ThreadList />
            </aside>
            <main className="min-w-0 flex-1">
              <Thread />
            </main>
          </div>
        </ModelsContext.Provider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
