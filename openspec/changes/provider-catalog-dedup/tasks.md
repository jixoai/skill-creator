## 1. Read projection contract and snapshot seam

- [ ] 1.1 Extend the shared Workspace read schema with `physicalRoots` (canonical/fallback key, display path, availability, union skill count, and ordered declarer IDs/labels) while retaining the complete `providers` array and `{workspaceId, providerId}` target schema; verify shared contract parsing rejects malformed rows and accepts the Alpha fixture shape.
- [ ] 1.2 Extend the workspace-registry snapshot result so each `(workspaceId, lexicalRoot)` resolves realpath at most once, uses a normalized absolute fallback when resolution fails, excludes `root === null` declarations from physical rows, and derives provider counts, Workspace skill union, and physical-root skill union from the same scan; verify focused projection tests cover symlinks, missing roots, and disappearing roots.
- [ ] 1.3 Preserve provider-scoped resolution and authorization after projection changes; verify existing target tests for `workspace-targets`, `resolve/resolveWritable`, Creator, Repository, Evaluation, and Agent target validation still pass with a shared physical root.

## 2. Scope and count semantics

- [ ] 2.1 Add regression fixtures for ten declarations sharing three roots, declarations with distinct roots, and a Global root matching an Imported root; verify each Workspace has one row per physical root, complete catalog-order declarers, location count equal to physical-root count, and no cross-Workspace merge.
- [ ] 2.2 Assert unavailable/broken/inaccessible roots group by normalized absolute fallback, remain `available=false`, never merge with a successful realpath row, and contribute zero skill entries; verify the realpath/stat call budget is root-count bounded within one snapshot.
- [ ] 2.3 Assert skill counts use directory-name union once per physical root and Workspace canonical union, while `WorkspaceProvider.skillCount`, `skills.listWorkspace.providers`, provider filters, and search `installations` retain declaration/installation semantics; run the focused daemon projection and skill-search aggregate tests.

## 3. Agents and location-summary projection

- [ ] 3.1 Render Agents screen rows from `workspace.physicalRoots`, use Workspace/physical-root union for the headline skill count, and keep each declarer actionable through the existing provider filter and findings routes; verify the DOM tests preserve `{workspaceId, providerId}` navigation for single and multiple declarers, then check the same rows and actions at desktop and narrow-container widths.
- [ ] 3.2 Add compact declarer labels (first 2–3 plus `+N`) with full title/popover/accessible text and clear unavailable-root rendering; verify desktop and narrow-container visual checks cover long labels, many declarers, empty roots, and mixed available states.
- [ ] 3.3 Change the library/location summary to count `physicalRoots.length` for its existing Workspace scope selection while retaining the existing smoke-anchor wording; verify the migrated `skills across N agent locations` test reports physical rows rather than declaration aliases.

## 4. Contract-boundary and search regressions

- [ ] 4.1 Verify Skills screen provider facets and `skills.listWorkspace` pagination continue to expose declaration-level provider IDs and counts; add a regression where two declarations share a root but provider filter URLs remain distinct.
- [ ] 4.2 Verify skill-search canonical documents keep every `{path, workspaceId, providerId}` installation and that duplicate/content projections do not consume `physicalRoots` as identity; run focused canonicalize, workspace-aggregate, and target-resolution tests.

## 5. Integrated validation and handoff evidence

- [ ] 5.1 Run the focused daemon and WebUI tests for projection, workspace dashboard, target stores, skill-search, and shared contracts from the repository root with `pnpm exec vp test run <files>`; record all green results.
- [ ] 5.2 Run `pnpm --dir webui check` and require 0 errors / 0 warnings, then run `pnpm exec vp fmt` with the explicit changed-file list and `git diff --check`.
- [ ] 5.3 Perform the owner-facing desktop and narrow-screen walkthrough against a real daemon snapshot: shared-root aggregation, unavailable fallback, declarer action routing, Global/Imported separation, and the physical location count; record the observed paths and leave the tree uncommitted for the orchestrator.
