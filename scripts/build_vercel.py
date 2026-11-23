"""Prepare a minimal Vercel upload without notebooks, private records or SQLite.

All executable AI methods are copied unchanged from the local implementation.
The hosted adapter is stateless; simulated reservations stay in each browser.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def build(destination):
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    sources = [(ROOT/'engine.py',Path('engine.py')), (ROOT/'server.py',Path('server.py')),
               (ROOT/'api/index.py',Path('api/index.py'))]
    sources += [(p,Path('data')/p.name) for p in sorted((ROOT/'data').glob('*.json'))]
    sources += [(p,Path('public')/p.name) for p in sorted((ROOT/'static').iterdir()) if p.is_file()]
    for source,relative in sources:
        target=destination/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source,target)
    config={'$schema':'https://openapi.vercel.sh/vercel.json','outputDirectory':'public',
            'functions':{'api/index.py':{'maxDuration':30,'includeFiles':'{engine.py,server.py,data/**}'}},
            'rewrites':[{'source':'/api/:path*','destination':'/api?route=:path*'}]}
    (destination/'vercel.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    (destination/'.python-version').write_text('3.12\n',encoding='utf-8')
    (destination/'requirements.txt').write_text('# Python standard library only.\n',encoding='utf-8')
    files=[relative for _,relative in sources]+[Path('vercel.json'),Path('.python-version'),Path('requirements.txt')]
    return destination,files


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination',type=Path,default=ROOT.parent/'expo_vercel_deploy')
    parser.add_argument('--manifest',action='store_true',help='Print source payload JSON for the deployment connector')
    args=parser.parse_args()
    destination,files=build(args.destination)
    if args.manifest:
        print(json.dumps({'directory':str(destination),'files':[{'file':p.as_posix(),'data':(destination/p).read_text(encoding='utf-8'),'encoding':'utf-8'} for p in files]}))
    else:
        print(json.dumps({'directory':str(destination),'files':len(files),'engine_sha256':hashlib.sha256((destination/'engine.py').read_bytes()).hexdigest()},indent=2))
