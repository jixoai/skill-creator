import { describe, expect, it } from "vitest";
import {
  readTranscriptScrollSnapshot,
  resolveTranscriptScrollTop,
  saveTranscriptScrollSnapshot,
} from "../transcript-scroll-memory";

describe("transcript scroll memory", () => {
  it("clamps a restored reader position to the current content geometry", () => {
    const sessionId = `scroll-clamp-${crypto.randomUUID()}`;
    saveTranscriptScrollSnapshot(sessionId, {
      scrollTop: 840,
      scrollHeight: 1200,
      viewportHeight: 360,
      pinnedToBottom: false,
    });

    expect(
      resolveTranscriptScrollTop(readTranscriptScrollSnapshot(sessionId)!, {
        scrollHeight: 700,
        clientHeight: 360,
      }),
    ).toBe(340);
  });

  it("keeps at most 200 session snapshots and refreshes entries on read", () => {
    const prefix = `scroll-lru-${crypto.randomUUID()}`;
    const snapshot = {
      scrollTop: 0,
      scrollHeight: 0,
      viewportHeight: 0,
      pinnedToBottom: true,
    };
    for (let index = 0; index < 200; index++) {
      saveTranscriptScrollSnapshot(`${prefix}-${index}`, snapshot);
    }
    readTranscriptScrollSnapshot(`${prefix}-0`);
    saveTranscriptScrollSnapshot(`${prefix}-200`, snapshot);

    expect(readTranscriptScrollSnapshot(`${prefix}-0`)).toEqual(snapshot);
    expect(readTranscriptScrollSnapshot(`${prefix}-1`)).toBeNull();
  });
});
