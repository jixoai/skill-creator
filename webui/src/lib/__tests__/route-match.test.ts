/** Canonical workspace Page route matching regression. */
import { describe, expect, it, vi } from "vitest";

const iconStub = vi.hoisted(() => ({ default: {} }));
vi.mock("@lucide/svelte/icons/boxes", () => iconStub);
vi.mock("@lucide/svelte/icons/book-open", () => iconStub);
vi.mock("@lucide/svelte/icons/settings", () => iconStub);
vi.mock("@lucide/svelte/icons/file-pen-line", () => iconStub);
vi.mock("@lucide/svelte/icons/chart-no-axes-column-increasing", () => iconStub);
vi.mock("@lucide/svelte/icons/message-square", () => iconStub);
vi.mock("$app/state", () => ({
  page: { url: { pathname: "/", search: "", searchParams: new URLSearchParams() } },
}));
vi.mock("$app/navigation", () => ({ goto: () => {} }));

import { matchRouteTree } from "../shell/match.js";
import { workspacesApp } from "../apps/workspaces/manifest.js";
import { creatorApp } from "../apps/creator/manifest.js";
import { wikiApp } from "../apps/wiki/manifest.js";
import { evaluatingApp } from "../apps/evaluating/manifest.js";
import { agentApp } from "../apps/agent/manifest.js";
import { settingsApp } from "../apps/settings/manifest.js";
import { buildHrefById } from "../shell/navigate.js";

const WS = "ws_0123456789abcdef01234567";
const SKILL = `sk_${"a".repeat(24)}`;

function expectActivity(
  app: { manifest: { activities: readonly { root: { id: string }; pattern: string }[] } },
  path: string,
  search: string,
  expectedId: string,
): void {
  const matched = app.manifest.activities
    .map((activity) => ({
      id: activity.root.id,
      result: matchRouteTree(activity.root as never, path, search, activity.pattern),
    }))
    .find((candidate) => candidate.result.kind === "matched");
  const leafId =
    matched?.result.kind === "matched" ? matched.result.chain.at(-1)?.route.id : undefined;
  expect(
    leafId,
    JSON.stringify(
      app.manifest.activities.map((activity) => ({
        id: activity.root.id,
        result: matchRouteTree(activity.root as never, path, search, activity.pattern),
      })),
    ),
  ).toBe(expectedId);
}

describe("Page manifests", () => {
  it("matches the Skills Page at Global and Imported workspace scopes", () => {
    expectActivity(workspacesApp, "/w/~/skills", "", "workspaces.provider");
    expectActivity(
      workspacesApp,
      `/w/${WS}/skills`,
      `?provider=claude-code&skill=${SKILL}&view=detail`,
      "workspaces.provider",
    );
    expectActivity(
      workspacesApp,
      `/w/${WS}/skills/intelligence/claude-code`,
      "?severity=warning",
      "workspaces.intelligence",
    );
  });

  it("keeps ProviderId in the canonical query while adapting it to legacy view params", () => {
    const href = buildHrefById(
      "workspaces.provider",
      { wsId: WS, providerId: "claude-code" },
      { skill: SKILL, view: "detail" },
    );
    const url = new URL(href, "https://skill-creator.invalid");
    expect(url.pathname).toBe(`/w/${WS}/skills`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      skill: SKILL,
      view: "detail",
      provider: "claude-code",
    });
  });

  it("matches Creator home, new, and edit routes with workspace prefix params", () => {
    expectActivity(creatorApp, `/w/${WS}/creator`, "", "creator.home");
    expectActivity(
      creatorApp,
      `/w/${WS}/creator/new/claude-code`,
      "?template=basic",
      "creator.workspace",
    );
    expectActivity(
      creatorApp,
      `/w/${WS}/creator/edit/claude-code/${SKILL}`,
      "?subview=preview",
      "creator.workspace.skill",
    );
  });

  it("matches Wiki, Evaluating, Agent, and Settings Page roots", () => {
    expectActivity(wikiApp, "/w/~/wiki", "", "wiki.scope");
    expectActivity(evaluatingApp, `/w/${WS}/evaluating`, "", "evaluating.home");
    expectActivity(agentApp, "/agent", "", "agent.home");
    expectActivity(settingsApp, "/settings", "", "settings.home");
    expectActivity(settingsApp, "/settings/model", "", "settings.section");
  });

  it("matches the Evaluating three-segment detail route (deep-linkable triple)", () => {
    // evaluating-dashboard design §3 r2：path 三段唯一确定三元组（总览卡与
    // Creator 深链都落这里）。
    expectActivity(
      evaluatingApp,
      `/w/${WS}/evaluating/claude-code/${SKILL}`,
      "",
      "evaluating.detail",
    );
    expectActivity(evaluatingApp, `/w/~/evaluating/claude-code/${SKILL}`, "", "evaluating.detail");
    // 残缺三元组（缺 skillId）不匹配——深链不允许歧义身份。
    for (const activity of evaluatingApp.manifest.activities) {
      expect(
        matchRouteTree(
          activity.root as never,
          `/w/${WS}/evaluating/claude-code`,
          "",
          activity.pattern,
        ).kind,
      ).not.toBe("matched");
    }
  });

  it("does not match migrated legacy paths or partial dynamic segments", () => {
    for (const activity of workspacesApp.manifest.activities) {
      expect(
        matchRouteTree(
          activity.root as never,
          `/workspaces/${WS}/claude-code`,
          "",
          activity.pattern,
        ).kind,
      ).not.toBe("matched");
      expect(
        matchRouteTree(activity.root as never, `/w/${WS}/skills-extra`, "", activity.pattern).kind,
      ).not.toBe("matched");
    }
  });

  it("rejects invalid nested Creator workspace identity before rendering", () => {
    const activity = creatorApp.manifest.activities[1]!;
    const result = matchRouteTree(
      activity.root as never,
      `/w/invalid/creator/edit/claude-code/${SKILL}`,
      "",
      activity.pattern,
    );
    expect(result.kind).toBe("parse-error");
    if (result.kind === "parse-error") expect(result.reason).toBe("params");
  });
});
