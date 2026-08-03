// Connect — how to reach this agent from other apps over the Agent Client
// Protocol. The launcher lives inside the app bundle, so its path is
// undiscoverable without showing it here.

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/shadcn/button";
import { appApi } from "@/rpc/api";
import { LinkRow, Section, SettingsRows } from "./parts";

const DOCS_HREF = "https://accountant24.ai/docs/connect-other-apps";

/** How long the copy button stays in its confirmed state. */
const COPIED_MS = 2000;

function CommandRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-2">
      {/* break-all: the path is long and unbreakable at word boundaries, so
          without it the row overflows the dialog horizontally. */}
      <code className="bg-muted text-muted-foreground min-w-0 flex-1 rounded-md px-2.5 py-2 font-mono text-xs break-all">
        {path}
      </code>
      <Button
        size="sm"
        variant="outline"
        aria-label="Copy command"
        onClick={() => {
          void navigator.clipboard.writeText(path).then(() => setCopied(true));
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ConnectSettings() {
  const [path, setPath] = useState<string>();

  useEffect(() => {
    appApi
      .acpCommandPath()
      .then(setPath)
      .catch(() => undefined);
  }, []);

  return (
    <div>
      <Section
        title="Connect other apps"
        description="Accountant24 speaks the Agent Client Protocol, so other agent apps can chat with your ledger. Register this command in any ACP client."
      >
        {path && <CommandRow path={path} />}
      </Section>

      <Section
        title="Good to know"
        description="Other apps work on the same ledger in ~/Accountant24, so chats you start elsewhere show up in your chat list here. Accountant24 does not need to be running."
      />

      {/* Its own group: the link is a next step, not part of the note above. */}
      <Section>
        <SettingsRows>
          <LinkRow label="Setup guide" href={DOCS_HREF} />
        </SettingsRows>
      </Section>
    </div>
  );
}
