// The shape of a scripted app demo: what the mock app window plays. A scene
// is one turn of a conversation (the user types, the agent works, the reply
// streams in) or a composer-only moment such as an open model menu.

/** An entity pill, as the app renders account, payee, tag, and skill mentions. */
export interface DemoChip {
  kind: "account" | "payee" | "tag" | "skill";
  label: string;
}

// Every field is optional so a scene can be chat-shaped (user, working,
// reply) or composer-shaped (an open model menu). Keep tables at three or
// fewer columns and four or fewer rows, and bullet lists at three or fewer
// items, so they fit the mock's narrow thread. A blank line ("\n\n") in a
// reply text starts a new paragraph, and a mention like `:payee[Trader Joe's]`
// or `:account[Expenses:Groceries]` renders as an inline chip, as in the app.
export interface SceneDemo {
  user?: { text: string; attachments?: { name: string; meta: string }[] };
  working?: { steps: string[]; duration: string };
  reply?: { text: string; bullets?: string[]; chips?: DemoChip[]; table?: { head: string[]; rows: string[][] } };
  composer?: { models?: { name: string; note?: string }[] };
}

/** A single-turn scene, listed in the mock sidebar under its chat title. */
export interface FeatureDemo extends SceneDemo {
  /** Shown as this scene's chat in the mock sidebar. */
  chatTitle: string;
}

/** A thread of up to two turns, played one after another in one chat. */
export interface HeroDemo {
  chatTitle: string;
  turns: SceneDemo[];
}

/** One row of the mock window's chat sidebar. */
export interface DemoChat {
  title: string;
  /** What selecting this chat points at; the host decides what it means. */
  target: string;
}
