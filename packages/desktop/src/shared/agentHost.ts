// The message protocol between the Electron main process and the agent-host
// utilityProcess (src/main/agent/host/). Types only — imported with
// `import type` from both sides.

/** Main → host (utilityProcess.postMessage payloads). */
export type AgentHostRequest =
  | {
      kind: "command";
      /** Absolute session-file path — the routing key for every command/event. */
      sessionPath: string;
      /** A pi RPC-shaped command object (prompt / abort / set_model / …). */
      command: Record<string, unknown>;
    }
  | {
      kind: "dispose_session";
      sessionPath: string;
      /** Echoed back in the session_closed ack so main can await the dispose. */
      requestId: string;
    };

/** Host → main (process.parentPort.postMessage payloads). */
export type AgentHostNotice =
  | {
      kind: "event";
      sessionPath: string;
      /** One serialized pi wire event/response — forwarded to the renderer
       *  verbatim as `agent-event { sessionPath, line }`. */
      line: string;
    }
  | {
      /** A session's runtime could not be created (bad extension, broken
       *  config). Surfaced to the renderer as `agent-error`. */
      kind: "session_error";
      sessionPath: string;
      message: string;
    }
  | {
      kind: "session_closed";
      sessionPath: string;
      reason: "reaped" | "evicted" | "disposed";
      /** Present when the close acks a dispose_session request. */
      requestId?: string;
    };

/** Static host configuration, passed as JSON in argv[2] at fork time so it is
 *  available at module load, before the first message can arrive. */
export interface AgentHostConfig {
  workspaceDir: string;
  sessionsDir: string;
  skillsDir: string;
  nativeSkillsDir: string;
  extensionPath: string;
  systemPromptPath: string;
}
