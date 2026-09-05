# Design: manager-workbench

## User flow

```text
Workspaces -> Provider -> Skill detail -> Validate / Enable / Edit
     |                                      |
     `-> Repository source -> pinned scan -> Preview -> Install -> Review

Creator new/edit -> local draft -> Save(expectedRevision) -> validate -> result
                                           `-> conflict -> reload without losing draft
```

## State ownership

| State                                                 | Owner            |
| ----------------------------------------------------- | ---------------- |
| route, selected skill, filter, view                   | URL              |
| registry, skill content, scan session, install result | daemon RPC       |
| unsaved editor draft and dialog open state            | component memory |
| theme/sidebar/window preference                       | localStorage     |

Tab switching must not create a second business-state cache. A stale response cannot overwrite a newer route or connection owner.

## Acceptance

- A clean user can import a directory, see its providers and skills, open detail, validate, edit with a revision, and recover a conflict.
- A repository scan pins one commit; preview and install reject another session or missing session.
- Global Workspace is readable but every write attempt is rejected by daemon.
- Desktop and narrow viewport have no overflow or inaccessible recovery action; UI actions expose loading and terminal feedback.

## Demo reference

`demo/manager-workbench.html` is a standalone layout and interaction reference for the three manager surfaces. It demonstrates workspace/provider selection, skill detail, validation feedback, enablement, refresh, and Creator handoff. It is not a production route, does not contain real RPC, and must not be used as evidence that the change is implemented.
