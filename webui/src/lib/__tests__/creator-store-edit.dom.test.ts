// @vitest-environment jsdom
/**
 * Creator store 编辑/创建流 dom 测试（creator-skill-store 批 2 / tasks 批 2 第 1-2 行）。
 *
 * 用户原始需求 [2026-10-09]（proposal）：「Creator 的 new 模式全部落 store……仅目标
 * 根改指 store」「创建成功即自动应用到 ~/.agents/skills」。
 *
 * 正交意图：
 *   [1] store 编辑路由钉：/w/:wsId/creator/store/:directoryName 挂载即
 *       creatorStore.load hydrate（body/revision 同币）；保存走 creatorStore.save
 *       的 expectedRevision 契约。
 *   [2] new 路由 store 直建钉：表单校验沿用；Create 调 creatorStore.create；
 *       auto-apply 收据如实呈现（成功 toast 含已应用位置）；成功后跳 store 编辑路由。
 */
import { flushSync, mount, unmount } from "./svelte-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../stores/connection.svelte",
  async () => await import("./stubs/connection-store-stub.svelte"),
);
// @ts-expect-error -- 无类型声明的运行时直连（与 svelte-client.ts 同法；统一 client 入口）
vi.mock("svelte", async () => await import("../../../node_modules/svelte/src/index-client.js"));

vi.mock("../shell/portal-context.svelte", async () => {
  const { shellRouteState } = await import("./stubs/shell-route-stub.svelte");
  return {
    useParams:
      <T>() =>
      () =>
        shellRouteState.params as T,
    useSearch:
      <T>() =>
      () =>
        shellRouteState.search as T,
    useRoute: () => undefined,
    useApp: () => undefined,
  };
});
vi.mock("$app/state", () => ({
  page: {
    url: {
      pathname: "/w/ws_0123456789abcdef01234567/creator/store/my-skill",
      search: "?subview=file",
      searchParams: new URLSearchParams("subview=file"),
    },
    params: {},
  },
}));
// vi.mock 工厂提升到文件顶——gotoMock 必须经 vi.hoisted 声明（否则 TDZ）。
const { gotoMock } = vi.hoisted(() => ({ gotoMock: vi.fn() }));
vi.mock("$app/navigation", () => ({ goto: gotoMock }));
vi.mock("../toast.svelte", () => ({ showToast: vi.fn() }));
vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("./stubs/ui-button-stub.svelte");
  return { Button: stub };
});
vi.mock("$lib/components/ui/input", async () => {
  const { default: stub } = await import("./stubs/ui-input-stub.svelte");
  return { Input: stub };
});
vi.mock("../components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("./stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});

import CreatorWorkspace from "../apps/creator/CreatorWorkspace.svelte";
import { connectMockClient, resetConnectionStub } from "./stubs/connection-store-stub.svelte";
import { shellRouteState } from "./stubs/shell-route-stub.svelte";
import { showToast } from "../toast.svelte";
import { dropCachedCreatorDraft, resetDraftHydration } from "../stores/creator-editor.svelte";
import { SkillDirectoryNameSchema } from "$shared/contracts/creator.js";

const WS = "ws_0123456789abcdef01234567";
const REVISION = `sha256:${"c".repeat(64)}`;
const NEW_REVISION = `sha256:${"d".repeat(64)}`;
const HOME_AGENTS = "/home/tester/.agents/skills";

function storeDocument(directoryName: string) {
  return {
    skillId: `sk_${directoryName.padEnd(24, "0").slice(0, 22)}`,
    directoryName,
    frontmatter: { name: directoryName, description: `Skill ${directoryName}.` },
    body: `# ${directoryName}\n\nInitial body.\n`,
    revision: REVISION,
  };
}

function makeRpcMock() {
  return {
    creatorStore: {
      load: vi
        .fn()
        .mockImplementation(({ directoryName }: { directoryName: string }) =>
          storeDocument(directoryName),
        ),
      create: vi.fn().mockResolvedValue({
        document: storeDocument("my-new-skill"),
        validation: { success: true, errors: [], warnings: [] },
        autoApply: {
          kind: "result" as const,
          results: [
            {
              root: HOME_AGENTS,
              path: `${HOME_AGENTS}/my-new-skill`,
              status: "applied" as const,
              mode: "entity-local" as const,
              entity: "created" as const,
            },
          ],
          applied: 1,
          unchanged: 0,
          failed: 0,
        },
      }),
      save: vi.fn().mockResolvedValue({
        document: { ...storeDocument("my-skill"), revision: NEW_REVISION },
        validation: { success: true, errors: [], warnings: [] },
      }),
    },
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function setInputValue(selector: string, value: string): void {
  const input = target?.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`input not found: ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

let target: HTMLElement | null = null;

beforeEach(() => {
  resetConnectionStub();
  shellRouteState.search = { subview: "file" };
  gotoMock.mockReset();
  vi.mocked(showToast).mockClear();
  target = document.body.appendChild(document.createElement("div"));
});

function clearDraftIdentity(directoryName: string): void {
  const key = `store:${SkillDirectoryNameSchema.parse(directoryName)}`;
  dropCachedCreatorDraft(key);
  resetDraftHydration(key);
}

describe("creator store edit route (/w/:wsId/creator/store/:directoryName)", () => {
  beforeEach(() => {
    shellRouteState.params = { wsId: WS, directoryName: "my-skill" };
    clearDraftIdentity("my-skill");
  });

  it("loads the store document on mount and saves through the revision contract", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorWorkspace, { target: target as HTMLElement });
    await flushAsync();

    expect(rpc.creatorStore.load).toHaveBeenCalledWith({ directoryName: "my-skill" });
    // 草稿 hydrate：Name 字段 = 服务器名；store 面包屑在页头。
    const nameInput = target?.querySelector<HTMLInputElement>("input[placeholder='Skill name']");
    expect(nameInput?.value).toBe("my-skill");
    expect(target?.textContent).toContain("Creator store");

    // 编辑后保存：expectedRevision = 已载文档 revision。
    setInputValue("input[placeholder='Skill name']", "my-skill-renamed");
    const saveButton = [...(target?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Save",
    );
    saveButton?.click();
    await flushAsync();

    expect(rpc.creatorStore.save).toHaveBeenCalledWith({
      directoryName: "my-skill",
      expectedRevision: REVISION,
      frontmatter: { name: "my-skill-renamed", description: "Skill my-skill." },
      body: `# my-skill\n\nInitial body.\n`,
    });
    expect(vi.mocked(showToast)).toHaveBeenCalled();

    unmount(instance);
  });

  it("does not render the directory-name input for store skills (identity is fixed)", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorWorkspace, { target: target as HTMLElement });
    await flushAsync();

    expect(target?.querySelector("input[placeholder='my-skill']")).toBeNull();

    unmount(instance);
  });
});

describe("creator store direct-create route (/w/:wsId/creator/new)", () => {
  beforeEach(() => {
    shellRouteState.params = { wsId: WS };
    dropCachedCreatorDraft("new:~/user");
    resetDraftHydration("new:~/user");
  });

  it("creates through creatorStore.create, surfaces the auto-apply receipt, and jumps to the store editor", async () => {
    const rpc = makeRpcMock();
    connectMockClient(rpc as unknown as Record<string, unknown>);
    const instance = mount(CreatorWorkspace, { target: target as HTMLElement });
    await flushAsync();

    // new 表单：目录名输入在场；Save 按钮 = Create。
    expect(target?.querySelector("input[placeholder='my-skill']")).not.toBeNull();

    setInputValue("input[placeholder='my-skill']", "my-new-skill");
    setInputValue("input[placeholder='Skill name']", "my-new-skill");
    const description = target?.querySelector<HTMLTextAreaElement>(
      "textarea[placeholder='What this skill does']",
    );
    if (description) {
      description.value = "Fresh from the store face.";
      description.dispatchEvent(new Event("input", { bubbles: true }));
      flushSync();
    }
    const createButton = [...(target?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Create",
    );
    expect(createButton?.disabled).toBe(false);
    createButton?.click();
    await flushAsync();

    expect(rpc.creatorStore.create).toHaveBeenCalledWith({
      directoryName: "my-new-skill",
      frontmatter: { name: "my-new-skill", description: "Fresh from the store face." },
      body: "",
    });
    // auto-apply 收据如实呈现：成功 toast 含已应用位置。
    const toast = vi.mocked(showToast).mock.calls[0]?.[0];
    expect(toast).toContain(HOME_AGENTS);
    // 保存后跳 store 编辑路由（tasks 批 2：「保存后跳/示应用结果」）。
    expect(gotoMock).toHaveBeenCalledWith(`/w/${WS}/creator/store/my-new-skill`);

    unmount(instance);
  });
});
