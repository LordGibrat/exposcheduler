"""Build the English technical report and seven-slide defense presentation.

Requires reportlab; the application itself uses the Python standard library.
The editable Markdown/JSON sources remain next to the generated documents.
"""
from pathlib import Path
import shutil

from report_design import register_fonts, render_report
from presentation_design import render_presentation

ROOT = Path(__file__).resolve().parents[1]


def build():
    fonts = register_fonts()
    render_report(ROOT, *fonts)
    render_presentation(ROOT, *fonts)
    for source, target in [
        ('docs/TECHNICAL_REPORT.md', 'submission_materials/Technical_Report.md'),
        ('docs/TECHNICAL_REPORT.pdf', 'submission_materials/Technical_Report.pdf'),
        ('docs/slides.pdf', 'submission_materials/Presentation.pdf'),
    ]:
        shutil.copy2(ROOT/source, ROOT/target)
    print('Built technical report, seven-slide presentation and matching submission copies.')


if __name__ == '__main__':
    build()
