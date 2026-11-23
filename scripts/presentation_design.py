"""Purpose-built defense slides, with matching PDF and offline SVG/HTML output.

ReportLab is the only export dependency. The application does not import this
module. Register fonts first, then call render_presentation(project_root,
regular_font_name, bold_font_name, serif_font_name).
"""
from __future__ import annotations

import html
import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

W, H = 1280, 720
C = {"paper":"#F5F4EE", "white":"#FFFEFA", "ink":"#1A3029",
     "forest":"#173C32", "muted":"#626D5F", "line":"#D5DCCB",
     "lime":"#E2EBA6", "clay":"#A65D3D", "sage":"#DFE6D2",
     "soft":"#EBEDE2", "warm":"#EFE1D2"}


class Slide:
    """Draw each primitive once to ReportLab and to an equivalent inline SVG."""
    def __init__(self, pdf, fonts, index, title):
        self.pdf, self.fonts, self.index, self.title = pdf, fonts, index, title
        self.svg = []
        self.box(0, 0, W, H, C["paper"])

    def box(self, x, y, w, h, fill, stroke=None, radius=0):
        self.pdf.setFillColor(HexColor(fill))
        if stroke:
            self.pdf.setStrokeColor(HexColor(stroke)); self.pdf.setLineWidth(1)
        if radius:
            self.pdf.roundRect(x, H-y-h, w, h, radius, fill=1, stroke=int(bool(stroke)))
        else:
            self.pdf.rect(x, H-y-h, w, h, fill=1, stroke=int(bool(stroke)))
        self.svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke or "none"}"/>')

    def line(self, x1, y1, x2, y2, color=None, weight=1):
        color = color or C["line"]
        self.pdf.setStrokeColor(HexColor(color)); self.pdf.setLineWidth(weight)
        self.pdf.line(x1, H-y1, x2, H-y2)
        self.svg.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{weight}"/>')

    def circle(self, x, y, radius, fill, stroke=None):
        self.pdf.setFillColor(HexColor(fill))
        if stroke:self.pdf.setStrokeColor(HexColor(stroke))
        self.pdf.circle(x, H-y, radius, fill=1, stroke=int(bool(stroke)))
        self.svg.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{fill}" stroke="{stroke or "none"}"/>')

    def polygon(self, points, fill, stroke=None):
        path=self.pdf.beginPath();path.moveTo(points[0][0],H-points[0][1])
        for x,y in points[1:]:path.lineTo(x,H-y)
        path.close();self.pdf.setFillColor(HexColor(fill))
        if stroke:self.pdf.setStrokeColor(HexColor(stroke));self.pdf.setLineWidth(1)
        self.pdf.drawPath(path,fill=1,stroke=int(bool(stroke)))
        self.svg.append('<polygon points="'+' '.join(f'{x},{y}' for x,y in points)+f'" fill="{fill}" stroke="{stroke or "none"}"/>')

    def text(self, text, x, y, size=20, color=None, role="regular", width=None, leading=None, max_lines=None):
        color,leading=color or C["ink"],leading or size*1.36
        font=self.fonts[role];lines=[]
        for paragraph in str(text).split("\n"):
            line=""
            for word in paragraph.split():
                trial=(line+" "+word).strip()
                if width and line and pdfmetrics.stringWidth(trial,font,size)>width:
                    lines.append(line);line=word
                else:line=trial
            lines.append(line)
        if max_lines is not None and len(lines)>max_lines:
            raise ValueError(f"Slide {self.index}: {len(lines)} lines exceed {max_lines}: {text}")
        family="Georgia, Times New Roman, serif" if role=="serif" else "Segoe UI, Arial, sans-serif"
        weight="700" if role=="bold" else "400"
        self.pdf.setFillColor(HexColor(color));self.pdf.setFont(font,size)
        for i,line in enumerate(lines):
            baseline=y+size*.82+i*leading
            tw=pdfmetrics.stringWidth(line,font,size)
            if x<0 or x+tw>W+.1 or baseline>H-8:
                raise ValueError(f"Slide {self.index}: text outside bounds: {line}")
            self.pdf.drawString(x,H-baseline,line)
            self.svg.append(f'<text x="{x}" y="{baseline:.2f}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}">{html.escape(line)}</text>')
        return leading*len(lines)

    def pill(self,label,x,y,fill=None,color=None,size=13):
        w=pdfmetrics.stringWidth(label,self.fonts["bold"],size)+22
        self.box(x,y,w,28,fill or C["sage"],radius=4)
        self.text(label,x+11,y+7,size,color or C["forest"],"bold")

    def link(self,label,url,x,y,size=18,color=None):
        color=color or C["forest"]
        width=pdfmetrics.stringWidth(label,self.fonts["regular"],size)
        start=len(self.svg)
        self.text(label,x,y,size,color);self.line(x,y+size+4,x+width,y+size+4,color)
        self.pdf.linkURL(url,(x,H-y-size-7,x+width,H-y+3),relative=0)
        self.svg.insert(start,f'<a href="{html.escape(url,quote=True)}" target="_blank" rel="noopener noreferrer">')
        self.svg.append('</a>')

    def heading(self,kicker,title,subtitle=None,title_size=42):
        self.text(kicker,60,36,13,C["muted"],"bold")
        height=self.text(title,60,75,title_size,role="bold",width=1160,leading=title_size*1.12,max_lines=2)
        if subtitle:self.text(subtitle,61,85+height,19,C["muted"])

    def footer(self,note=None):
        self.line(60,668,1220,668)
        self.text("EXPO SMART SCHEDULER / AI FUNDAMENTALS",60,686,11,C["muted"],"bold")
        self.text(f"{self.index:02d} / 07",1162,685,13,C["muted"])
        if note:self.text(note,60,632,12,C["muted"],width=1140,leading=16,max_lines=2)

    def finish(self):
        self.pdf.showPage()
        return f'<section class="slide" id="slide-{self.index}" aria-label="Slide {self.index}: {html.escape(self.title,quote=True)}"><svg viewBox="0 0 {W} {H}" role="img" aria-labelledby="title-{self.index}"><title id="title-{self.index}">{html.escape(self.title)}</title>'+''.join(self.svg)+'</svg></section>'


def floors(s,cx=1005,top=165,width=290,step=31):
    """Original eight-slab architectural illustration, not a measured plan."""
    s.line(cx-172,top+272,cx+172,top+272,"#53705B",.7)
    for i in reversed(range(8)):
        y=top+i*step;highlight=i==4
        edge="#8A4B30" if highlight else "#648069"
        face="#D29A6A" if highlight else "#7E9874"
        roof="#EDC49B" if highlight else "#CEDCBA"
        w=width+(12 if highlight else 0)
        s.polygon([(cx-w/2,y+24),(cx,y+65),(cx+w/2,y+24),(cx+w/2,y+36),(cx,y+77),(cx-w/2,y+36)],face,edge)
        s.polygon([(cx,y-17),(cx+w/2,y+24),(cx,y+65),(cx-w/2,y+24)],roof,edge)
        s.line(cx,y+65,cx,y+77,edge)
    for dy,label,color in [(4,"08","#C3D3B1"),(4*step+23,"04","#EDC49B"),(7*step+44,"01","#C3D3B1")]:
        s.line(cx+151,top+dy,cx+175,top+dy,"#8EA17E")
        s.text(label,cx+182,top+dy-9,13,color)


def problem(s,d,e):
    s.box(802,0,478,H,C["forest"])
    s.text(d["kicker"],60,41,13,C["muted"],"bold")
    s.text("Your next idea",60,111,64,role="bold")
    s.text("needs a place.",60,183,69,C["clay"],"serif")
    s.text(d["subtitle"],62,292,31,role="bold")
    s.text("Gibrat Sagadat / QAIRU / AI Fundamentals",63,327,14,C["muted"])
    s.text("Find a room, an iMac or an auditorium.\nCoordinate competing requests and explain the choice.",63,345,23,width=645,leading=34,max_lines=3)
    s.line(63,465,708,465)
    s.text("23",63,487,54,role="bold");s.text("synthetic resources",65,552,18,C["muted"])
    s.text("08",375,487,54,role="bold");s.text("represented floors",377,552,18,C["muted"])
    s.text("EXPO / A CAMPUS STUDY",841,42,13,C["lime"],"bold")
    floors(s,1015,173,280,31)
    s.text("A place to begin.",858,538,32,C["lime"],"serif")
    s.text("Original illustrative geometry.\nNot a real campus floor plan.",859,586,14,"#C3D3B1",width=325,leading=21)
    s.text("Campus scheduling simulation. Data, probabilities, routes and utilities are assumptions.",63,626,13,C["muted"],width=650,leading=18,max_lines=2)
    s.link("Open the user page",d["url"],63,679,15)
    s.text("01 / 07",1154,680,13,"#C3D3B1")


def interfaces(s,d,e):
    s.heading(d["kicker"],d["title"],title_size=42)
    y,h=184,324
    s.box(60,y,559,h,C["forest"],radius=8)
    s.text("01 / FIND A SPACE",86,y+24,13,C["lime"],"bold")
    s.text("One request. One clear result.",86,y+63,28,C["white"],"bold",width=500,max_lines=2)
    for i,label in enumerate(["Search","Result","Review","Confirm"]):
        x=99+i*128
        if i<3:s.line(x+17,y+153,x+111,y+153,"#6C8766",2)
        s.circle(x,y+153,17,C["lime"]);s.text(str(i+1),x-4,y+145,16,C["forest"],"bold")
        s.text(label,x-17,y+187,18,C["white"],"bold")
    s.text("Exact time + group size → room, floor, time and reasons.",86,y+245,19,"#D1DCC4",width=498,max_lines=2)
    s.box(641,y,579,h,C["white"],C["line"],8)
    s.text("02 / AI WORKSPACE",667,y+24,13,C["clay"],"bold")
    s.text("Competing requests. Deeper models.",667,y+63,28,role="bold",width=520,max_lines=2)
    rows=[("PLAN A BATCH","Coordinate up to ten requests."),("COMPARE","First fit, hill climbing and small exact search."),("EXPERIMENT","Routes, reports, forecasts and decision advice.")]
    for i,(cap,body) in enumerate(rows):
        yy=y+149+i*51
        s.text(cap,668,yy,12,C["muted"],"bold");s.text(body,797,yy-2,18,width=386,max_lines=2)
    s.box(60,538,1160,73,C["sage"],radius=6)
    s.text("Same engine. Same simulation calendar.",85,554,23,role="bold")
    s.text("Local: SQLite on one computer. Hosted: one browser profile on the same origin.",85,586,15,C["muted"])
    s.footer("Public reservations are not shared with other users and do not reserve university facilities.")


def methods(s,d,e):
    s.heading(d["kicker"],d["title"],title_size=43)
    for i,m in enumerate(d["methods"]):
        x=60+(i%3)*393;y=177+(i//3)*215
        s.box(x,y,374,197,C["white"] if i<4 else C["soft"],C["line"],6)
        s.text(f"0{i+1} / {m['short']}",x+20,y+17,12,C["clay"] if i>=4 else C["muted"],"bold")
        s.text(m["name"],x+20,y+48,23,role="bold",width=335,max_lines=1)
        s.text(m["body"],x+20,y+83,18,C["muted"],width=334,leading=25,max_lines=3)
        s.pill(m["scope"],x+20,y+160,C["warm"] if i>=4 else C["sage"],size=12)
    s.footer("No report: retain the prior. No sequence: HMM is inactive. The POMDP advisor is separate from ranking; it uses backward recursion, not value iteration.")


def search(s,d,e):
    s.heading(d["kicker"],"Do not spend the only specialist space\non a flexible request.",title_size=39)
    s.box(60,187,1160,96,C["forest"],radius=6)
    s.text(d["objective"],85,202,30,C["white"],"serif")
    s.text(d["objective_key"],86,250,14,"#D1DCC4")
    f=d["fixture"]
    rows=[(60,"FIRST-FIT BASELINE",f["baseline_served"],f["baseline_score"],"First feasible resource ID + time,\nin input request order.",False),
          (653,"HILL CLIMBING",f["chosen_served"],f["chosen_score"],"Single/pair improving moves,\nwith five seeded starts.",True)]
    for x,label,served,score,body,active in rows:
        s.box(x,307,567,285,C["white"],C["line"],6)
        s.text(label,x+24,328,13,C["clay"] if active else C["muted"],"bold")
        s.text(f"{served} / 3",x+24,368,54,role="bold");s.text("requests served",x+24,431,18,C["muted"])
        for k in range(3):
            s.box(x+322+k*62,375,49,54,C["forest"] if k<served else C["soft"],C["line"],4)
            xx=x+335+k*62
            if k<served:
                s.line(xx,401,xx+8,408,C["lime"],3)
                s.line(xx+8,408,xx+23,391,C["lime"],3)
            else:
                s.line(xx+3,401,xx+20,401,C["muted"],2)
        s.line(x+24,466,x+543,466);s.text(body,x+24,487,18,C["muted"],width=335,leading=25,max_lines=2)
        s.text(f"{score:.2f}",x+373,490,27,C["forest"],"bold");s.text("assumed units",x+373,526,13,C["muted"])
    s.footer("Constructed specialist fixture, verified in the historical browser report. Synthetic utilities, not time savings. Local search does not guarantee a global optimum.")


def uncertainty(s,d,e):
    s.heading(d["kicker"],d["title"],title_size=42)
    s.box(60,181,560,376,C["white"],C["line"],6)
    s.text("BAYES / ONE HYPOTHETICAL REPORT",82,204,12,C["muted"],"bold")
    s.text("0.60",82,247,51,role="bold");s.text("→",261,257,36,C["clay"])
    s.text("0.894737",332,248,44,C["clay"],"bold")
    s.text("assumed prior",84,311,17,C["muted"]);s.text("posterior after ‘free’",334,311,17,C["muted"])
    s.line(83,356,597,356)
    s.text("Sensitivity 0.85 · False positive 0.15",83,376,18,role="bold")
    s.text("0.85 × 0.60 = 0.51",84,416,21,width=510)
    s.text("0.51 / (0.51 + 0.15 × 0.40) = 0.894737",84,452,20,width=510,max_lines=1)
    s.text("A noisy report changes a belief.\nIt does not prove a room is free.",84,497,18,C["muted"],leading=25)
    s.box(641,181,579,376,C["forest"],radius=6)
    s.text("POMDP / TWO ACTION OPPORTUNITIES",666,204,12,C["lime"],"bold")
    s.text("At belief 0.60, inspect first.",666,239,26,C["white"],"bold")
    for i,(key,label) in enumerate([("book","Book"),("inspect","Inspect"),("wait","Wait"),("leave","Leave")]):
        yy=296+i*48;v=d["decision"]["values"][key]
        s.text(label,667,yy,18,C["white"],"bold" if key=="inspect" else "regular")
        s.box(782,yy+4,329,15,"#315343",radius=3)
        if v>0:s.box(782,yy+4,329*v/4,15,C["lime"] if key=="inspect" else "#91A77D",radius=3)
        s.text(f"{v:.2f}",1137,yy-1,20,C["lime"] if key=="inspect" else "#D1DCC4","bold")
    s.text("Inspect buys information; wait changes occupancy.\nExpected assumed utility, separate from ranking.",666,499,17,"#D1DCC4",leading=25)
    s.box(60,577,1160,40,C["sage"],radius=4)
    s.text("HMM sequences and waiting: P(stays free) = 0.80; P(becomes free) = 0.35. Specified, not learned.",79,588,16,C["forest"])
    s.footer("Default utilities: success +10, failure −8, inspection cost 0.7, waiting cost 0.8. Finite-horizon backward recursion, not value iteration.")


def evidence(s,d,e):
    s.heading(d["kicker"],d["title"],title_size=42)
    ev=e["evaluation"]
    s.box(60,180,517,423,C["forest"],radius=7)
    s.text("TINY SYNTHETIC SCHEDULING CASES",86,204,12,C["lime"],"bold")
    s.text(f"{ev['hill_matches_oracle']} / {ev['scheduling_trials']}",86,245,67,C["white"],"bold")
    s.text("Hill and exact results matched\na separate exhaustive oracle.",88,334,23,C["white"],leading=32)
    s.line(87,425,548,425,"#56704E")
    s.text(f"{ev['hill_strictly_improved']} / {ev['scheduling_trials']}",88,451,38,C["lime"],"bold")
    s.text("improved on first fit",269,463,19,"#D1DCC4")
    s.text("Zero constraint violations in these cases.\nThis small domain is not a global guarantee.",88,521,17,"#D1DCC4",leading=26)
    rows=[(e["python"]["passed"],"Python checks passed","One loopback socket check skipped."),
          (e["finder"]["javascript"]["pass"],"JavaScript checks passed","Logic and storage; no browser rendering."),
          (len(e["http"]["checks"]),"Hosted HTTP checks passed","Published assets and state API responses.")]
    for i,(number,title,detail) in enumerate(rows):
        yy=180+i*91
        s.box(604,yy,616,78,C["white"],C["line"],5)
        s.text(str(number),626,yy+12,36,role="bold");s.text(title,725,yy+13,21,role="bold")
        s.text(detail,726,yy+45,15,C["muted"])
    s.box(604,462,616,62,C["sage"],radius=5)
    s.text("100",626,474,31,role="bold")
    s.text("Historical workspace browser checks passed",725,474,18,role="bold",width=475,max_lines=1)
    s.text("21 Nov 2026 · Original workspace only",726,500,13,C["muted"])
    s.box(604,536,616,67,C["warm"],radius=5)
    s.text("NOT RUN",625,554,17,C["clay"],"bold")
    s.text("New finder: 100 browser checks prepared",759,550,19,role="bold",width=439,max_lines=1)
    s.text("Do not count these as passed checks.",760,578,14,C["muted"])
    s.footer("Historical browser scope: reduced-motion Chromium at five emulated viewports. New finder interactions and physical devices remain unverified.")


def demo(s,d,e):
    s.heading(d["kicker"],"Try it. Then ask why.",title_size=53)
    s.link("expo-smart-scheduler.vercel.app/find.html",d["url"],62,154,22)
    s.text("A SHORT LIVE DEMONSTRATION",62,216,12,C["muted"],"bold")
    steps=[("Search","Find one iMac at an exact time."),("Understand","Read the room, floor, time and AIF reasons."),("Review + confirm","Save, then cancel a simulation reservation."),("Go deeper","Compare the specialist scenario in the workspace.")]
    for i,(title,body) in enumerate(steps):
        yy=253+i*65;s.circle(77,yy+12,15,C["sage"])
        s.text(str(i+1),73,yy+4,14,C["forest"],"bold");s.text(title,109,yy,20,role="bold")
        s.text(body,109,yy+28,17,C["muted"],width=545,max_lines=1)
    s.box(731,211,489,320,C["forest"],radius=7)
    s.text("BEFORE REAL DEPLOYMENT",757,236,12,C["lime"],"bold")
    for i,body in enumerate(d["next_steps"]):
        yy=283+i*73;s.text(f"0{i+1}",757,yy,16,C["lime"],"bold")
        s.text(body,800,yy-1,20,C["white"],width=391,leading=27,max_lines=2)
    s.box(60,559,1160,55,C["sage"],radius=5)
    s.text("A place for your plans. A reason for every choice.",82,570,28,C["forest"],"serif")
    s.footer("Simulation only. Local mode stores on one computer; the public demo stores in one browser profile. No real campus bookings are made.")


def _evidence(root):
    paths={"evaluation":"evaluation_summary.json","python":"validation_summary.json","finder":"finder_qa.json","http":"finder_http_checks.json","browser":"browser_e2e_verified_run.json"}
    e={k:json.loads((root/"results"/f).read_text(encoding="utf-8")) for k,f in paths.items()}
    if e["finder"]["new_finder_browser_suite"]["status"]!="not_run":
        raise ValueError("Finder browser evidence changed. Update the deck's coverage statement before rendering.")
    return e


def render_presentation(root,font_regular="Sans",font_bold="SansBold",font_serif="Serif"):
    """Write docs/slides.pdf and docs/slides.html; return their paths."""
    root=Path(root);docs=root/"docs"
    deck=json.loads((docs/"slides_content.json").read_text(encoding="utf-8"))
    if len(deck)!=7:raise ValueError("The defense deck must contain seven slides")
    e=_evidence(root);fixture=deck[3]["fixture"]
    # Validate the demonstration against preserved observations, not a made-up chart.
    observed=[check.get("observed",{}) for viewport in e["browser"]["viewports"]
              for check in viewport["checks"]
              if check["name"]=="specialist-plan-versus-baseline" and check["status"]=="passed"]
    expected={"chosen_placements":fixture["chosen_served"],"baseline_placements":fixture["baseline_served"],
              "chosen_score":fixture["chosen_score"],"baseline_score":fixture["baseline_score"]}
    if len(observed)!=5 or any(item!=expected for item in observed):
        raise ValueError("Specialist fixture does not match preserved evidence from all five viewports")
    pdf=canvas.Canvas(str(docs/"slides.pdf"),pagesize=(W,H),pageCompression=1)
    pdf.setTitle("Expo Smart Scheduler | AI Fundamentals Defense")
    pdf.setAuthor("Expo Smart Scheduler project")
    pdf.setSubject("Seven-slide defense: user flow, methods, synthetic evaluation and limits")
    fonts={"regular":font_regular,"bold":font_bold,"serif":font_serif}
    fragments=[]
    for i,(content,draw) in enumerate(zip(deck,[problem,interfaces,methods,search,uncertainty,evidence,demo]),1):
        s=Slide(pdf,fonts,i,content["title"]);draw(s,content,e);fragments.append(s.finish())
    pdf.save()
    navigation=''.join(f'<a href="#slide-{i}" aria-label="Slide {i}">{i}</a>' for i in range(1,8))
    template='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Expo Smart Scheduler · Defense presentation</title><style>*{box-sizing:border-box}html{scroll-padding-top:20px;scroll-behavior:smooth}body{margin:0;padding:25px 25px 90px;background:#dfe3d6;color:#173c32;font-family:"Segoe UI",Arial,sans-serif}.slide{max-width:1280px;margin:0 auto 28px;background:#f5f4ee;box-shadow:0 10px 45px #183d3212;aspect-ratio:16/9}.slide svg{display:block;width:100%;height:100%}.slide svg text{user-select:text}nav{display:flex;gap:7px;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#173c32;padding:9px 13px;border-radius:7px;box-shadow:0 6px 25px #173c3233}nav a{display:flex;align-items:center;justify-content:center;min-width:36px;min-height:36px;border-radius:3px;color:#fffefa;text-decoration:none;font-size:15px}nav a:hover,nav a:focus-visible{background:#e2eba6;color:#173c32;outline:2px solid #e2eba6;outline-offset:2px}.deck-note{max-width:1280px;margin:0 auto 20px;font-size:14px;color:#526348}@media(max-width:620px){body{padding:12px 8px 80px}.deck-note{font-size:12px}.slide{margin-bottom:14px}nav{gap:3px;padding:6px 9px}nav a{min-width:34px;min-height:36px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{@page{size:16in 9in;margin:0}body{padding:0;background:white}.slide{width:16in;height:9in;max-width:none;margin:0;box-shadow:none;break-after:page;break-inside:avoid}.slide:last-of-type{break-after:auto}nav,.deck-note{display:none}}</style></head><body><p class="deck-note">Expo Smart Scheduler · 7-slide defense presentation. Use the numbered links to move between slides; zoom for small screens.</p>'''
    (docs/"slides.html").write_text(template+''.join(fragments)+f'<nav aria-label="Presentation slides">{navigation}</nav></body></html>',encoding="utf-8")
    return docs/"slides.pdf",docs/"slides.html"
