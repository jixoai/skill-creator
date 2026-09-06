# Design: dsh-webui-composition

## Product composition

```text
Skill Creator daemon
  | Manager RPC + loopback auth
  v
DSH Web host (official web profile)
  | Cordis client module graph / slots / remote namespace
  +-- DSH Agent surface
  |     model + profile + session + stream + permission + approval
  +-- Skill Creator plugin
        Workspace / Provider / Skill views
        Skill Steward task + context + evidence + proposal
        Manager tool events + validation + apply + rollback
```

DSH Web is the Agent presentation and session host. The Skill Creator plugin is a first-class DSH client plugin, not a second iframe or an ACP conversation. The plugin may render a Svelte island during migration, but its mount/dispose boundary, route identity, and RPC owner must be explicit; no hidden second shell or second connection is allowed.

## Runtime and UI authority

```text
DSH session event / stream ---------> Agent timeline and transcript
DSH tool request -------------------> Manager tool registry
Manager snapshot/finding/proposal ---> Skill Steward cards and diff
Manager approval/apply/rollback ----> authoritative audit + file mutation
```

DSH settings choose the runtime model/profile/permission policy. Manager chooses task, target, selected skills, prompt/tool versions and mutation policy. A DSH permission grant can allow a runtime interaction, but it never bypasses Manager approval or revision checks.

## Packaging and host decision

The first implementation must prove one real DSH web composition in a clean install:

1. Pin the official DSH package/version and record the exact commit/version in a runtime manifest.
2. Build the official web profile (`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app`) and load a Skill Creator client plugin through the DSH client module graph (`dsh.client`, `client` export and declared inject/external rows).
3. Mount the plugin through DSH slots/remote services and expose a single Manager connection. Do not fake the DSH graph with a local ACP process or a static HTML page.
4. If the existing Svelte surface cannot be mounted without a second shell, migrate the affected surface to a DSH-compatible client module; do not ship an iframe or parallel production route.

## Migration states

```text
DSH unavailable -> Manager-only recovery surface (typed unavailable)
DSH available   -> DSH host + Skill Creator plugin
plugin failure  -> boot failure with actionable package/version evidence
daemon restart  -> session reconnect + Manager audit reload
```

具体挂载、路由、单实例、鉴权和 Manager-only 恢复设计以 `integration-contract.md` 为准。复用原有 Svelte Manager views，不要求批量改写 React；移除的是重复 Agent shell 和 ACP 主入口。React root layout 必须重新声明被替换父 slot 的子 slot。
