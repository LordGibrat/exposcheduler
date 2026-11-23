"""Run the core test suite and retain an honest machine-readable summary."""
import io
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
log=io.StringIO()
suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'),pattern='test_*.py')
result=unittest.TextTestRunner(stream=log,verbosity=2).run(suite)
(ROOT/'results/python_tests.txt').write_text(log.getvalue(),encoding='utf-8')
summary=dict(tests_run=result.testsRun,passed=result.testsRun-len(result.failures)-len(result.errors)-len(result.skipped),
             failures=len(result.failures),errors=len(result.errors),skipped=[dict(test=str(t),reason=r) for t,r in result.skipped],
             note='Tests use the actual HTTP handler over memory streams when loopback is blocked. No browser end-to-end claim.')
(ROOT/'results/validation_summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
sys.exit(0 if result.wasSuccessful() else 1)
