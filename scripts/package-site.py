from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
out = root / 'dist' / 'playdatawars.com.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted((root / 'site').rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(root / 'site').as_posix())
print(out)
