/**
 * Shell omnibox input contract.
 * Original request [2026-10-03]: show `skill-creator://` URLs, accept pasted
 * scheme or local paths, and share command completion with the command palette.
 * Orthogonal intents:
 *   [1] Parse local path and command input without browser navigation side effects.
 *   [2] Rank route completions deterministically.
 *   [3] Map shell navigation shortcuts.
 */

export const OMNIBOX_SCHEME = "skill-creator://";

export type OmniboxInput =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly query: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "invalid"; readonly reason: "unsupported-url" | "malformed-path" };

export interface PathCompletion {
  readonly path: string;
  readonly label: string;
}

export interface HistoryStackState {
  readonly entries: readonly string[];
  readonly cursor: number;
}

export interface HistoryAvailability {
  readonly back: boolean;
  readonly forward: boolean;
}

export type OmniboxShortcut =
  | "open-command-center"
  | "focus"
  | "back"
  | "forward"
  | "open-settings"
  | "switch-theme";

/** Parse omnibox text; the custom scheme is display syntax, never a network URL. */
export function parseOmniboxInput(input: string): OmniboxInput {
  const value = input.trim();
  if (value.length === 0) return { kind: "empty" };
  if (/^>\s/.test(value) || value === ">") {
    return { kind: "command", query: value.slice(1).trim() };
  }

  const path = value.toLowerCase().startsWith(OMNIBOX_SCHEME)
    ? parseSchemePath(value.slice(OMNIBOX_SCHEME.length))
    : value;
  if (path === null) return { kind: "invalid", reason: "unsupported-url" };
  if (!isLocalPath(path)) return { kind: "invalid", reason: "malformed-path" };
  return { kind: "path", path };
}

function parseSchemePath(source: string): string | null {
  if (source.length === 0 || source.includes("#") || /[\u0000-\u001f\s]/.test(source)) return null;
  if (source.startsWith("/")) return source;

  const boundary = source.search(/[/?]/);
  const authority = boundary < 0 ? source : source.slice(0, boundary);
  const queryStart = source.indexOf("?");
  const suffix =
    boundary < 0 ? (queryStart < 0 ? "" : source.slice(queryStart)) : source.slice(boundary);
  if (authority !== "w" && authority !== "agent" && authority !== "settings") return null;
  return `/${authority}${suffix}`;
}

function isLocalPath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  if (/[\u0000-\u001f\s#]/.test(path) || /%(?![\da-f]{2})/i.test(path)) return false;
  return true;
}

/** Stable prefix ranking for route candidates, with exact path matches first. */
export function rankPathCompletions(
  query: string,
  completions: readonly PathCompletion[],
): PathCompletion[] {
  const needle = query.trim().toLocaleLowerCase();
  return completions
    .map((completion, index) => {
      const path = completion.path.toLocaleLowerCase();
      const label = completion.label.toLocaleLowerCase();
      const rank =
        path === needle
          ? 0
          : path.startsWith(needle)
            ? 1
            : label.startsWith(needle)
              ? 2
              : path.includes(needle) || label.includes(needle)
                ? 3
                : Number.POSITIVE_INFINITY;
      return { completion, index, rank };
    })
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ completion }) => completion);
}

/** Derive navigation button enabled states from the active tab's app-owned stack. */
export function historyAvailability(stack: HistoryStackState | undefined): HistoryAvailability {
  if (!stack) return { back: false, forward: false };
  return {
    back: stack.cursor > 0,
    forward: stack.cursor < stack.entries.length - 1,
  };
}

/** Shell-local keyboard shortcuts; callers decide whether the event is handled. */
export function omniboxShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey"> & {
    altKey?: boolean;
    shiftKey?: boolean;
  },
): OmniboxShortcut | null {
  if (event.key === "F6") return "focus";
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return null;
  if (event.shiftKey && event.key.toLowerCase() === "p") return "open-command-center";
  if (!event.shiftKey && event.key === ",") return "open-settings";
  if (event.shiftKey && event.key.toLowerCase() === "l") return "switch-theme";
  if (event.shiftKey) return null;
  if (event.key.toLowerCase() === "l") return "focus";
  if (event.key === "[" || event.code === "BracketLeft") return "back";
  if (event.key === "]" || event.code === "BracketRight") return "forward";
  return null;
}

/** Convert a real shell path to the omnibox's copyable display URL. */
export function formatOmniboxUrl(path: string): string {
  const match = /^\/(w|agent|settings)(?=\/|\?|$)/.exec(path);
  return match
    ? `${OMNIBOX_SCHEME}${path.slice(1)}`
    : `${OMNIBOX_SCHEME}${path.replace(/^\//, "")}`;
}
