# Composition to Scene2D workflow — real browser and Godot

Passed on 2026-10-13, 06:28:29–06:28:50 UTC. The full machine-readable proof, source fingerprints, task receipts, author-file hashes and engine output are in `browser.json`.

Tools: Chrome 154.0.8037.97, Node v24.21.0, Godot 4.7.2.stable.official.ed1daf0bf. Godot SHA-256: `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e`.

The test prepares a temporary blank project through production registration/import services: one generic OC, the repository's traveler SVG and the existing composition recipe. This setup is a fixture, not a claim that upstream OC, projection or recipe creation was performed through the GUI. The recipe has BOM/CRLF, two placements, four instances and four groups with parent-child relationships.

The real HTTP editor and Chrome then complete one continuous GUI workflow:

1. Preview the saved recipe. Review materialization into an independent schema-3 Scene2D. Confirm preserved instance IDs, group IDs, memberships, group parents, expanded positions and image references.
2. Change language between Chinese, English and Japanese at 390×844. Fields and reviewed JSON remain intact; Return, Review, Save and Cancel remain inside the viewport. All three screenshots were visually inspected. Cancel confirms and leaves every author file unchanged; no build starts.
3. Reopen, review and save the independent scene. Only the new scene source and registration are created; the build panel selects the new scene. Original recipe, recipe registration, OC, asset and project definition retain their exact hashes.
4. Create a GDScript TXT draft from the parameter/signal starter and use ordinary Save. Create its first scene behavior, review parameters and signal mapping, apply to source, then use ordinary Save. The scene source and all original fixture files remain unchanged.
5. Run actual Godot plan, build and headless execution. All four instance IDs are preserved. The first leader moves 40 px and the other actors remain still. The behavior emits `materialized_checkpoint` with `materialized_scene` and `73`, bound to the created binding and expected instance.
6. Inspect the generated backend project and download it through the actual browser. Independently verify the ZIP, extract into a different directory, compare the copied GDScript bytes and import the relocated project with actual Godot. Import exits 0 without script/parse errors. The package contains 9 generated files and 1 asset; ZIP SHA-256 is `bff190889ed8984955bf288d5e88953433627e2ba8e2bc1b01cbf02f99dfda88`.

Runtime and delivery cause no author-file changes. Browser exceptions are empty. Production and test source fingerprints match before and after the run. Temporary author data, browser profile, caches, downloaded ZIP, relocated project and processes were cleaned up; durable evidence contains reports and screenshots only.

This proves headless logic and portable generated-project delivery. It does not claim rendered gameplay, standalone game export, installed Tauri/native picker acceptance, Android, other operating systems or Bevy author behavior.

Two earlier attempts are retained beside this directory: `browser-1791872828315` stopped before the browser because the test fixture name contained forbidden slash separators; `browser-1791872858566` reached behavior editing but its harness clicked Save before asynchronous Apply completed. Both test-harness issues were corrected without product changes, and both temporary workspaces were cleaned up.

Reproduce from the repository with `VIENTO_GODOT_BIN` set to an existing trusted Godot executable, then run `node scripts/tests/scene-materialize-smoke.mjs`. Optionally set `VIENTO_SCENE_MATERIALIZE_OUTPUT` to a new empty directory inside `docs/test-results/two-dimensional-workflow`. Existing evidence is never overwritten.
