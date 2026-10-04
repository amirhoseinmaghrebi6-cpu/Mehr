import { describe, expect, it } from "vitest";
import { allBoardsTopic, boardAck, boardCommand, boardState, boardStatus, boardTopic, formatPairingCode, parseBoardTopic, parsePairingCode } from "../src/board-protocol.js";

const board = "7e570003-0000-4000-8000-00000000000a";
const command = "7e570004-0000-4000-8000-00000000000b";

describe("board protocol", () => {
  it("builds and parses a board's topics", () => {
    expect(boardTopic(board, "cmd")).toBe(`m2/v1/boards/${board}/cmd`);
    expect(allBoardsTopic("state")).toBe("m2/v1/boards/+/state");
    expect(parseBoardTopic(`m2/v1/boards/${board}/state`)).toEqual({ boardId: board, kind: "state" });
  });

  it.each([
    "m2/v2/boards/7e570003-0000-4000-8000-00000000000a/state",
    "m2/v1/boards/not-a-uuid/state",
    "m2/v1/boards/7e570003-0000-4000-8000-00000000000a/other",
    "m2/v1/boards/7e570003-0000-4000-8000-00000000000a/state/extra",
    "m2/v1/boards/+/state",
  ])("refuses the topic %s", (topic) => {
    expect(parseBoardTopic(topic)).toBeNull();
  });

  it("accepts the four messages", () => {
    expect(boardCommand.safeParse({ id: command, ch: "ch1", cap: "power", val: true, ttl: 30 }).success).toBe(true);
    expect(boardAck.safeParse({ id: command }).success).toBe(true);
    expect(boardAck.safeParse({ id: command, err: "camera_off" }).success).toBe(true);
    expect(boardState.safeParse({ id: command, values: [{ ch: "ch1", cap: "power", val: true }] }).success).toBe(true);
    expect(boardState.safeParse({ values: [{ ch: "meter", cap: "energy_kwh", val: 12.5 }] }).success).toBe(true);
    expect(boardStatus.safeParse({ online: true, fw: "1.0.0" }).success).toBe(true);
    expect(boardStatus.safeParse({ online: false }).success).toBe(true);
  });

  it.each([
    ["a command without a ttl", boardCommand, { id: command, ch: "ch1", cap: "power", val: true }],
    ["a command with a time of day instead of a ttl", boardCommand, { id: command, ch: "ch1", cap: "power", val: true, ttl: 30, at: "15:00" }],
    ["a command for an unknown capability", boardCommand, { id: command, ch: "ch1", cap: "pins", val: true, ttl: 30 }],
    ["a report with no values", boardState, { values: [] }],
    ["a report with extra fields", boardState, { values: [{ ch: "ch1", cap: "power", val: true, gpio: 4 }] }],
    ["a channel that is not a channel key", boardState, { values: [{ ch: "CH 1", cap: "power", val: true }] }],
  ])("refuses %s", (_label, schema, message) => {
    expect(schema.safeParse(message).success).toBe(false);
  });

  it("formats and parses the pairing code", () => {
    const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    expect(parsePairingCode(` ${formatPairingCode("M2-SW2-00A1:7F", code)}\n`)).toEqual({ hardwareUid: "M2-SW2-00A1:7F", code });
    expect(parsePairingCode("M2P1:M2-SW2-00A1:short")).toBeNull();
    expect(parsePairingCode(`https://example.com/?c=${code}`)).toBeNull();
  });
});
