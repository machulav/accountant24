// RemoteThreadListAdapter backing assistant-ui's <ThreadList/> with pi's real
// sessions. The list comes from the sessions helper (pi RPC can't list); new/
// switch/rename go over RPC; a per-thread history adapter loads a session's
// messages (switch_session + get_messages) when the user opens it.

import {
  ExportedMessageRepository,
  type RemoteThreadListAdapter,
  RuntimeAdapterProvider,
  type ThreadHistoryAdapter,
  useAui,
} from "@assistant-ui/react";
import { type PropsWithChildren, useMemo } from "react";
import { sessionsApi } from "../rpc/api";
import type { SessionSummary } from "../rpc/types";
import { agentBridge } from "./agentBridge";
import { convertMessages } from "./messageConvert";

let cache: SessionSummary[] = [];
const titleFor = (s: SessionSummary) => s.name || s.firstMessage || "New Chat";

/** Injects a per-thread history adapter that rehydrates the session on open. */
function HistoryProvider({ children }: PropsWithChildren) {
  const aui = useAui();
  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() {
        const remoteId = aui.threadListItem().getState().remoteId;
        if (!remoteId) return { messages: [] };
        await agentBridge.request({ type: "switch_session", sessionPath: remoteId }, "switch_session");
        const data = await agentBridge.request<{ messages: unknown }>({ type: "get_messages" }, "get_messages");
        return ExportedMessageRepository.fromArray(convertMessages(data.messages));
      },
      async append() {
        // pi persists sessions itself; nothing to store here.
      },
    }),
    [aui],
  );
  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}

export const piThreadListAdapter = {
  async list() {
    const res = await sessionsApi.list();
    cache = res.sessions ?? [];
    const threads = cache.map((s) => ({
      status: "regular" as const,
      remoteId: s.path,
      title: titleFor(s),
      lastMessageAt: new Date(s.modified),
    }));
    return { threads };
  },

  async initialize() {
    await agentBridge.request({ type: "new_session" }, "new_session");
    const state = await agentBridge.request<{ sessionFile?: string }>({ type: "get_state" }, "get_state");
    return { remoteId: state.sessionFile ?? `pending-${Date.now()}`, externalId: undefined };
  },

  async fetch(threadId: string) {
    const s = cache.find((x) => x.path === threadId);
    return {
      status: "regular",
      remoteId: threadId,
      title: s ? titleFor(s) : "New Chat",
      ...(s ? { lastMessageAt: new Date(s.modified) } : {}),
    };
  },

  async rename(remoteId: string, newTitle: string) {
    await agentBridge.request({ type: "switch_session", sessionPath: remoteId }, "switch_session");
    await agentBridge.request({ type: "set_session_name", name: newTitle }, "set_session_name");
  },

  async delete(remoteId: string) {
    await sessionsApi.delete(remoteId);
  },

  async archive() {
    // pi has no archive concept; no-op.
  },
  async unarchive() {
    // no-op
  },

  unstable_Provider: HistoryProvider,
} as unknown as RemoteThreadListAdapter;
