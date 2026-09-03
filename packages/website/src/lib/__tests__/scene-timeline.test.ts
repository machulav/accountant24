import { describe, expect, it } from "vitest";
import { features, heroDemo } from "../../content/site";
import { buildConversationTimeline, buildSceneTimeline, type SceneTimeline, shiftTimeline } from "../scene-timeline";

function allDelays(timeline: SceneTimeline): number[] {
  return [
    ...(timeline.attachmentAt === undefined ? [] : [timeline.attachmentAt]),
    ...timeline.typeCharDelays,
    ...(timeline.sendAt === undefined ? [] : [timeline.sendAt]),
    ...(timeline.workingAt === undefined ? [] : [timeline.workingAt]),
    ...timeline.stepDelays,
    ...(timeline.doneAt === undefined ? [] : [timeline.doneAt]),
    ...(timeline.replyAt === undefined ? [] : [timeline.replyAt]),
    ...timeline.replyWordDelays,
    ...timeline.chipDelays,
    ...timeline.rowDelays,
    ...timeline.modelDelays,
  ];
}

function expectStrictlyIncreasing(delays: number[]): void {
  for (let i = 1; i < delays.length; i++) {
    expect(delays[i]).toBeGreaterThan(delays[i - 1] as number);
  }
}

describe("buildSceneTimeline()", () => {
  describe("chat scene (user, working, reply with chips)", () => {
    // "Add coffee 3.50 yesterday" = 25 characters, spaces included.
    const timeline = buildSceneTimeline({
      user: { text: "Add coffee 3.50 yesterday" },
      working: { steps: ["Add Transactions", "Commit"], duration: "3s" },
      reply: {
        text: "Done.",
        chips: [
          { kind: "payee", label: "Cafe" },
          { kind: "account", label: "Expenses:Coffee" },
        ],
      },
    });

    it("should type one character every 30ms starting at 150ms", () => {
      expect(timeline.typeCharDelays).toHaveLength(25);
      expect(timeline.typeCharDelays[0]).toBe(150);
      expect(timeline.typeCharDelays[1]).toBe(180);
      expect(timeline.typeCharDelays[24]).toBe(870);
    });

    it("should send the message 250ms after the last typed character", () => {
      expect(timeline.sendAt).toBe(1120);
    });

    it("should show Working 350ms after the send", () => {
      expect(timeline.workingAt).toBe(1470);
    });

    it("should reveal a step every 380ms after Working", () => {
      expect(timeline.stepDelays).toEqual([1850, 2230]);
    });

    it("should swap to Worked 250ms after the last step", () => {
      expect(timeline.doneAt).toBe(2480);
    });

    it("should show the reply 200ms after the swap", () => {
      expect(timeline.replyAt).toBe(2680);
    });

    it("should stream the reply word by word from replyAt", () => {
      expect(timeline.replyWordDelays).toEqual([2680]);
    });

    it("should stagger chips every 100ms starting 150ms after the reply text", () => {
      expect(timeline.chipDelays).toEqual([2830, 2930]);
    });

    it("should end 250ms after the last element", () => {
      expect(timeline.total).toBe(3180);
    });

    it("should leave table and model delays empty", () => {
      expect(timeline.rowDelays).toEqual([]);
      expect(timeline.modelDelays).toEqual([]);
      expect(timeline.attachmentAt).toBeUndefined();
    });
  });

  describe("attachment scene", () => {
    // "Import this" = 11 characters.
    const timeline = buildSceneTimeline({
      user: { text: "Import this", attachment: { name: "statement.pdf", meta: "PDF · 245 KB" } },
      working: { steps: ["Extract Text"], duration: "9s" },
      reply: { text: "Imported." },
    });

    it("should show the attachment card in the composer first, at 150ms", () => {
      expect(timeline.attachmentAt).toBe(150);
    });

    it("should start typing 250ms after the attachment card", () => {
      expect(timeline.typeCharDelays).toHaveLength(11);
      expect(timeline.typeCharDelays[0]).toBe(400);
      expect(timeline.typeCharDelays[10]).toBe(700);
    });

    it("should keep the rest of the chain after the send", () => {
      expect(timeline.sendAt).toBe(950);
      expect(timeline.workingAt).toBe(1300);
      expect(timeline.stepDelays).toEqual([1680]);
      expect(timeline.doneAt).toBe(1930);
      expect(timeline.replyAt).toBe(2130);
      expect(timeline.total).toBe(2380);
    });
  });

  describe("table scene", () => {
    const timeline = buildSceneTimeline({
      user: { text: "Where did my money go?" },
      working: { steps: ["Query Ledger"], duration: "4s" },
      reply: {
        text: "Here:",
        table: {
          head: ["Account", "August"],
          rows: [
            ["Rent", "950 €"],
            ["Food", "400 €"],
            ["Transport", "80 €"],
          ],
        },
      },
    });

    it("should stagger table rows every 120ms starting 200ms after the reply text", () => {
      const replyAt = timeline.replyAt as number;
      expect(timeline.rowDelays).toEqual([replyAt + 200, replyAt + 320, replyAt + 440]);
    });

    it("should end 250ms after the last row", () => {
      expect(timeline.total).toBe((timeline.rowDelays[2] as number) + 250);
    });
  });

  describe("composer scene (model menu only)", () => {
    const timeline = buildSceneTimeline({
      composer: { models: [{ name: "Claude" }, { name: "GPT" }, { name: "Llama", note: "local" }] },
    });

    it("should stagger model rows every 150ms starting at 300ms", () => {
      expect(timeline.modelDelays).toEqual([300, 450, 600]);
    });

    it("should leave the chat delays empty", () => {
      expect(timeline.typeCharDelays).toEqual([]);
      expect(timeline.stepDelays).toEqual([]);
      expect(timeline.sendAt).toBeUndefined();
      expect(timeline.workingAt).toBeUndefined();
      expect(timeline.doneAt).toBeUndefined();
      expect(timeline.replyAt).toBeUndefined();
    });

    it("should end 250ms after the last model row", () => {
      expect(timeline.total).toBe(850);
    });
  });

  describe("edge cases", () => {
    it("should return only the settle time for an empty demo", () => {
      expect(buildSceneTimeline({}).total).toBe(250);
    });

    it("should still send after an empty user text with an attachment", () => {
      const timeline = buildSceneTimeline({ user: { text: "", attachment: { name: "a.pdf", meta: "PDF" } } });
      expect(timeline.typeCharDelays).toEqual([]);
      expect(timeline.attachmentAt).toBe(150);
      expect(timeline.sendAt).toBe(650);
      expect(timeline.total).toBe(900);
    });

    it("should type nothing for a whitespace-only user text", () => {
      const timeline = buildSceneTimeline({ user: { text: "   " } });
      expect(timeline.typeCharDelays).toEqual([]);
      expect(timeline.sendAt).toBe(400);
      expect(timeline.total).toBe(650);
    });

    it("should swap straight to Worked when there are no steps", () => {
      const timeline = buildSceneTimeline({ working: { steps: [], duration: "1s" } });
      expect(timeline.workingAt).toBe(350);
      expect(timeline.stepDelays).toEqual([]);
      expect(timeline.doneAt).toBe(600);
      expect(timeline.total).toBe(850);
    });

    it("should place a reply without working right after the send", () => {
      const timeline = buildSceneTimeline({ user: { text: "Hi" }, reply: { text: "Hello." } });
      expect(timeline.typeCharDelays).toEqual([150, 180]);
      expect(timeline.sendAt).toBe(430);
      expect(timeline.replyAt).toBe(630);
      expect(timeline.total).toBe(880);
    });

    it("should ignore a composer without models", () => {
      expect(buildSceneTimeline({ composer: {} }).total).toBe(250);
    });
  });

  describe("reply streaming", () => {
    it("should stream reply words every 35ms from replyAt", () => {
      const timeline = buildSceneTimeline({ reply: { text: "one two three" } });
      expect(timeline.replyAt).toBe(200);
      expect(timeline.replyWordDelays).toEqual([200, 235, 270]);
      expect(timeline.total).toBe(520);
    });

    it("should start chips after the last streamed word", () => {
      const timeline = buildSceneTimeline({ reply: { text: "one two", chips: [{ kind: "payee", label: "Cafe" }] } });
      expect(timeline.replyWordDelays).toEqual([200, 235]);
      expect(timeline.chipDelays).toEqual([385]);
      expect(timeline.total).toBe(635);
    });

    it("should fall back to replyAt for an empty reply text", () => {
      const timeline = buildSceneTimeline({ reply: { text: "" } });
      expect(timeline.replyWordDelays).toEqual([]);
      expect(timeline.total).toBe(450);
    });
  });

  describe("real feature scenes", () => {
    it("should build a settled, ordered timeline for every landing-page feature", () => {
      expect(features.length).toBeGreaterThan(0);
      for (const feature of features) {
        const timeline = buildSceneTimeline(feature.demo);
        const delays = allDelays(timeline);
        expect(delays.length).toBeGreaterThan(0);
        expect(feature.demo.chatTitle.trim().length).toBeGreaterThan(0);
        for (const delay of delays) {
          expect(timeline.total).toBeGreaterThan(delay);
        }
        expectStrictlyIncreasing(timeline.typeCharDelays);
        expectStrictlyIncreasing(timeline.replyWordDelays);
        expectStrictlyIncreasing(timeline.stepDelays);
        expectStrictlyIncreasing(timeline.chipDelays);
        expectStrictlyIncreasing(timeline.rowDelays);
        expectStrictlyIncreasing(timeline.modelDelays);
      }
    });

    it("should keep every feature scene under five seconds", () => {
      for (const feature of features) {
        expect(buildSceneTimeline(feature.demo).total).toBeLessThan(5000);
      }
    });
  });
});

describe("shiftTimeline()", () => {
  const base = buildSceneTimeline({
    user: { text: "Hi", attachment: { name: "a.pdf", meta: "PDF" } },
    working: { steps: ["Commit"], duration: "1s" },
    reply: { text: "Done.", chips: [{ kind: "payee", label: "Cafe" }], table: { head: ["A"], rows: [["1"]] } },
    composer: { models: [{ name: "Claude" }] },
  });

  it("should move every moment later by the offset", () => {
    const shifted = shiftTimeline(base, 1000);
    expect(shifted.attachmentAt).toBe((base.attachmentAt as number) + 1000);
    expect(shifted.typeCharDelays).toEqual(base.typeCharDelays.map((d) => d + 1000));
    expect(shifted.sendAt).toBe((base.sendAt as number) + 1000);
    expect(shifted.workingAt).toBe((base.workingAt as number) + 1000);
    expect(shifted.stepDelays).toEqual(base.stepDelays.map((d) => d + 1000));
    expect(shifted.doneAt).toBe((base.doneAt as number) + 1000);
    expect(shifted.replyAt).toBe((base.replyAt as number) + 1000);
    expect(shifted.replyWordDelays).toEqual(base.replyWordDelays.map((d) => d + 1000));
    expect(shifted.chipDelays).toEqual(base.chipDelays.map((d) => d + 1000));
    expect(shifted.rowDelays).toEqual(base.rowDelays.map((d) => d + 1000));
    expect(shifted.modelDelays).toEqual(base.modelDelays.map((d) => d + 1000));
    expect(shifted.total).toBe(base.total + 1000);
  });

  it("should keep absent moments absent", () => {
    const shifted = shiftTimeline(buildSceneTimeline({}), 500);
    expect(shifted.attachmentAt).toBeUndefined();
    expect(shifted.sendAt).toBeUndefined();
    expect(shifted.workingAt).toBeUndefined();
    expect(shifted.doneAt).toBeUndefined();
    expect(shifted.replyAt).toBeUndefined();
    expect(shifted.total).toBe(750);
  });

  it("should leave the original untouched", () => {
    const before = JSON.stringify(base);
    shiftTimeline(base, 300);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("buildConversationTimeline()", () => {
  it("should return an empty conversation for no turns", () => {
    expect(buildConversationTimeline([])).toEqual({ turns: [], total: 0 });
  });

  it("should play a single turn exactly like a scene", () => {
    const demo = { user: { text: "Hi" }, reply: { text: "Hello." } };
    const conversation = buildConversationTimeline([demo]);
    expect(conversation.turns).toEqual([buildSceneTimeline(demo)]);
    expect(conversation.total).toBe(880);
  });

  it("should start the second turn 1200ms after the first one settled", () => {
    const first = { user: { text: "Hi" }, reply: { text: "Hello." } }; // settles at 880
    const second = { user: { text: "Ok" } }; // alone: types at 150/180, sends at 430, settles at 680
    const conversation = buildConversationTimeline([first, second]);
    expect(conversation.turns[1]?.typeCharDelays).toEqual([2230, 2260]);
    expect(conversation.turns[1]?.sendAt).toBe(2510);
    expect(conversation.total).toBe(2760);
  });
});

describe("hero demo conversation", () => {
  it("should be a chat of at most two typed turns", () => {
    expect(heroDemo.turns.length).toBeGreaterThan(0);
    expect(heroDemo.turns.length).toBeLessThanOrEqual(2);
    for (const turn of heroDemo.turns) {
      expect(turn.user?.text.trim().length).toBeGreaterThan(0);
    }
    expect(heroDemo.chatTitle.trim().length).toBeGreaterThan(0);
  });

  it("should settle within twelve seconds so the loop stays short", () => {
    const conversation = buildConversationTimeline(heroDemo.turns);
    expect(conversation.total).toBeGreaterThan(0);
    expect(conversation.total).toBeLessThan(12000);
    for (let i = 1; i < conversation.turns.length; i++) {
      const previous = conversation.turns[i - 1] as SceneTimeline;
      const next = conversation.turns[i] as SceneTimeline;
      expect(next.typeCharDelays[0]).toBeGreaterThan(previous.total);
    }
  });
});
