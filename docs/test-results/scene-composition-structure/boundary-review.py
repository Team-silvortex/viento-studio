#!/usr/bin/env python3
"""Read-only preservation audit plus the independently observed review facts.

Only writes its new sibling report. This does not build, install, run engine
executables, or modify author files, products, old tests, or old evidence.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent


def sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read(name):
    return json.loads((HERE / name).read_text())


def check_map(name):
    values = read(name)
    for relative, expected in values.items():
        assert sha(REPO / relative) == expected, (name, relative)
    return {"files": len(values), "manifestSha256": sha(HERE / name), "allBytesMatch": True}


historical = check_map("historical-baseline.json")
actual_history = {str(path.relative_to(REPO)) for path in (REPO / "docs/test-results").rglob("*")
                  if path.is_file() and HERE not in path.parents}
assert actual_history == set(read("historical-baseline.json"))
assert historical["files"] == 2695
source = check_map("source-hashes.json")
assert source["files"] == 604
protected = {name: check_map(name) for name in [
    "frozen-backend-baseline.json", "protected-scene-slices.json", "author-baseline.json"]}
assert protected["frozen-backend-baseline.json"]["files"] == 7
assert protected["protected-scene-slices.json"]["files"] == 23
assert protected["author-baseline.json"]["files"] == 39
actual_authors = {str(path.relative_to(REPO)) for path in (REPO / "examples").rglob("*") if path.is_file()}
assert actual_authors == set(read("author-baseline.json"))
tools = read("tool-baseline.json")
for name, expected in tools.items():
    path = Path(name)
    stat = path.stat()
    assert (stat.st_size, stat.st_dev, stat.st_ino, sha(path)) == (
        expected["bytes"], expected["dev"], expected["ino"], expected["sha256"]), name
assert len(tools) == 4
initial_sources = read("source-hashes-initial.json")
previous_sources = read("previous-source-hashes.json")
assert initial_sources == previous_sources and len(initial_sources) == 594
final_sources = read("source-hashes.json")
computed_delta = {name: {"before": initial_sources.get(name), "after": final_sources.get(name)}
                  for name in sorted(set(initial_sources) | set(final_sources))
                  if initial_sources.get(name) != final_sources.get(name)}
assert computed_delta == read("source-delta.json")
old_core = read("core-source-hashes.json")
new_core = read("core-source-hashes-final.json")
for name, expected in new_core.items():
    assert sha(REPO / name) == expected, name
core_delta = {name: {"before": expected, "after": sha(REPO / name)} for name, expected in old_core.items()
              if sha(REPO / name) != expected}
assert set(core_delta) == {"crates/viento-studio-core/src/lib.rs"}

reports = {}
for directory, count in [("browser-confirmed", 5), ("single-regression", 7), ("batch-regression", 5)]:
    result = read(directory + "/browser.json")
    assert result["ok"] is True and len(result["steps"]) == count
    assert result["errors"] == [] and result["svgRequests"] == []
    assert result["browser"] == "Chrome/154.0.8037.97"
    reports[directory] = {"workflows": count, "errors": 0, "svgExternalRequests": 0,
                          "reportSha256": sha(HERE / directory / "browser.json"),
                          "logSha256": sha(HERE / (directory + ".log"))}
canonical = read("browser-confirmed/browser.json")
assert canonical["sourceStableDuringProof"] is True
assert canonical["node"] == {"version": "v24.20.0", "sha256": "89af8424dd53e560b1933f87ba650d8bf57c83ca5a04600eefb31f416aabbae7"}
for name, expected in canonical["sources"].items():
    assert sha(REPO / name) == expected, name
assert len(canonical["sources"]) == 11
assert canonical["normalSave"]["onlyChangedFile"] == "documents/scenes/recipe.json"
assert canonical["normalSave"]["externalConflictPreserved"] is True
for language in ["zh-CN", "en", "ja"]:
    layout = canonical["layout"][language]
    assert layout["approved"] and layout["actionsVisible"] and layout["noHorizontalOverflow"]
    assert all(layout["impact"][name] for name in ["noHorizontalOverflow", "identityLabelsVisible", "actionsVisible"])
initial_browser = read("browser-initial/browser.json")
assert initial_browser["ok"] is True and len(initial_browser["steps"]) == 5
failed_browser = read("browser-final/browser.json")
assert failed_browser["ok"] is False and "assert.ok(impact.targetsVisible)" in failed_browser["failure"]
assert failed_browser["errors"] == [] and failed_browser["svgRequests"] == []

reviewed = [
    "crates/viento-studio-core/src/lib.rs", "crates/viento-studio-core/src/scene_composition_structure_patch.rs",
    "crates/viento-studio-core/src/scene_composition_patch.rs", "crates/viento-studio-core/src/scene_composition.rs",
    "engine/studio-core.mjs", "engine/scene-composition-structure.mjs", "engine/scene-composition-document.mjs",
    "engine/scene-composition-preview.mjs", "engine/scene-composition-overrides.mjs", "engine/README.md",
    "web/modules/app-scene-composition-structure.js", "web/modules/app-scene-preview.js",
    "web/modules/app-project-build.js", "web/modules/app-runtime.js", "web/project-build.css", "web/i18n/en.js", "web/i18n/ja.js"]
images = sorted((HERE / "browser-confirmed").glob("*.png"))
assert len(images) == 7
record = {
    "schemaVersion": 1,
    "capturedAt": datetime.now(timezone.utc).isoformat(),
    "mode": "Independent read-only implementation review, preservation audit and real HTTP editor/Chrome workflow proof",
    "ok": True,
    "openFindings": [],
    "reviewSourceSha256": sha(Path(__file__).resolve()),
    "reviewedSources": {name: sha(REPO / name) for name in reviewed},
    "preservation": {"historical": historical, "frozenSource": source, "previousSourceFiles": 594,
                     "previousSourceManifestSha256": sha(HERE / "previous-source-hashes.json"),
                     "protected": protected, "retainedTools": {"files": len(tools), "bytesAndPhysicalIdentityMatch": True},
                     "initialCoreFiles": len(old_core), "finalCoreFiles": len(new_core),
                     "authorizedExistingCoreDelta": core_delta,
                     "sourceDeltaEntries": len(computed_delta), "sourceDeltaSha256": sha(HERE / "source-delta.json")},
    "executed": {"browserReports": reports, "totalBrowserWorkflows": 17, "canonicalSourceFilesStable": 11,
                 "node": canonical["node"], "browserVersion": canonical["browser"],
                 "nativeOrEngineBoundaryProbesRunByThisReviewer": 0,
                 "visualInspection": {"screenshots": 7, "files": {str(path.relative_to(HERE)): sha(path) for path in images},
                    "result": "All seven canonical screenshots were viewed. Form controls, translated actions and two placement/instance identity labels are readable at 390px with no horizontal overflow. Long group details and complete source use ordinary vertical scrolling.",
                    "scope": canonical["screenshotScope"]}},
    "reviewedBoundaries": [
        {"area": "independent-capability-and-domain", "result": "passed-read-only", "detail": "New optional structure ABI and addFragmentActor/removeFragmentActor dispatch are separate from old SET/RESET, offset and local/batch patch operations. The old protected 23 files are byte-identical; old single/batch run in new evidence directories."},
        {"area": "explicit-identities-and-atomicity", "result": "passed-read-only-and-browser", "detail": "ADD requires exactly one explicit instanceId for each related placement in source order. Generated IDs are chosen once per UI transaction, unchanged by raw editing and checks. Original and final full recipe expansion guard all identities, group references, local+offset bounds, 128 declared/expanded budgets and final 128KiB bytes before returning one edit receipt."},
        {"area": "identity-domain-limits", "result": "passed-read-only", "detail": "New IDs reject collisions with existing generated actor/group UUIDs and placement UUIDs; pure proposal additionally rejects selected scene UUID. Rust recipe content has no scene metadata UUID. Referenced definition objectId is a separate domain and repeated OC/projection references remain permitted."},
        {"area": "remove-cascade", "result": "passed-read-only-and-browser", "detail": "REMOVE deletes the shared declaration, every related actorIds entry and the matching local override whole record. Empty overrides wrappers, unrelated override records/fields, group declarations and group identities remain. A fragment's last actor cannot be deleted, including unused fragments."},
        {"area": "provenance-and-source-owner", "result": "passed-read-only-and-browser", "detail": "Factory binds the complete current preview once and checks ordered actor/group source provenance, actor objectId, recipe path/revision and real sceneStructure groups. Parent candidate matcher reconstructs source order from actual afterContent, requiring exact actor/group cardinality, unique identities and complete declaration ownership, so a removed selected actor does not block legitimate REMOVE."},
        {"area": "detached-proposal-and-receipt", "result": "passed-read-only", "detail": "Source and nested proposal snapshots occur before the asynchronous digest; accessors, serializers, cycles, non-JSON prototypes/values and malformed arrays reject. Apply recomputes canonical edit, all targets, exact full afterContent and ordered changedPaths from current source. UI raw and detached proposal signatures cannot reuse approval after silent edits."},
        {"area": "lifecycle-and-save", "result": "passed-read-only-and-browser", "detail": "Entry/validation/apply retain parent session, recipe/path, source-token, canEdit and child owner guards after awaits. Apply updates only in-memory source through the ordinary guarded receipt; normal Save retains baseline conflict handling. Actual external writes preserved both disk and reviewed local draft; cancellation made no author changes."},
        {"area": "registered-dependencies-and-media", "result": "passed-read-only-and-browser", "detail": "Complete source dependency enumeration visits objectId and explicit imageResourceId of all fragments including unused, plus local override images, before expansion. Placed candidate media bytes are resolved and sanitized by ordinary host preview. Actual missing registered image bytes blocked Check and Apply; no malicious SVG code/network request ran."},
        {"area": "unused-fragment-scope", "result": "passed-with-explicit-boundary", "detail": "Unused fragments support source-only ADD/REMOVE with targets[] and no fabricated identities. Their declarations and explicit registered dependencies are checked; no expanded effective actor exists, so inherited runtime projection semantics and actual image rendering are deferred until placement. This preserves the established preview contract and does not claim unused rendering acceptance."},
        {"area": "locale-and-layout", "result": "passed-browser-and-visual", "detail": "The three dynamic group/image placeholder options now carry data-i18n. Real zh-CN/en/ja changes preserve approved selection, raw values and both new UUIDs. All three 390px forms and impact labels fit horizontally; sticky Check/Apply/Cancel actions remain visible."}
    ],
    "resolvedFindings": [{"area": "locale-dynamic-options", "finding": "Three dynamically created group/image option labels did not participate in live language refresh.",
                          "resolution": "UI owner added data-i18n without rebuilding values, approval or UUID mappings.",
                          "proof": "browser-confirmed/browser.json layout zh-CN/en/ja translatedOptions, approved=true and stable IDs"}],
    "retainedInitialEvidence": [
        {"report": "browser-initial/browser.json", "result": "Five workflows passed before impact screenshot proof was enhanced.", "sourceCopy": "browser-smoke-initial-source.mjs"},
        {"report": "browser-final/browser.json", "result": "New test-only assertion required the entire long Japanese target group text to fit above the footer. The impact view is scrollable; placement and instance labels and actions were visible. No runtime error or product change occurred.", "sourceCopy": "browser-smoke-impact-initial-source.mjs", "failureScreenshot": "browser-final/failure.png"},
        {"report": "browser-confirmed/browser.json", "result": "Corrected fixture asserts visible placement/instance labels, complete targets in DOM, no overflow and visible actions. Five workflows passed; final smoke source was frozen before source manifest capture."}
    ],
    "unclaimed": ["Installed Tauri or Android acceptance", "Native engine build/run acceptance in this slice",
                  "Group structure editing or placement creation", "Cross-file or multiple-source atomic transaction",
                  "Rendering validation of unplaced inherited projection/media", "Hostile-code security sandbox"]
}
with (HERE / "boundary-review.json").open("x") as handle:
    json.dump(record, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
print(json.dumps({"ok": True, "report": "boundary-review.json", "openFindings": [],
                  "historicalFiles": historical["files"], "sourceFiles": source["files"],
                  "browserWorkflows": 17, "screenshotsViewed": 7}, ensure_ascii=False))
