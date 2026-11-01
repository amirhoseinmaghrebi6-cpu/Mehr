import { describe, expect, it } from "vitest";
import { RecentCounter } from "../src/http/recent";

describe("RecentCounter", () => {
  it("counts events in the window only", () => {
    let now = 0;
    const counter = new RecentCounter(1000, 10, () => now);
    counter.add("a");
    now = 500;
    counter.add("a");
    expect(counter.count("a")).toBe(2);
    now = 1200;
    expect(counter.count("a")).toBe(1);
    expect(counter.count("b")).toBe(0);
  });

  it("never holds more keys than its ceiling, forgetting the oldest first", () => {
    let now = 0;
    const counter = new RecentCounter(60_000, 100, () => now);
    for (let i = 0; i < 10_000; i++) {
      now = i;
      counter.add(`board-${i}`);
    }
    expect(counter.size).toBeLessThanOrEqual(100);
    expect(counter.count("board-9999")).toBe(1);
    expect(counter.count("board-0")).toBe(0);
  });

  it("sweeps keys whose events are all old", () => {
    let now = 0;
    const counter = new RecentCounter(1000, 3, () => now);
    counter.add("a");
    counter.add("b");
    counter.add("c");
    now = 5000;
    counter.add("d");
    expect(counter.size).toBe(1);
  });
});
