# @accountant24/demo

Scripted demos of the Accountant24 app: the conversations, the timing that
plays them, and a mock app window that renders them. The landing page uses
this to show the app without shipping the app.

- `src/scenes/` — one file per scene, named for what it shows. A scene is a
  scripted conversation: what the user types or drops in, the tool steps the
  agent runs, and the reply, including inline mention chips, bullets, and
  tables. `all.ts` lists them in order.
- `src/shared/types.ts` — the scene format.
- `src/shared/timeline.ts` — build-time timing: when every element appears, at
  a pace a reader can follow. The host emits the delays as inline `--d`
  custom properties, so playing a scene is only a class toggle.
- `src/shared/components/` — the mock window, the scene renderer with its
  `.fdemo` stylesheet, and the icons they use.
- `src/shared/styles/theme.css` and `src/shared/fonts/` — the app look: the
  desktop app's palette and text faces.

## Using it

The host needs Tailwind v4. In its stylesheet, next to the Tailwind import:

```css
@import "tailwindcss";
@import "@accountant24/demo/shared/styles/theme.css";
@source "<relative path to packages/demo/src>";
```

The `@source` line matters: Tailwind scans only the host's own tree, so
without it the utility classes used by the mock components are never
generated and the window renders unstyled.

Then render a scene:

```astro
---
import MockScene from "@accountant24/demo/shared/components/mock-scene.astro";
import MockWindow from "@accountant24/demo/shared/components/mock-window.astro";
import { groceries } from "@accountant24/demo/scenes/groceries";
import { buildSceneTimeline } from "@accountant24/demo/shared/timeline";

const turns = [{ demo: groceries, timeline: buildSceneTimeline(groceries) }];
---

<MockWindow chats={[{ title: groceries.chatTitle, target: "demo" }]} activeChat="demo">
  <MockScene index={0} shown turns={turns} />
</MockWindow>
```

A scene animates only while its element carries `is-active`; without it the
markup is the finished conversation, which is what visitors with JavaScript
off or reduced motion enabled see.

## What the host must provide beyond the theme

- A dark mode driven by `prefers-color-scheme`. The chip colors switch on it.
- A global `prefers-reduced-motion` rule that shortens animations. The scene
  relies on it to collapse to its final frame.

## Chip colors

The account, payee, tag, and skill chips are hardcoded in
`components/mock-scene.astro` to mirror the desktop app, which hardcodes the
same values in `renderer/components/accountant24/mentions.tsx` and
`skill-pill.tsx`. `__tests__/chip-colors.test.ts` fails if they drift apart.
