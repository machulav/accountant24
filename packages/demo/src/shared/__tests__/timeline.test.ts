import { describe, expect, it } from "vitest";
import { featureScenes } from "../../scenes/all";
import { augustStatements } from "../../scenes/august-statements";
import {
  buildConversationTimeline,
  buildSceneTimeline,
  readingTime,
  replyTokens,
  type SceneTimeline,
  shiftTimeline,
} from "../timeline";

function allDelays(timeline: SceneTimeline): number[] {
  return [
    ...timeline.attachmentDelays,
    ...(timeline.slashAt === undefined ? [] : [timeline.slashAt]),
    ...(timeline.pickerAt === undefined ? [] : [timeline.pickerAt]),
    ...timeline.skillDelays,
    ...timeline.highlightDelays,
    ...(timeline.pickAt === undefined ? [] : [timeline.pickAt]),
    ...timeline.typeCharDelays,
    ...(timeline.sendAt === undefined ? [] : [timeline.sendAt]),
    ...(timeline.workingAt === undefined ? [] : [timeline.workingAt]),
    ...timeline.stepDelays,
    ...(timeline.doneAt === undefined ? [] : [timeline.doneAt]),
    ...(timeline.replyAt === undefined ? [] : [timeline.replyAt]),
    ...timeline.replyWordDelays,
    ...timeline.bulletWordDelays.flat(),
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
      expect(timeline.attachmentDelays).toEqual([]);
      expect(timeline.bulletWordDelays).toEqual([]);
    });

    it("should leave the skill picker moments absent", () => {
      expect(timeline.slashAt).toBeUndefined();
      expect(timeline.pickerAt).toBeUndefined();
      expect(timeline.skillDelays).toEqual([]);
      expect(timeline.highlightDelays).toEqual([]);
      expect(timeline.pickAt).toBeUndefined();
    });
  });

  describe("skill picker scene", () => {
    const options = [
      { name: "skills:recurring-spending", description: "Regular payments." },
      { name: "skills:subscription-audit", description: "Subscriptions." },
      { name: "skills:create-plugin", description: "New plugins." },
    ];
    const timeline = buildSceneTimeline({
      user: { text: "", skill: { picked: "skills:subscription-audit", options } },
    });

    it("should type the slash at 150ms and open the picker 200ms later", () => {
      expect(timeline.slashAt).toBe(150);
      expect(timeline.pickerAt).toBe(350);
    });

    it("should stagger the picker rows every 80ms from the open", () => {
      expect(timeline.skillDelays).toEqual([350, 430, 510]);
    });

    it("should highlight the first row at the open, then walk down one second after the last row", () => {
      expect(timeline.highlightDelays).toEqual([350, 1510]);
    });

    it("should pick the skill 600ms after the highlight reached it", () => {
      expect(timeline.pickAt).toBe(2110);
    });

    it("should type nothing and send 500ms after the pick when there is no text", () => {
      expect(timeline.typeCharDelays).toEqual([]);
      expect(timeline.sendAt).toBe(2610);
      expect(timeline.total).toBe(2860);
    });

    it("should type the text 250ms after the pick when there is one", () => {
      // "for this year" = 13 characters.
      const withText = buildSceneTimeline({
        user: { text: "for this year", skill: { picked: "skills:subscription-audit", options } },
      });
      expect(withText.pickAt).toBe(2110);
      expect(withText.typeCharDelays).toHaveLength(13);
      expect(withText.typeCharDelays[0]).toBe(2360);
      expect(withText.typeCharDelays[12]).toBe(2720);
      expect(withText.sendAt).toBe(2970);
    });

    it("should pick the first row without walking, 600ms after the last row appeared", () => {
      const first = buildSceneTimeline({
        user: { text: "", skill: { picked: "skills:recurring-spending", options } },
      });
      expect(first.highlightDelays).toEqual([350]);
      expect(first.pickAt).toBe(1110);
    });

    it("should walk one row every 450ms down to the last row", () => {
      const last = buildSceneTimeline({
        user: { text: "", skill: { picked: "skills:create-plugin", options } },
      });
      expect(last.highlightDelays).toEqual([350, 1510, 1960]);
      expect(last.pickAt).toBe(2560);
    });

    it("should type the slash 250ms after the last attachment card", () => {
      const attached = buildSceneTimeline({
        user: {
          text: "",
          attachments: [{ name: "a.pdf", meta: "PDF" }],
          skill: { picked: "skills:subscription-audit", options },
        },
      });
      expect(attached.attachmentDelays).toEqual([150]);
      expect(attached.slashAt).toBe(400);
      expect(attached.pickerAt).toBe(600);
    });

    it("should keep the rest of the chain after the send", () => {
      const chain = buildSceneTimeline({
        user: { text: "", skill: { picked: "skills:subscription-audit", options } },
        working: { steps: ["Use Skill"], duration: "2s" },
        reply: { text: "Done." },
      });
      expect(chain.sendAt).toBe(2610);
      expect(chain.workingAt).toBe(2960);
      expect(chain.stepDelays).toEqual([3340]);
      expect(chain.doneAt).toBe(3590);
      expect(chain.replyAt).toBe(3790);
      expect(chain.total).toBe(4040);
    });

    it("should throw when the picked skill is not one of the options", () => {
      expect(() => buildSceneTimeline({ user: { text: "", skill: { picked: "skills:missing", options } } })).toThrow(
        'The picked skill "skills:missing" is not one of the picker\'s options.',
      );
    });

    it("should throw when there are no options to pick from", () => {
      expect(() => buildSceneTimeline({ user: { text: "", skill: { picked: "skills:x", options: [] } } })).toThrow();
    });
  });

  describe("attachment scene", () => {
    // "Import this" = 11 characters.
    const timeline = buildSceneTimeline({
      user: { text: "Import this", attachments: [{ name: "statement.pdf", meta: "PDF · 245 KB" }] },
      working: { steps: ["Extract Text"], duration: "9s" },
      reply: { text: "Imported." },
    });

    it("should show the attachment card in the composer first, at 150ms", () => {
      expect(timeline.attachmentDelays).toEqual([150]);
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

  describe("several attachments", () => {
    // "Import these" = 12 characters.
    const timeline = buildSceneTimeline({
      user: {
        text: "Import these",
        attachments: [
          { name: "a.pdf", meta: "PDF" },
          { name: "b.csv", meta: "CSV" },
          { name: "c.pdf", meta: "PDF" },
        ],
      },
    });

    it("should stagger the attachment cards every 150ms from 150ms", () => {
      expect(timeline.attachmentDelays).toEqual([150, 300, 450]);
    });

    it("should start typing 250ms after the last card", () => {
      expect(timeline.typeCharDelays[0]).toBe(700);
      expect(timeline.typeCharDelays[11]).toBe(1030);
      expect(timeline.sendAt).toBe(1280);
    });
  });

  describe("bullet scene", () => {
    // "Done. Two things:" = 3 words -> last word at replyAt + 70.
    const timeline = buildSceneTimeline({
      user: { text: "Hi" },
      reply: {
        text: "Done. Two things:",
        bullets: ["First one", "Second"],
        chips: [{ kind: "payee", label: "Netflix" }],
        table: { head: ["A", "B"], rows: [["x", "1"]] },
      },
    });
    // "Hi": type at 150, 180; send 430; reply 630; last word 700.

    it("should stream the first bullet word by word from 200ms after the reply text", () => {
      expect(timeline.replyAt).toBe(630);
      expect(timeline.bulletWordDelays[0]).toEqual([900, 935]);
    });

    it("should start the next bullet 120ms after the previous bullet's last word", () => {
      expect(timeline.bulletWordDelays[1]).toEqual([1055]);
    });

    it("should start chips and rows after the last bullet word", () => {
      expect(timeline.chipDelays).toEqual([1205]);
      expect(timeline.rowDelays).toEqual([1255]);
    });

    it("should end 250ms after the last element", () => {
      expect(timeline.total).toBe(1505);
    });

    it("should skip an empty bullet without breaking the chain", () => {
      const empty = buildSceneTimeline({ reply: { text: "Hi", bullets: ["", "One"] } });
      // "Hi" streams at 200; the empty bullet still takes its slot at 400.
      expect(empty.bulletWordDelays).toEqual([[], [520]]);
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
            ["Rent", "$1,850"],
            ["Food", "$400"],
            ["Gas", "$80"],
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
      const timeline = buildSceneTimeline({ user: { text: "", attachments: [{ name: "a.pdf", meta: "PDF" }] } });
      expect(timeline.typeCharDelays).toEqual([]);
      expect(timeline.attachmentDelays).toEqual([150]);
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
    it("should build a settled, ordered timeline for every scene", () => {
      expect(featureScenes.length).toBeGreaterThan(0);
      for (const demo of featureScenes) {
        const timeline = buildSceneTimeline(demo);
        const delays = allDelays(timeline);
        expect(delays.length).toBeGreaterThan(0);
        expect(demo.chatTitle.trim().length).toBeGreaterThan(0);
        for (const delay of delays) {
          expect(timeline.total).toBeGreaterThan(delay);
        }
        expectStrictlyIncreasing(timeline.typeCharDelays);
        expectStrictlyIncreasing(timeline.skillDelays);
        expectStrictlyIncreasing(timeline.highlightDelays);
        expectStrictlyIncreasing(timeline.replyWordDelays);
        expectStrictlyIncreasing(timeline.stepDelays);
        expectStrictlyIncreasing(timeline.chipDelays);
        expectStrictlyIncreasing(timeline.rowDelays);
        expectStrictlyIncreasing(timeline.modelDelays);
      }
    });

    it("should keep every feature scene under seven seconds", () => {
      for (const demo of featureScenes) {
        expect(buildSceneTimeline(demo).total).toBeLessThan(7000);
      }
    });
  });
});

describe("shiftTimeline()", () => {
  const base = buildSceneTimeline({
    user: {
      text: "Hi",
      attachments: [{ name: "a.pdf", meta: "PDF" }],
      skill: {
        picked: "skills:b",
        options: [
          { name: "skills:a", description: "" },
          { name: "skills:b", description: "" },
        ],
      },
    },
    working: { steps: ["Commit"], duration: "1s" },
    reply: {
      text: "Done.",
      bullets: ["One"],
      chips: [{ kind: "payee", label: "Cafe" }],
      table: { head: ["A"], rows: [["1"]] },
    },
    composer: { models: [{ name: "Claude" }] },
  });

  it("should move every moment later by the offset", () => {
    const shifted = shiftTimeline(base, 1000);
    expect(shifted.attachmentDelays).toEqual(base.attachmentDelays.map((d) => d + 1000));
    expect(shifted.slashAt).toBe((base.slashAt as number) + 1000);
    expect(shifted.pickerAt).toBe((base.pickerAt as number) + 1000);
    expect(shifted.skillDelays).toEqual(base.skillDelays.map((d) => d + 1000));
    expect(shifted.highlightDelays).toEqual(base.highlightDelays.map((d) => d + 1000));
    expect(shifted.pickAt).toBe((base.pickAt as number) + 1000);
    expect(shifted.typeCharDelays).toEqual(base.typeCharDelays.map((d) => d + 1000));
    expect(shifted.sendAt).toBe((base.sendAt as number) + 1000);
    expect(shifted.workingAt).toBe((base.workingAt as number) + 1000);
    expect(shifted.stepDelays).toEqual(base.stepDelays.map((d) => d + 1000));
    expect(shifted.doneAt).toBe((base.doneAt as number) + 1000);
    expect(shifted.replyAt).toBe((base.replyAt as number) + 1000);
    expect(shifted.replyWordDelays).toEqual(base.replyWordDelays.map((d) => d + 1000));
    expect(shifted.bulletWordDelays).toEqual(base.bulletWordDelays.map((words) => words.map((d) => d + 1000)));
    expect(shifted.chipDelays).toEqual(base.chipDelays.map((d) => d + 1000));
    expect(shifted.rowDelays).toEqual(base.rowDelays.map((d) => d + 1000));
    expect(shifted.modelDelays).toEqual(base.modelDelays.map((d) => d + 1000));
    expect(shifted.total).toBe(base.total + 1000);
  });

  it("should keep absent moments absent", () => {
    const shifted = shiftTimeline(buildSceneTimeline({}), 500);
    expect(shifted.attachmentDelays).toEqual([]);
    expect(shifted.slashAt).toBeUndefined();
    expect(shifted.pickerAt).toBeUndefined();
    expect(shifted.pickAt).toBeUndefined();
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

describe("replyTokens()", () => {
  it("should split plain prose on whitespace", () => {
    expect(replyTokens("Done.  Two\nthings:")).toEqual(["Done.", "Two", "things:"]);
  });

  it("should keep a mention with spaces in its label as one token", () => {
    expect(replyTokens("$42.50 at :payee[Trader Joe's] went to :account[Expenses:Groceries].")).toEqual([
      "$42.50",
      "at",
      ":payee[Trader Joe's]",
      "went",
      "to",
      ":account[Expenses:Groceries].",
    ]);
  });

  it("should return nothing for empty or blank text", () => {
    expect(replyTokens("")).toEqual([]);
    expect(replyTokens("   ")).toEqual([]);
  });
});

describe("readingTime()", () => {
  it("should be zero without a reply", () => {
    expect(readingTime({})).toBe(0);
    expect(readingTime({ user: { text: "Hi" } })).toBe(0);
  });

  it("should grant 180ms per word of reply prose", () => {
    expect(readingTime({ reply: { text: "Done. Three things I noticed:" } })).toBe(900);
  });

  it("should count bullets, chips, and table cells as words too", () => {
    const time = readingTime({
      reply: {
        text: "Two things:", // 2
        bullets: ["First one", "Second"], // 3
        chips: [{ kind: "payee", label: "Whole Foods" }], // 2
        table: { head: ["Account", "Balance"], rows: [["Cash", "$12,450"]] }, // 4
      },
    });
    expect(time).toBe(11 * 180);
  });

  it("should ignore extra whitespace", () => {
    expect(readingTime({ reply: { text: "  a   b  " } })).toBe(360);
  });

  it("should count a mention as one word", () => {
    expect(readingTime({ reply: { text: "At :payee[Trader Joe's] today" } })).toBe(540);
  });
});

describe("buildConversationTimeline()", () => {
  it("should return an empty conversation for no turns", () => {
    expect(buildConversationTimeline([])).toEqual({ turns: [], total: 0, holdAfter: 0 });
  });

  it("should play a single turn exactly like a scene", () => {
    const demo = { user: { text: "Hi" }, reply: { text: "Hello." } };
    const conversation = buildConversationTimeline([demo]);
    expect(conversation.turns).toEqual([buildSceneTimeline(demo)]);
    expect(conversation.total).toBe(880);
  });

  it("should start the second turn 1200ms plus the reading time after the first one settled", () => {
    const first = { user: { text: "Hi" }, reply: { text: "Hello." } }; // settles at 880, one word to read: 180
    const second = { user: { text: "Ok" } }; // alone: types at 150/180, sends at 430, settles at 680
    const conversation = buildConversationTimeline([first, second]);
    expect(conversation.turns[1]?.typeCharDelays).toEqual([2410, 2440]);
    expect(conversation.turns[1]?.sendAt).toBe(2690);
    expect(conversation.total).toBe(2940);
  });

  it("should hold the final frame 2500ms plus the last turn's reading time", () => {
    const first = { user: { text: "Hi" }, reply: { text: "Hello there." } };
    const second = { user: { text: "Ok" }, reply: { text: "Sure, done." } }; // 2 words: 360
    expect(buildConversationTimeline([first, second]).holdAfter).toBe(2860);
    expect(buildConversationTimeline([second, { user: { text: "Ok" } }]).holdAfter).toBe(2500);
  });
});

describe("hero scene", () => {
  it("should be a chat of at most two typed turns", () => {
    expect(augustStatements.turns.length).toBeGreaterThan(0);
    expect(augustStatements.turns.length).toBeLessThanOrEqual(2);
    for (const turn of augustStatements.turns) {
      expect(turn.user?.text.trim().length).toBeGreaterThan(0);
    }
    expect(augustStatements.chatTitle.trim().length).toBeGreaterThan(0);
  });

  it("should play and hold within thirty-five seconds so the loop stays watchable", () => {
    const conversation = buildConversationTimeline(augustStatements.turns);
    expect(conversation.total).toBeGreaterThan(0);
    expect(conversation.total + conversation.holdAfter).toBeLessThan(35000);
    for (let i = 1; i < conversation.turns.length; i++) {
      const previous = conversation.turns[i - 1] as SceneTimeline;
      const next = conversation.turns[i] as SceneTimeline;
      expect(next.typeCharDelays[0]).toBeGreaterThan(previous.total);
    }
  });
});
