// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";

vi.mock("@lucide/svelte/icons/terminal", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/file-text", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/image", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/panel-right", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("@lucide/svelte/icons/wrench", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("../components/agent/AgentCard.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("../components/agent/AgentProposalCard.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));

import AgentToolRow from "../components/agent/AgentToolRow.svelte";
type AgentToolRowProps = ComponentProps<typeof AgentToolRow>;

describe("AgentToolRow extension links", () => {
  const mounted: ReturnType<typeof mount>[] = [];
  const hosts: HTMLElement[] = [];

  function mountRow(props: AgentToolRowProps): HTMLElement {
    const host = document.body.appendChild(document.createElement("div"));
    hosts.push(host);
    mounted.push(mount(AgentToolRow, { target: host, props }));
    flushSync();
    return host;
  }

  afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component);
    for (const host of hosts.splice(0)) host.remove();
  });

  it("opens an absolute file path and shell output through their typed actions", () => {
    const onOpenFilePreview = vi.fn();
    const onOpenBashOutput = vi.fn();
    const fileHost = mountRow({
      toolName: "read_file",
      argsText: JSON.stringify({ file_path: "/tmp/report.md" }),
      phase: "done",
      onOpenFilePreview,
    });
    fileHost
      .querySelector<HTMLButtonElement>('button[aria-label="Open file preview: /tmp/report.md"]')
      ?.click();
    expect(onOpenFilePreview).toHaveBeenCalledWith("/tmp/report.md");

    const bashHost = mountRow({
      toolName: "bash",
      argsText: JSON.stringify({ command: "cat /tmp/report.md" }),
      phase: "done",
      onOpenBashOutput,
    });
    bashHost
      .querySelector<HTMLButtonElement>('button[aria-label="Open shell output for bash"]')
      ?.click();
    expect(onOpenBashOutput).toHaveBeenCalledOnce();
  });

  it("does not offer file preview for relative paths or without a host callback", () => {
    const relative = mountRow({
      toolName: "read_file",
      argsText: JSON.stringify({ file_path: "report.md" }),
      phase: "done",
      onOpenFilePreview: vi.fn(),
    });
    expect(relative.querySelector('[aria-label^="Open file preview"]')).toBeNull();

    const noHost = mountRow({
      toolName: "read_file",
      argsText: JSON.stringify({ file_path: "/tmp/report.md" }),
      phase: "done",
    });
    expect(noHost.querySelector('[aria-label^="Open file preview"]')).toBeNull();
  });
});
