// Top-level router: decide between Login and Chat based on whether any provider
// is already configured (auth.json), then hand off.

import { useEffect, useState } from "react";
import { Chat } from "./components/Chat";
import { Login } from "./components/Login";
import { authApi } from "./rpc/api";

type Phase = "loading" | "login" | "chat";

export default function App() {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    authApi
      .status()
      .then((status) => setPhase(status.anyConfigured ? "chat" : "login"))
      .catch(() => setPhase("login"));
  }, []);

  if (phase === "loading") return <div className="center muted">Loading…</div>;
  if (phase === "login") return <Login onDone={() => setPhase("chat")} />;
  return <Chat />;
}
