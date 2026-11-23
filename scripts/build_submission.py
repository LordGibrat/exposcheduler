"""Build and verify the clean hand-in archive using only the standard library.

Run after document/form generation. It does not publish or submit anything.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TOP_FILES = {
    ".gitignore", "engine.py", "server.py", "evaluation.py",
    "Expo_Smart_Scheduler.ipynb", "README.md", "START_HERE.md",
    "START_WINDOWS.bat", "RUN_BROWSER_CHECK_WINDOWS.bat", "RUN_FINDER_CHECK_WINDOWS.bat", "SUBMISSION_FIRST.md",
    "requirements.txt", "requirements-docs.txt", "package.json", "package-lock.json",
}
DIRECTORIES = {"api", "data", "docs", "results", "scripts", "static", "submission_materials", "tests"}
EXCLUDED_PARTS = {"__pycache__", "node_modules", ".venv", ".ipynb_checkpoints", ".git"}


def included(path):
    relative = path.relative_to(ROOT)
    if any(part in EXCLUDED_PARTS for part in relative.parts):
        return False
    if relative.parts[:2] in (("results", "browser_e2e"), ("results", "finder_e2e")):
        # Runtime output may contain an older invocation. Frozen run reports in
        # results/ are packaged separately, with their verified driver source.
        return False
    if path.suffix in {".pyc", ".pyo", ".sqlite", ".sqlite3", ".db"}:
        return False
    if any(path.name.endswith(s) for s in ("-wal", "-shm")):
        return False
    if len(relative.parts) == 1:
        return path.name in TOP_FILES
    return relative.parts[0] in DIRECTORIES and path.name != "browser_probe.cjs"


def validate_forms():
    source = ROOT / "submission_materials/AI_Usage_Declaration.md"
    text = source.read_text(encoding="utf-8")
    assert text.split("## Declaration", 1)[1].strip() == "", "AI declaration must remain blank"
    with zipfile.ZipFile(source.with_suffix(".docx")) as doc:
        document = ET.fromstring(doc.read("word/document.xml"))
        paragraphs = ["".join(p.itertext()) for p in document.findall(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")]
        assert paragraphs == ["AI Usage Declaration", "Name: ________________________________________", "Date: ________________________________________", "Declaration"], "Unexpected prefilled declaration content"
    contribution = (ROOT / "submission_materials/Team_Contribution_Statement.md").read_text(encoding="utf-8")
    assert "Individual project" in contribution
    return {"ai_declaration_blank": True, "contribution_format": "individual"}


def build(output):
    forms = validate_forms()
    notebook = json.loads((ROOT / "Expo_Smart_Scheduler.ipynb").read_text(encoding="utf-8"))
    browser_qa = json.loads((ROOT / "results/browser_qa.json").read_text(encoding="utf-8"))
    finder_qa = json.loads((ROOT / "results/finder_qa.json").read_text(encoding="utf-8"))
    finder_runner = finder_qa["new_finder_browser_suite"]
    assert hashlib.sha256((ROOT / finder_runner["runner"]).read_bytes()).hexdigest() == finder_runner["runner_sha256"], "Finder runner changed after its validation record"
    if browser_qa["status"] == "passed":
        verified_report = ROOT / "results" / browser_qa["verified_report"]
        verified_driver = ROOT / browser_qa["verified_runner"]
        recorded = json.loads(verified_report.read_text(encoding="utf-8"))
        recorded_checks = [c for view in recorded["viewports"] for c in view["checks"]]
        assert recorded["status"] == "passed" and len(recorded_checks) == 100
        assert all(check["status"] == "passed" for check in recorded_checks)
        assert hashlib.sha256(verified_report.read_bytes()).hexdigest() == browser_qa["report_sha256"]
        assert hashlib.sha256(verified_driver.read_bytes()).hexdigest() == browser_qa["runner_sha256"]
    code = [c for c in notebook["cells"] if c["cell_type"] == "code"]
    assert len(code) == 8 and all(c.get("execution_count") for c in code)
    assert not any(o.get("output_type") == "error" for c in code for o in c.get("outputs", []))
    for required in ("docs/slides.pdf", "submission_materials/Technical_Report.pdf", "docs/BROWSER_QA.md", "tests/browser_e2e.cjs", "static/find.html", "static/find.css", "static/find.js", "tests/finder_e2e.cjs", "docs/FINDER_QA.md"):
        assert (ROOT / required).is_file(), f"Missing required package file: {required}"
    files = sorted((p for p in ROOT.rglob("*") if p.is_file() and included(p)), key=lambda p: p.relative_to(ROOT).as_posix())
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    manifest = ROOT / "MANIFEST.sha256"
    manifest.write_text("".join(f"{digest}  {name}\n" for name, digest in hashes.items()), encoding="utf-8")
    files.append(manifest)
    output = Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in files:
            archive.write(source, "Expo_Smart_Scheduler/" + source.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None, "Archive CRC failure"
        for name, digest in hashes.items():
            assert hashlib.sha256(archive.read("Expo_Smart_Scheduler/" + name)).hexdigest() == digest, name
    result = {"archive": str(output), "files": len(files), "bytes": output.stat().st_size,
              "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "crc_and_manifest": "passed",
              "notebook_executed_code_cells": len(code), **forms,
              "workspace_browser_qa": browser_qa["status"],
              "finder_browser_qa": finder_qa["new_finder_browser_suite"]["status"],
              "video": "playable video not included in this source package", "github": "https://github.com/LordGibrat/exposcheduler", "github_source_status": "compare public main with MANIFEST.sha256", "campus_submission": "unchanged"}
    output.with_suffix(".verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT.parents[1] / "outputs/QAIRU_AIF_Submission.zip")
    build(parser.parse_args().output)
