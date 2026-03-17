import { test, expect, describe } from "bun:test";
import { GapContainer } from "../gap-container.js";
import type { Component } from "@mariozechner/pi-tui";

function mockComponent(lines: string[]): Component {
  return {
    render: () => lines,
    invalidate: () => {},
  };
}

describe("GapContainer", () => {
  test("renders nothing when there are no children", () => {
    const gc = new GapContainer(1);
    expect(gc.render(80)).toEqual([]);
  });

  test("renders a single child with no surrounding gaps", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["hello"]));
    expect(gc.render(80)).toEqual(["hello"]);
  });

  test("renders one empty line between two children when gap is 1", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("renders two empty lines between children when gap is 2", () => {
    const gc = new GapContainer(2);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "", "b"]);
  });

  test("renders children back-to-back when gap is 0", () => {
    const gc = new GapContainer(0);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "b"]);
  });

  test("defaults to gap of 1 when no argument is given", () => {
    const gc = new GapContainer();
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("children rendering 0 lines are ignored and produce no extra gap", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("multiple consecutive empty children still produce only one gap", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("renders nothing when all children are empty", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent([]));
    expect(gc.render(80)).toEqual([]);
  });

  test("leading empty child is ignored", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent([]));
    gc.addChild(mockComponent(["a"]));
    expect(gc.render(80)).toEqual(["a"]);
  });

  test("trailing empty child is ignored", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent([]));
    expect(gc.render(80)).toEqual(["a"]);
  });

  test("preserves all lines from multi-line children", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a1", "a2"]));
    gc.addChild(mockComponent(["b1", "b2", "b3"]));
    expect(gc.render(80)).toEqual(["a1", "a2", "", "b1", "b2", "b3"]);
  });

  test("inserts a gap between each pair of three children", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    gc.addChild(mockComponent(["c"]));
    expect(gc.render(80)).toEqual(["a", "", "b", "", "c"]);
  });

  test("forwards the width argument to each child", () => {
    const widths: number[] = [];
    const gc = new GapContainer(1);
    gc.addChild({
      render: (w: number) => { widths.push(w); return ["x"]; },
      invalidate: () => {},
    });
    gc.addChild({
      render: (w: number) => { widths.push(w); return ["y"]; },
      invalidate: () => {},
    });
    gc.render(42);
    expect(widths).toEqual([42, 42]);
  });

  test("strips leading empty lines from a child's output", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["", "b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("strips trailing empty lines from a child's output", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a", ""]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("strips both leading and trailing empty lines from a child", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["", "", "a", ""]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("child that is only empty lines is skipped entirely", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["", "", ""]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b"]);
  });

  test("preserves internal empty lines within a child's content", () => {
    const gc = new GapContainer(1);
    gc.addChild(mockComponent(["a", "", "b"]));
    gc.addChild(mockComponent(["c"]));
    expect(gc.render(80)).toEqual(["a", "", "b", "", "c"]);
  });

  test("appends trailing gap after the last child", () => {
    const gc = new GapContainer(1, 1);
    gc.addChild(mockComponent(["a"]));
    gc.addChild(mockComponent(["b"]));
    expect(gc.render(80)).toEqual(["a", "", "b", ""]);
  });

  test("no trailing gap when there are no children", () => {
    const gc = new GapContainer(1, 1);
    expect(gc.render(80)).toEqual([]);
  });

  test("no trailing gap when all children are empty", () => {
    const gc = new GapContainer(1, 1);
    gc.addChild(mockComponent([]));
    expect(gc.render(80)).toEqual([]);
  });

  test("trailing gap of 2 appends two empty lines", () => {
    const gc = new GapContainer(1, 2);
    gc.addChild(mockComponent(["a"]));
    expect(gc.render(80)).toEqual(["a", "", ""]);
  });
});
