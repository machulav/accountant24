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

/** One skill folder the host should load, with the `<plugin>:<skill>` name it
 *  must be surfaced under. Main resolves these from the plugin store (which
 *  needs the app settings, hence Electron) and passes the result down, so the
 *  host never reads the store itself. */
export interface AgentHostSkill {
  /** Absolute path of the skill folder (the one holding SKILL.md). */
  path: string;
  /** Namespaced name the model and the UI both use. */
  name: string;
}

/** Static host configuration, passed as JSON in argv[2] at fork time so it is
 *  available at module load, before the first message can arrive. */
export interface AgentHostConfig {
  workspaceDir: string;
  sessionsDir: string;
  /** Skills of the built-in plugins plus every enabled installed plugin.
   *  Rebuilt on each host fork, so the agent_restart after a plugin change is
   *  what makes it take effect. */
  skills: AgentHostSkill[];
  extensionPath: string;
  systemPromptPath: string;
}
