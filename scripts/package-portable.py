"""Create a private Windows x64 transfer ZIP after stopping the review server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, help='New directory for the package and ZIP')
parser.add_argument('--node', required=True, type=Path)
parser.add_argument('--codex-dir', required=True, type=Path)
parser.add_argument('--poppler-dir', required=True, type=Path)
parser.add_argument('--browsers-dir', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
stage = output / 'WenhengReview'
stage.mkdir()

def sha256(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

db = sqlite3.connect(f'{(root / "data/review.sqlite3").as_uri()}?mode=ro', uri=True)
if db.execute("SELECT count(*) FROM review_tasks WHERE status IN ('running','queued')").fetchone()[0]:
    raise RuntimeError('Active review tasks exist; package after they finish.')
if db.execute("SELECT count(*) FROM report_files WHERE status IN ('pending','generating')").fetchone()[0]:
    raise RuntimeError('Active report generation exists; package after it finishes.')
counts = {table: db.execute(f'SELECT count(*) FROM {table}').fetchone()[0] for table in ['users', 'papers', 'paper_versions', 'review_tasks', 'review_runs', 'review_issues', 'issue_evidence']}
references = []
for table, columns in {'paper_versions': ['storage_path'], 'parse_results': ['artifact_path'], 'review_attempts': ['input_path', 'output_path'], 'report_files': ['storage_path']}.items():
    for column in columns:
        for (value,) in db.execute(f'SELECT {column} FROM {table} WHERE {column} IS NOT NULL'):
            source = Path(value).resolve()
            if not source.is_relative_to(root) or not source.exists():
                raise RuntimeError(f'Unpackaged or missing reference: {table}.{column}')
            references.append(str(source.relative_to(root)))
db.close()

def copy_tree(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if item.is_symlink():
            # npm executable links are unnecessary; node modules themselves remain intact.
            if item.parent.name == '.bin':
                continue
            raise RuntimeError(f'Unexpected symbolic link: {item}')
        target = destination / item.name
        if item.name in {'__pycache__', '.links'} or item.suffix == '.log' or item.name.endswith(('-wal', '-shm')):
            continue
        if item.is_dir():
            copy_tree(item, target)
        elif item.suffix == '.sqlite3':
            original = sqlite3.connect(f'{item.as_uri()}?mode=ro', uri=True)
            snapshot = sqlite3.connect(target)
            try:
                original.backup(snapshot)
                if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('SQLite snapshot integrity check failed')
            finally:
                snapshot.close()
                original.close()
        else:
            shutil.copy2(item, target)

for name in ['src', 'public', 'assets', 'migrations', 'scripts', 'tests', 'docs', 'config', 'node_modules', 'data']:
    copy_tree(root / name, stage / name)
for name in ['package.json', 'package-lock.json', '.env', '.env.example', '.gitignore', '.gitattributes', 'README.md', 'START-WINDOWS.cmd', 'CHECK-WINDOWS.cmd']:
    shutil.copy2(root / name, stage / name)
shutil.copy2(root / 'docs/transfer-windows.md', stage / '新电脑使用说明.md')

node_target = stage / 'runtime/node'
node_target.mkdir(parents=True)
shutil.copy2(args.node, node_target / 'node.exe')
copy_tree(args.codex_dir.resolve(), stage / 'runtime/codex')
copy_tree(args.poppler_dir.resolve(), stage / 'runtime/poppler')
browsers = json.loads((root / 'node_modules/playwright-core/browsers.json').read_text(encoding='utf-8'))['browsers']
for browser in browsers:
    if browser['name'] in {'chromium-headless-shell', 'ffmpeg', 'winldd'}:
        name = browser['name'].replace('-', '_') + '-' + browser['revision']
        copy_tree((args.browsers_dir / name).resolve(), stage / 'runtime/browsers' / name)

manifest = {
    'created_at': datetime.now(timezone.utc).isoformat(), 'platform': 'windows-x64',
    'original_root': str(root), 'database': 'data/review.sqlite3',
    'counts': counts, 'verified_file_references': len(references), 'missing_references': [],
    'includes_private_env': True,
    'node_version': subprocess.check_output([str(args.node), '--version'], text=True).strip(),
    'codex_version': subprocess.check_output([str(args.codex_dir / 'codex.exe'), '--version'], text=True).strip(),
    'dependencies': json.loads((root / 'package.json').read_text(encoding='utf-8'))['dependencies'],
    'note': 'Private transfer package. Use START-WINDOWS.cmd to relocate the main database before starting.'
}
(stage / 'portable-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
for relative in references:
    if not (stage / relative).exists():
        raise RuntimeError('Staged file reference missing')
files = sorted(file for file in stage.rglob('*') if file.is_file())
inventory = [{'path': file.relative_to(stage).as_posix(), 'bytes': file.stat().st_size, 'sha256': sha256(file)} for file in files]
(stage / 'package-files.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'stage_ready': str(stage), 'files': len(inventory), 'database_counts': counts}, ensure_ascii=True), flush=True)
archive = output / 'WenhengReview-Windows-x64.zip'
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as packed:
    for file in sorted(stage.rglob('*')):
        if file.is_file():
            packed.write(file, file.relative_to(output).as_posix())
with zipfile.ZipFile(archive) as packed:
    bad = packed.testzip()
    if bad:
        raise RuntimeError('ZIP CRC verification failed: ' + bad)
checksum = sha256(archive)
(output / 'WenhengReview-Windows-x64.zip.sha256').write_text(checksum + '  ' + archive.name + '\n', encoding='ascii')
result = {'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': checksum, 'file_count': len(inventory) + 1, 'counts': counts, 'missing_references': []}
(output / 'package-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=True))
