# manager-workbench Specification

## Purpose

Provide the Workspace, Creator, and Repository workbench surfaces on top of the Manager core.

## Requirements

### Requirement: Workspaces expose provider-scoped skills

The Workspaces surface MUST show Global and Imported Workspaces, their Providers, and provider-scoped skill state including availability, validation and enabled status.

#### Scenario: imported workspace discovery

- **WHEN** a user imports a readable directory
- **THEN** the UI shows its server-derived Providers and skills and Remove removes only the registry entry

### Requirement: Creator applies reviewed drafts

Creator MUST keep unsaved edits in a draft, save with an expected revision, and distinguish success, conflict and failure.

#### Scenario: revision conflict

- **WHEN** another process changes a document before the user saves
- **THEN** Creator reports conflict, keeps the draft, and offers reload without overwriting the newer file

### Requirement: Repository installs pinned content

Repository preview and install MUST use the same pinned scan session and MUST report each selected skill and target independently.

#### Scenario: expired session

- **WHEN** a user installs after the scan session has expired
- **THEN** the operation is rejected with a rescan action and no target is modified
