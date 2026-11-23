"""Create editable submission forms; no personal contribution is inferred."""
from pathlib import Path
import re

from docx import Document
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
FORMS = ROOT / "submission_materials"


def plain(text):
    return re.sub(r"\*\*([^*]+)\*\*", r"\1", text)


def create_form(name):
    source = FORMS / (name + ".md")
    doc = Document()
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = Inches(.8)
    section.left_margin = section.right_margin = Inches(.85)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor.from_string("182538")
    normal.paragraph_format.space_after = Pt(10)
    doc.core_properties.title = name.replace("_", " ")
    doc.core_properties.author = ""
    doc.core_properties.last_modified_by = ""
    table = None
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        if line.startswith("| "):
            if re.fullmatch(r"[| :\-]+", line):
                continue
            cells = [plain(c.strip()) for c in line.strip("|").split("|")]
            if table is None:
                table = doc.add_table(rows=0, cols=len(cells))
                table.style = "Table Grid"
            row = table.add_row()
            for cell, text in zip(row.cells, cells):
                cell.text = text
            continue
        table = None
        if line.startswith("# "):
            doc.add_heading(plain(line[2:]), 0)
        elif line.startswith("## "):
            doc.add_heading(plain(line[3:]), 1)
        else:
            doc.add_paragraph(plain(line))
    if name == "AI_Usage_Declaration":
        # Intentionally no declaration text, examples, or prefilled claims.
        for _ in range(16):
            doc.add_paragraph("")
    output = FORMS / (name + ".docx")
    doc.save(output)
    print(output.name)


if __name__ == "__main__":
    create_form("AI_Usage_Declaration")
    create_form("Team_Contribution_Statement")
