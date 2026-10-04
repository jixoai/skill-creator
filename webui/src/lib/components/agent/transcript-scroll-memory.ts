/** Bounded, UI-only transcript position memory keyed by the server-owned session id. */
export interface TranscriptScrollSnapshot {
  scrollTop: number;
  scrollHeight: number;
  viewportHeight: number;
  pinnedToBottom: boolean;
}

const MAX_ENTRIES = 200;
const snapshots = new Map<string, TranscriptScrollSnapshot>();

export function readTranscriptScrollSnapshot(sessionId: string): TranscriptScrollSnapshot | null {
  const snapshot = snapshots.get(sessionId);
  if (!snapshot) return null;
  snapshots.delete(sessionId);
  snapshots.set(sessionId, snapshot);
  return snapshot;
}

export function saveTranscriptScrollSnapshot(
  sessionId: string,
  snapshot: TranscriptScrollSnapshot,
): void {
  snapshots.delete(sessionId);
  snapshots.set(sessionId, snapshot);
  while (snapshots.size > MAX_ENTRIES) {
    const oldestSessionId = snapshots.keys().next().value;
    if (oldestSessionId === undefined) return;
    snapshots.delete(oldestSessionId);
  }
}

export function resolveTranscriptScrollTop(
  snapshot: Pick<TranscriptScrollSnapshot, "scrollTop">,
  metrics: Pick<HTMLElement, "clientHeight" | "scrollHeight">,
): number {
  return Math.min(
    Math.max(snapshot.scrollTop, 0),
    Math.max(metrics.scrollHeight - metrics.clientHeight, 0),
  );
}
