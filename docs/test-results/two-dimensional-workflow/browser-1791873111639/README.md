# Final-source Composition → Scene2D → delivery proof

Passed on 2026-10-13, 06:31:51–06:32:12 UTC. This reruns the entire workflow after removing an identical duplicate English translation key. Runtime translation text was unchanged; this directory is the final exact-source evidence. `browser.json` records all source fingerprints, author-file hashes, task receipts and actual engine output.

Tools: Chrome 154.0.8037.97, Node v24.21.0, Godot 4.7.2.stable.official.ed1daf0bf. Godot SHA-256: `8d106cbe6144c2dc7e881d61d2429c1a8a76e6b22ef48bd5e48dcf934953f71e`. Final `web/i18n/en.js` SHA-256: `77b575e22941ca1af24659cc91872563b7efc6106406b173981031cfaf3cc86a`.

Fixture preparation uses production services to register one generic OC, import the traveler SVG and register the existing composition recipe in a disposable blank project. It does not claim upstream OC/projection/recipe creation through the GUI. The recipe uses BOM/CRLF and contains four instances and four groups across two placements.

The actual HTTP editor and Chrome complete a continuous GUI path: saved composition preview → independent Scene2D review → cancellation without writes → review and save → new TXT GDScript draft and ordinary Save → first behavior creation → parameters/signal mapping and ordinary Save → actual Godot plan/build/headless execution → backend project inspection and actual browser download → independent ZIP verification, relocated extraction and actual Godot import.

Assertions passed:

- Materialized instance IDs, group IDs, memberships, parent groups, expanded positions and image references match the source recipe. Save creates only the independent scene source and registration and selects it in the build panel.
- Chinese, English and Japanese at 390×844 preserve fields and reviewed JSON; Return, Review, Save and Cancel stay in the viewport. The final English screenshot was visually inspected; all three layouts were inspected in the earlier successful run.
- All original author files, including the recipe's exact BOM/CRLF bytes and metadata, remain unchanged throughout materialization, behavior attachment, execution and delivery.
- Godot moves the first leader by 40 px, leaves other actors still, preserves the four instance IDs and emits `materialized_checkpoint(materialized_scene, 73)` with the expected behavior binding and instance.
- The browser downloads a 17,864-byte package containing 9 generated files and 1 asset. ZIP SHA-256: `ad88a9bfdface755cea574a882b00fe7e518667687eeec24e3bcf3a4d0c24f75`. The extracted GDScript bytes match the ordinarily saved starter exactly. Relocated Godot import exits 0 without script or parse errors.
- No browser exceptions, runtime/delivery author writes or source fingerprint drift occur. Temporary author project, downloaded package, relocated project, browser profile, caches and processes are cleaned up.

This proves headless logic and portable generated-project delivery, not rendered gameplay, standalone game export, installed Tauri/native picker acceptance, Android, other operating systems or Bevy author behavior.

Earlier evidence is retained: `browser-1791872828315` and `browser-1791872858566` document two corrected test-harness mistakes; `browser-1791872909372` is the earlier successful run before the translation-key cleanup. No product fixes were required by the browser runs.

To reproduce, set `VIENTO_GODOT_BIN` to an existing trusted executable and run `node scripts/tests/scene-materialize-smoke.mjs`. Optional `VIENTO_SCENE_MATERIALIZE_OUTPUT` must point to a new empty directory inside `docs/test-results/two-dimensional-workflow`.
