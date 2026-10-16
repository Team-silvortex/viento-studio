#!/usr/bin/env python3
"""Run the real source packager, inspect every member, then remove only our package.

Usage: python3 source-archive-check.py /absolute/repository
Run only after candidate source/docs changes have stopped. This intentionally
records a candidate, not the final commit or later release/atlas report edits.
"""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(sys.argv[1]).resolve(strict=True)
VERSION = "0.1.5"
OUT = ROOT / "docs/test-results/release-0.1.5/source-archive.json"
REQUIRED = [
    "VERSION", "package.json", "package-lock.json", "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", "src-tauri/tauri.android.conf.json",
    "web/index.html", "desktop/ui/index.html", "engine/audio-wav.mjs",
    "engine/scene-audio-edit.mjs", "engine/scene-audio-resources.mjs",
    "engine/scene-audio-audition.mjs", "engine/scene-audio-directory.mjs",
    "engine/scene-audio-core.mjs", "engine/scene-behaviors.mjs",
    "scripts/lib/audio-wav.mjs", "scripts/lib/scene-audio-directory-service.mjs",
    "scripts/lib/doc-api-service.mjs", "scripts/lib/doc-server-routes.mjs",
    "scripts/backends/godot4-adapter.mjs", "web/modules/app-behavior-source.js",
    "web/modules/app-doc-service.js", "web/modules/app-runtime.js",
    "web/modules/app-scene-audio.js", "web/modules/app-scene-audio-source.js",
    "web/modules/app-scene-audio-media.js", "web/modules/scene-audio-audition.js",
    "web/modules/app-scene-behaviors.js", "web/scene-audio.css",
    "web/scene-behaviors.css", "web/i18n/en.js", "web/i18n/ja.js",
    "crates/viento-studio-core/Cargo.toml", "crates/viento-studio-core/Cargo.lock",
    "crates/viento-studio-core/src/lib.rs", "crates/viento-studio-core/src/wasm.rs",
    "crates/viento-studio-core/src/scene_audio.rs",
    "crates/viento-bevy-runtime/Cargo.toml", "crates/viento-bevy-runtime/Cargo.lock",
    "crates/viento-bevy-runtime/src/main.rs", "scripts/backends/bevy-rust/Cargo.toml",
    "scripts/backends/bevy-rust/Cargo.lock", "scripts/backends/bevy-rust/src/main.rs",
    "scripts/backends/bevy-rust/src/runtime.rs", "scripts/backends/bevy-rust/src/behavior_sources.rs",
    "scripts/tests/scene-audio-directory.test.mjs",
    "scripts/tests/scene-audio-directory-service.test.mjs",
    "scripts/tests/scene-audio-directory-http.test.mjs",
    "scripts/tests/scene-behavior-audio-picker-smoke.mjs",
    "scripts/tests/scene-audio-audition-transport-smoke.mjs",
    "examples/scene-audio/assets/tone.wav", "examples/scene-audio/documents/audio/demo.json",
]
HISTORICAL_BINARIES = {
    "src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar",
    *[f"docs/test-results/scene3d-{name}/previous-studio-core.wasm" for name in
      ["alignment-authoring", "copy-authoring", "distribution-authoring", "removal-authoring", "translation-authoring"]],
}
BINARY_SUFFIXES = {".wasm", ".so", ".exe", ".dll", ".a", ".apk", ".deb", ".rpm", ".appimage", ".jar", ".rlib", ".rmeta", ".o"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


assert (ROOT / "VERSION").read_text().strip() == VERSION
assert not OUT.is_symlink()
assert json.loads((ROOT / "package.json").read_text())["version"] == VERSION
spec = importlib.util.spec_from_file_location("release_source_packager", ROOT / "desktop/package-source.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
expected_paths = {p.relative_to(ROOT).as_posix() for entry in packager.INPUTS for p in packager.source_files(ROOT / entry)}
assert len(expected_paths) > 8000
assert set(REQUIRED).issubset(expected_paths), sorted(set(REQUIRED) - expected_paths)
report = {
    "ok": False,
    "version": VERSION,
    "candidateStartedAt": utc(),
    "headBeforeReleaseCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
    "packagerSha256": digest((ROOT / "desktop/package-source.py").read_bytes()),
    "scope": "Temporary candidate source archive made before final release preflight and any subsequent derived atlas/report refresh; not an archive of the final Git commit and not a binary installer. Every archived source byte is compared with the candidate worktree. The actual packager accepts only dist/ outputs, so its uniquely owned output is moved to /tmp for readback and removed afterwards.",
}
dist = ROOT / "dist"
dist_existed = dist.exists()
dist.mkdir(exist_ok=True)
stage = Path(tempfile.mkdtemp(prefix=".release-source-check-", dir=dist))
scratch = Path(tempfile.mkdtemp(prefix="viento-0.1.5-source-", dir="/tmp"))
package_name = f"Viento-Studio_{VERSION}_source"
stage_archive = stage / f"{package_name}.tar.gz"
archive_path = scratch / stage_archive.name
try:
    completed = subprocess.run([sys.executable, str(ROOT / "desktop/package-source.py"), str(stage_archive)],
                               cwd=ROOT, check=True, capture_output=True, text=True)
    generated = json.loads(completed.stdout)
    assert Path(generated["archive"]) == stage_archive
    shutil.move(str(stage_archive), str(archive_path))
    report["candidateArchiveCompletedAt"] = utc()
    report["archiveBytes"] = archive_path.stat().st_size
    with archive_path.open("rb") as f:
        report["archiveSha256"] = hashlib.file_digest(f, "sha256").hexdigest()
    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        names = [m.name for m in members]
        assert len(names) == len(set(names)), "duplicate tar member"
        assert all(m.isfile() for m in members), "non-regular tar member"
        manifest_data = archive.extractfile(f"{package_name}/SOURCE_MANIFEST.json").read()
        manifest = json.loads(manifest_data)
        report["manifestSha256"] = digest(manifest_data)
        assert set(manifest) == expected_paths, {"missing": sorted(expected_paths-set(manifest)), "unexpected": sorted(set(manifest)-expected_paths)}
        assert set(names) == {f"{package_name}/{p}" for p in manifest} | {f"{package_name}/SOURCE_MANIFEST.json"}
        allowed_binaries = []
        canonical_workspace_markers = []
        for relative, expected in manifest.items():
            parts = PurePosixPath(relative).parts
            assert not PurePosixPath(relative).is_absolute() and ".." not in parts
            assert not any(p in {".git", "node_modules", "__pycache__", ".gradle", ".kotlin", ".idea", ".godot", ".mono"} for p in parts), relative
            assert not any(relative == p or relative.startswith(p + "/") for p in packager.GENERATED), relative
            assert "target" not in parts and not relative.startswith(("dist/", "workspace/", "workspaces/")), relative
            assert not any(p.startswith((".resources-", ".dist-")) for p in parts), relative
            if ".viento" in parts:
                assert parts[0] == "examples" and parts[2:] == (".viento", "workspace.json"), relative
                canonical_workspace_markers.append(relative)
            if PurePosixPath(relative).suffix.lower() in BINARY_SUFFIXES:
                assert relative in HISTORICAL_BINARIES, f"Unexpected binary: {relative}"
                allowed_binaries.append(relative)
            content = archive.extractfile(f"{package_name}/{relative}").read()
            assert {"size": len(content), "sha256": digest(content)} == expected, relative
            assert not (ROOT / relative).is_symlink(), relative
            assert content == (ROOT / relative).read_bytes(), f"Source changed during candidate verification: {relative}"
        assert len(manifest) == generated["files"]
        assert report["archiveBytes"] == generated["bytes"]
        report.update({
            "files": len(manifest),
            "requiredSourcesChecked": {p: manifest[p] for p in sorted(REQUIRED)},
            "allManifestEntriesReadBack": True,
            "allSourceBytesCompared": True,
            "sourceAudioFiles": sum(p.startswith("examples/scene-audio/") for p in manifest),
            "bevyTemplateFiles": sum(p.startswith("scripts/backends/bevy-rust/") for p in manifest),
            "studioCoreCrateFiles": sum(p.startswith("crates/viento-studio-core/") for p in manifest),
            "bevyRuntimeCrateFiles": sum(p.startswith("crates/viento-bevy-runtime/") for p in manifest),
            "buildOutputsCachesAndPrivateWorkspacesExcluded": True,
            "canonicalExampleWorkspaceMarkers": sorted(canonical_workspace_markers),
            "permittedHistoricalEvidenceAndGradleWrapperBinaries": sorted(allowed_binaries),
        })
finally:
    # Only these two unique directories are ours. Never touch dist/current.
    shutil.rmtree(stage)
    shutil.rmtree(scratch)
    if not dist_existed:
        try:
            dist.rmdir()
        except OSError:
            pass
report.update({"ok": True, "candidateVerificationCompletedAt": utc(), "temporaryArchiveRemoved": not archive_path.exists(), "temporaryStagingRemoved": not stage.exists()})
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"ok": True, "files": report["files"], "archiveBytes": report["archiveBytes"], "temporaryArchiveRemoved": True, "report": str(OUT)}))
