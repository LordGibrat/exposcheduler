"""Render the technical report with vector figures and selectable PDF text."""
import csv
import html
import math
from pathlib import Path
import re
from statistics import mean
import textwrap

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

FOREST = '#173c32'
INK = '#1a3029'
CLAY = '#a65d3d'
MUTED = '#626d5f'
PAPER = '#f5f4ee'
LINE = '#dcded2'
LIME = '#e2eba6'


def register_fonts():
    folder = Path('C:/Windows/Fonts')
    candidates = [('Sans', 'segoeui.ttf'), ('SansBold', 'segoeuib.ttf'), ('Serif', 'georgia.ttf')]
    if all((folder / filename).exists() for _, filename in candidates):
        for name, filename in candidates:
            pdfmetrics.registerFont(TTFont(name, str(folder / filename)))
        pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='SansBold', italic='Sans', boldItalic='SansBold')
        return 'Sans', 'SansBold', 'Serif'
    return 'Helvetica', 'Helvetica-Bold', 'Times-Roman'


def inline(text, regular='Sans'):
    escaped = html.escape(text)
    escaped = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)',
                     r'<link href="\2" color="#173c32"><u>\1</u></link>', escaped)
    escaped = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', escaped)
    return re.sub(r'`([^`]+)`', r'<font name="Courier" size="8.7">\1</font>', escaped)


class Metrics(Flowable):
    def __init__(self, width, regular, bold):
        super().__init__()
        self.width, self.height = width, 68
        self.regular, self.bold = regular, bold

    def draw(self):
        c = self.canv
        c.setFillColor(colors.HexColor(FOREST))
        c.roundRect(0, 0, self.width, self.height, 5, stroke=0, fill=1)
        for i, (value, label) in enumerate([('23', 'sample resources'), ('8', 'represented floors'), ('6', 'implemented AI methods')]):
            x = 17 + i * self.width / 3
            c.setFillColor(colors.HexColor(LIME))
            c.setFont(self.bold, 23)
            c.drawString(x, 31, value)
            c.setFillColor(colors.white)
            c.setFont(self.regular, 8.5)
            c.drawString(x, 15, label)


class Architecture(Flowable):
    def __init__(self, width, regular, bold):
        super().__init__()
        self.width, self.height = width, 175
        self.regular, self.bold = regular, bold

    def draw(self):
        c, w = self.canv, self.width

        def box(x, y, width, title, subtitle, dark=False):
            c.setFillColor(colors.HexColor(FOREST if dark else PAPER))
            c.setStrokeColor(colors.HexColor(LINE))
            c.roundRect(x, y, width, 40, 4, fill=1, stroke=not dark)
            c.setFillColor(colors.white if dark else colors.HexColor(INK))
            c.setFont(self.bold, 10)
            c.drawCentredString(x + width/2, y+24, title)
            c.setFont(self.regular, 8)
            c.drawCentredString(x + width/2, y+10, subtitle)

        def arrow(x1, y1, x2, y2):
            c.setStrokeColor(colors.HexColor('#9aaa90'))
            c.setLineWidth(.8)
            c.line(x1, y1, x2, y2)
            angle = math.atan2(y2-y1, x2-x1)
            c.line(x2, y2, x2-5*math.cos(angle-.42), y2-5*math.sin(angle-.42))
            c.line(x2, y2, x2-5*math.cos(angle+.42), y2-5*math.sin(angle+.42))

        box(0, 130, w*.46, 'Find a space', 'One exact-time session')
        box(w*.54, 130, w*.46, 'AI workspace', 'Batch scheduling and model experiments')
        arrow(w*.23, 130, w*.38, 111)
        arrow(w*.77, 130, w*.62, 111)
        box(w*.18, 69, w*.64, 'One Python scheduling engine', 'Feasible domains, scoring, search and explanations', True)
        c.setFillColor(colors.HexColor(MUTED))
        c.setFont(self.regular, 8)
        c.drawCentredString(w/2, 51, 'User confirmation and a fresh conflict recheck')
        arrow(w*.30, 69, w*.23, 43)
        arrow(w*.70, 69, w*.77, 43)
        box(0, 0, w*.46, 'Local server', 'Atomic SQLite transaction')
        box(w*.54, 0, w*.46, 'Hosted demo', 'Personal browser calendar')


class UtilityChart(Flowable):
    def __init__(self, root, width, regular, bold):
        super().__init__()
        self.width, self.height = width, 114
        self.regular, self.bold = regular, bold
        with (Path(root)/'results/scheduler_benchmark.csv').open(newline='', encoding='utf-8') as stream:
            rows = list(csv.DictReader(stream))
        self.values = [('First fit', mean(float(r['baseline_score']) for r in rows), '#b8c5ab'),
                       ('Hill climbing', mean(float(r['hill_score']) for r in rows), FOREST)]
        self.count = len(rows)

    def draw(self):
        c, w = self.canv, self.width
        c.setFillColor(colors.HexColor(INK))
        c.setFont(self.bold, 10)
        c.drawString(0, 100, 'Mean schedule utility across the 24 tiny cases')
        x0, axis_width = 90, w-140
        maximum = max(100, 100*math.ceil(max(value for _, value, _ in self.values)/100))
        c.setFont(self.regular, 8)
        for value in range(0, maximum+1, 100):
            x = x0+axis_width*value/maximum
            c.setStrokeColor(colors.HexColor(LINE))
            c.line(x, 29, x, 88)
            c.setFillColor(colors.HexColor(MUTED))
            c.drawCentredString(x, 16, str(value))
        for i, (label, value, color) in enumerate(self.values):
            y = 66-i*31
            c.setFillColor(colors.HexColor(INK))
            c.setFont(self.regular, 9)
            c.drawString(0, y+6, label)
            c.setFillColor(colors.HexColor(color))
            length = axis_width*value/maximum
            c.roundRect(x0, y, length, 19, 2, fill=1, stroke=0)
            c.setFont(self.bold, 9)
            c.setFillColor(colors.HexColor(INK))
            c.drawString(x0+length+7, y+5, f'{value:.2f}')


def render_report(root, regular='Sans', bold='SansBold', serif='Serif'):
    root = Path(root)
    width = A4[0]-100
    body = ParagraphStyle('Body', fontName=regular, fontSize=10.1, leading=14.7,
                          textColor=colors.HexColor(INK), spaceAfter=8)
    heading = ParagraphStyle('Heading', fontName=bold, fontSize=15, leading=20,
                             textColor=colors.HexColor(FOREST), spaceBefore=18,
                             spaceAfter=9, keepWithNext=True)
    subheading = ParagraphStyle('Subheading', fontName=bold, fontSize=10.9, leading=15,
                                textColor=colors.HexColor(CLAY), spaceBefore=10,
                                spaceAfter=6, keepWithNext=True)
    caption = ParagraphStyle('Caption', fontName=regular, fontSize=8.5, leading=12,
                             textColor=colors.HexColor(MUTED), spaceAfter=11)
    title = ParagraphStyle('Title', fontName=bold, fontSize=30, leading=34,
                           textColor=colors.HexColor(FOREST), spaceAfter=8)
    subtitle = ParagraphStyle('Subtitle', fontName=serif, fontSize=17, leading=23,
                              textColor=colors.HexColor(CLAY), spaceAfter=15)
    cell_style = ParagraphStyle('Cell', parent=body, fontSize=9, leading=12.5, spaceAfter=0)
    code_style = ParagraphStyle('Equation', fontName='Courier', fontSize=8.6,
                                leading=12.5, textColor=colors.HexColor(FOREST), spaceAfter=0)

    story = [Paragraph('TECHNICAL REPORT / AI FUNDAMENTALS', caption),
             Paragraph('Expo Smart Scheduler', title),
             Paragraph('A clear place for every plan.', subtitle),
             Paragraph('Student: Gibrat Sagadat / QAIRU / AI Fundamentals', caption),
             Metrics(width, regular, bold), Spacer(1, 13),
             Paragraph('One engine. A simple finder and a full AI workspace.', body),
             Paragraph('<link href="https://expo-smart-scheduler.vercel.app/find.html" color="#173c32"><u>Find a space</u></link> &nbsp; / &nbsp; <link href="https://expo-smart-scheduler.vercel.app/" color="#173c32"><u>AI workspace</u></link>', caption)]
    paragraph, table, code = [], [], []
    in_code = False
    architecture_added = False
    chart_added = False

    def flush_paragraph():
        if paragraph:
            story.append(Paragraph(inline(' '.join(paragraph), regular), body))
            paragraph.clear()

    def flush_table():
        nonlocal chart_added
        if not table:
            return
        rows = [line for line in table if not re.fullmatch(r'[\s|:\-]+', line)]
        cells = [[col.strip() for col in row.strip('|').split('|')] for row in rows]
        count = len(cells[0])
        widths = [width*.62, width*.38] if count == 2 else [width/count]*count
        header_style = ParagraphStyle('HeaderCell', parent=cell_style, textColor=colors.white, fontName=bold)
        data = [[Paragraph(inline(col, regular), header_style if i == 0 else cell_style)
                 for col in row] for i, row in enumerate(cells)]
        t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
        t.setStyle(TableStyle([
            ('BACKGROUND',(0,0),(-1,0),colors.HexColor(FOREST)),
            ('TEXTCOLOR',(0,0),(-1,0),colors.white),
            ('VALIGN',(0,0),(-1,-1),'TOP'),
            ('LEFTPADDING',(0,0),(-1,-1),10), ('RIGHTPADDING',(0,0),(-1,-1),10),
            ('TOPPADDING',(0,0),(-1,-1),8), ('BOTTOMPADDING',(0,0),(-1,-1),8),
            ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor(PAPER),colors.white]),
            ('LINEBELOW',(0,0),(-1,0),.6,colors.HexColor(FOREST)),
            ('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor(LINE)),
        ]))
        story.extend([t, Spacer(1, 13)])
        if not chart_added and cells[0][0] == 'Measure':
            story.append(KeepTogether([UtilityChart(root, width, regular, bold),
                Paragraph('Assumed utility units; zero-based axis. Source: scheduler_benchmark.csv. These are synthetic model scores, not accuracy or real-campus outcomes.', caption)]))
            chart_added = True
        table.clear()

    def flush_code():
        if not code:
            return
        lines = []
        for line in code:
            wrapped = textwrap.wrap(line, width=86, break_long_words=False, break_on_hyphens=False,
                                    replace_whitespace=False, drop_whitespace=False) or [' ']
            lines.extend(wrapped)
        fragments = [Paragraph(html.escape(line).replace(' ','&nbsp;'), code_style) for line in lines]
        box = Table([[fragments]], colWidths=[width], hAlign='LEFT')
        box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),colors.HexColor('#edf1e5')),
            ('BOX',(0,0),(-1,-1),.5,colors.HexColor(LINE)),
            ('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),
            ('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
        story.extend([KeepTogether([box]), Spacer(1, 10)])
        code.clear()

    text = (root/'docs/TECHNICAL_REPORT.md').read_text(encoding='utf-8')
    for line in text.splitlines():
        if line.startswith('# ') or line == 'Technical report':
            continue
        if line.startswith('```'):
            flush_paragraph(); flush_table()
            if in_code:
                flush_code()
            in_code = not in_code
            continue
        if in_code:
            code.append(line)
            continue
        if line.startswith('|'):
            flush_paragraph(); table.append(line)
            continue
        flush_table()
        if line.startswith('## '):
            flush_paragraph()
            if line.startswith('## 3.') and not architecture_added:
                story.extend([Spacer(1, 6), KeepTogether([
                    Architecture(width, regular, bold), Spacer(1, 8),
                    Paragraph('The pages use the same engine. Calendars agree only within the same origin, profile and storage mode; they are not shared campus bookings.', caption)])])
                architecture_added = True
            story.append(Paragraph(inline(line[3:], regular), heading))
        elif line.startswith('### '):
            flush_paragraph(); story.append(Paragraph(inline(line[4:], regular), subheading))
        elif not line.strip():
            flush_paragraph()
        else:
            paragraph.append(line)
    flush_paragraph(); flush_table()

    def page_frame(c, doc):
        c.setStrokeColor(colors.HexColor(LINE))
        c.setLineWidth(.6)
        c.line(50, A4[1]-33, A4[0]-50, A4[1]-33)
        c.setFont(bold, 7.5); c.setFillColor(colors.HexColor(FOREST))
        c.drawString(50, A4[1]-25, 'EXPO / SMART SCHEDULER')
        c.setFont(regular, 7.5); c.setFillColor(colors.HexColor(MUTED))
        c.drawRightString(A4[0]-50, A4[1]-25, 'AI FUNDAMENTALS')
        c.line(50, 38, A4[0]-50, 38)
        c.drawString(50, 23, 'Technical report / Synthetic evaluation / 23 November 2026')
        c.drawRightString(A4[0]-50, 23, f'{doc.page:02d}')

    SimpleDocTemplate(str(root/'docs/TECHNICAL_REPORT.pdf'), pagesize=A4,
        leftMargin=50, rightMargin=50, topMargin=51, bottomMargin=52,
        title='Expo Smart Scheduler - Technical Report',
        author='Expo Smart Scheduler project', subject='Algorithms, implementation and reproducible evaluation').build(
            story, onFirstPage=page_frame, onLaterPages=page_frame)
