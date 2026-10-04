"""Repeat exact reviewed application, and prove later manual edits are refused."""
from pathlib import Path
import hashlib,json,subprocess,sys,tempfile,importlib.util,shutil
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'design/castgate/correction-pass';path=ROOT/'maps/castgate.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
before=sha(path);subprocess.run([sys.executable,str(ROOT/'scripts/castgate_correction_pass.py')],check=True,cwd=ROOT);after=sha(path)
if before!=after:raise AssertionError('Reviewed correction is not idempotent: '+before+' / '+after)
sys.path.insert(0,str(ROOT/'scripts'));spec=importlib.util.spec_from_file_location('castgate_correction_pass',ROOT/'scripts/castgate_correction_pass.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory(prefix='castgate-later-edit-proof-')as td:
 root=Path(td);(root/'maps').mkdir();(root/'design/data-correction/before').mkdir(parents=True);d=json.loads(path.read_text());d['name']=d.get('name','')+' manual edit preserved';fixture=root/'maps/castgate.json';fixture.write_text(json.dumps(d,indent=2)+'\n');shutil.copyfile(ROOT/'design/data-correction/before/castgate.json',root/'design/data-correction/before/castgate.json');fixtureHash=sha(fixture);mod.ROOT=root;mod.OUT=OUT
 try:mod.main()
 except ValueError as e:
  refused='later manual/editor changes'in str(e)
 else:refused=False
 preserved=sha(fixture)==fixtureHash
 if not refused or not preserved:raise AssertionError('Later-editor-change protection failed')
result={'canonicalBeforeRepeat':before,'canonicalAfterRepeat':after,'repeatApplyUnchanged':before==after,'laterManualEditRefused':refused,'temporaryFixturePreserved':preserved};(OUT/'repeatability.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
