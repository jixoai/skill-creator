/**
 * User input [2026-07-14]: "FrameReader close 前后消费不悬挂；限制 frame 最大字节并以可测试错误终止。"
 *
 * Orthogonal intents:
 *   [1] Prove close terminates consumers regardless of subscription timing.
 *   [2] Prove inbound and outbound frame limits fail with a stable typed error.
 */
import { describe, expect, it } from "vitest";
import {
  encodeFrame,
  FrameReader,
  IpcFrameTooLargeError,
  MAX_IPC_FRAME_BYTES,
} from "../src/shared/frame.js";

describe("FrameReader terminal states", () => {
  it("finishes an iterator created after close", async () => {
    const reader = new FrameReader();
    reader.close();

    await expect(reader.frames()[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("releases a consumer already waiting when close occurs", async () => {
    const reader = new FrameReader();
    const iterator = reader.frames()[Symbol.asyncIterator]();
    const pending = iterator.next();

    reader.close();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
  });

  it("drains a complete pending frame before finishing", async () => {
    const reader = new FrameReader();
    reader.push(encodeFrame({ ready: true }));
    reader.close();
    const iterator = reader.frames()[Symbol.asyncIterator]();

    const frame = await iterator.next();
    expect(frame.done).toBe(false);
    expect(JSON.parse(Buffer.from(frame.value ?? []).toString("utf8"))).toEqual({ ready: true });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("terminates with a typed error as soon as the header exceeds the limit", async () => {
    const reader = new FrameReader(8);
    const iterator = reader.frames()[Symbol.asyncIterator]();
    const pending = iterator.next();
    const header = Buffer.alloc(4);
    header.writeUInt32BE(9);

    reader.push(header);

    await expect(pending).rejects.toMatchObject({
      name: "IpcFrameTooLargeError",
      frameBytes: 9,
      maxFrameBytes: 8,
    });
  });

  it("rejects oversized outbound frames with the same typed error", () => {
    expect(() => encodeFrame("x".repeat(MAX_IPC_FRAME_BYTES))).toThrow(IpcFrameTooLargeError);
  });
});
