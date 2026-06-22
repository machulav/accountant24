// The chat surface: header (model picker + new chat), streaming transcript,
// tool-permission dialog, and the composer (with file attach + stop/send).

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAgent } from "../hooks/useAgent";
import type { ChatItem, UiDialog } from "../rpc/types";
import { ModelPicker } from "./ModelPicker";

export function Chat() {
  const agent = useAgent();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [agent.items]);

  const submit = () => {
    if (agent.isStreaming || !input.trim()) return;
    agent.send(input);
    setInput("");
  };

  const attach = async () => {
    const path = await open({ multiple: false });
    if (typeof path === "string") setInput((v) => (v ? `${v} ${path}` : path));
  };

  return (
    <div className="chat">
      <header className="chat-header">
        <div className="title">Accountant24</div>
        <div className="header-actions">
          <ModelPicker model={agent.model} models={agent.models} onSelect={agent.selectModel} />
          <button className="ghost" onClick={agent.newSession} title="New chat">
            ＋
          </button>
        </div>
      </header>

      {agent.error && <div className="error-banner">{agent.error}</div>}

      <div className="transcript" ref={scrollRef}>
        {agent.items.length === 0 && (
          <div className="empty">
            <p>Try things like:</p>
            <ul>
              <li>“I spent $45 at Whole Foods yesterday”</li>
              <li>“How much did I spend on food this month?”</li>
              <li>“Add transactions from ~/Downloads/statement.pdf”</li>
            </ul>
          </div>
        )}
        {agent.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </div>

      {agent.dialog && <Dialog dialog={agent.dialog} onAnswer={agent.answerDialog} />}

      <div className="composer">
        <button className="ghost attach" onClick={attach} title="Attach a file">
          📎
        </button>
        <textarea
          value={input}
          placeholder="Message Accountant24…"
          rows={1}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={agent.isStreaming}
        />
        {agent.isStreaming ? (
          <button className="stop" onClick={agent.abort}>
            Stop
          </button>
        ) : (
          <button className="primary send" onClick={submit} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="msg assistant">
        <div className="bubble">
          {item.text}
          {!item.done && !item.text && <span className="typing">…</span>}
        </div>
      </div>
    );
  }
  return (
    <div className={`tool-card ${item.status}`}>
      <span className="tool-status">
        {item.status === "running" ? "⏳" : item.status === "error" ? "⚠️" : "✓"}
      </span>
      <span className="tool-name">{item.name}</span>
    </div>
  );
}

function Dialog({
  dialog,
  onAnswer,
}: {
  dialog: UiDialog;
  onAnswer: (r: { confirmed?: boolean; value?: string; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="dialog-overlay">
      <div className="dialog">
        {dialog.title && <h3>{dialog.title}</h3>}
        {dialog.message && <p>{dialog.message}</p>}

        {dialog.method === "confirm" && (
          <div className="row-buttons">
            <button onClick={() => onAnswer({ confirmed: false })}>No</button>
            <button className="primary" onClick={() => onAnswer({ confirmed: true })}>
              Yes
            </button>
          </div>
        )}

        {dialog.method === "select" && (
          <div className="dialog-options">
            {dialog.options?.map((opt) => (
              <button key={opt} onClick={() => onAnswer({ value: opt })}>
                {opt}
              </button>
            ))}
          </div>
        )}

        {dialog.method === "input" && (
          <>
            <input
              value={value}
              placeholder={dialog.placeholder}
              onChange={(e) => setValue(e.currentTarget.value)}
            />
            <div className="row-buttons">
              <button onClick={() => onAnswer({ cancelled: true })}>Cancel</button>
              <button className="primary" onClick={() => onAnswer({ value })}>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
