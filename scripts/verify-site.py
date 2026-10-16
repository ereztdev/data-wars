from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs' / 'deployed-v1.3.0.json').read_text())
actual = {p.relative_to(root / 'site').as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
          for p in (root / 'site').rglob('*') if p.is_file()}
assert actual == manifest['files'], 'Site differs from the deployed v1.3.0 snapshot'
print(f"Verified {len(actual)} deployed files")
