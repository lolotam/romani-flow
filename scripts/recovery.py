#!/usr/bin/env python3
"""Consistent SQLite/file recovery set. Never overwrites a restore target.

Uses Python standard library only. Run on the host; keep backups private because
they include account hashes, business records and attachments. No env file or
secret value is read or printed. Failures leave an incomplete set for inspection.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from datetime import datetime, timezone


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inside(root, relative):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or '\\' in relative:
        raise ValueError('Unsafe recovery path')
    result = (root / path).resolve()
    if not result.is_relative_to(root.resolve()) or result == root.resolve():
        raise ValueError('Recovery path escapes root')
    return result


def database(file):
    connection = sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True)
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity check failed')
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('SQLite foreign key check failed')
    return connection


def copy_private(source, target):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    shutil.copyfile(source, target)
    target.chmod(0o600)


def backup(data, output, db_file=None, uploads_dir=None):
    data, output = data.resolve(), output.resolve()
    db_file = (db_file or data / 'romani.db').resolve()
    uploads_dir = (uploads_dir or data / 'uploads').resolve()
    if (output.is_relative_to(data) or data.is_relative_to(output)
            or output.is_relative_to(uploads_dir) or uploads_dir.is_relative_to(output)
            or db_file.is_relative_to(output)):
        raise ValueError('Backup must be separate from live database and upload roots')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    source = database(db_file)
    destination = sqlite3.connect(output / 'romani.db')
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    (output / 'romani.db').chmod(0o600)
    snapshot = database(output / 'romani.db')
    try:
        files = set()
        for table, column in [('documents', 'file_path'), ('employees', 'photo_path'), ('pending_uploads', 'file_path')]:
            for row in snapshot.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'):
                if row[0]:
                    relative = str(row[0])
                    source_file = inside(uploads_dir, relative)
                    if not source_file.is_file():
                        raise ValueError('Referenced attachment missing; backup incomplete')
                    target_file = inside(output, 'uploads/' + relative)
                    copy_private(source_file, target_file)
                    files.add('uploads/' + relative)
        counts = {t: snapshot.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
                  for t in ['documents', 'employees', 'admin_users']}
    finally:
        snapshot.close()
    names = ['romani.db'] + sorted(files)
    manifest = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                'counts': counts, 'files': {name: digest(inside(output, name)) for name in names}}
    path = output / 'manifest.json'
    path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    path.chmod(0o600)
    return verify(output)


def verify(root):
    root = root.resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1 or 'romani.db' not in manifest.get('files', {}):
        raise ValueError('Invalid recovery manifest')
    for name, expected in manifest['files'].items():
        if name != 'romani.db' and not name.startswith('uploads/'):
            raise ValueError('Unexpected recovery file')
        if digest(inside(root, name)) != expected:
            raise ValueError('Recovery checksum mismatch')
    db = database(root / 'romani.db')
    try:
        # A valid manifest must include every database-referenced attachment.
        for table, column in [('documents', 'file_path'), ('employees', 'photo_path'), ('pending_uploads', 'file_path')]:
            for row in db.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" IS NOT NULL'):
                if row[0] and 'uploads/' + str(row[0]) not in manifest['files']:
                    raise ValueError('Manifest omits referenced attachment')
    finally:
        db.close()
    return {'verified': True, 'integrity': 'ok', 'foreignKeys': 'ok',
            'fileCount': len(manifest['files']), 'counts': manifest['counts']}


def restore(source, target):
    source, target = source.resolve(), target.resolve()
    result = verify(source)
    if target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError('Restore target must be separate from backup')
    # Existing paths, including empty production mounts, are never replaced.
    if target.exists():
        raise ValueError('Restore target exists; choose a new isolated directory')
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    for name in manifest['files']:
        copy_private(inside(source, name), inside(target, name))
    (target / 'uploads').mkdir(exist_ok=True, mode=0o700)
    copy_private(source / 'manifest.json', target / 'manifest.json')
    verify(target)
    return {**result, 'restored': True, 'isolated': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    b = sub.add_parser('backup'); b.add_argument('--data-dir', type=Path, required=True); b.add_argument('--output', type=Path, required=True)
    b.add_argument('--db', type=Path, help='Actual host SQLite file; defaults to <data-dir>/romani.db')
    b.add_argument('--uploads-dir', type=Path, help='Actual host upload root; defaults to <data-dir>/uploads')
    v = sub.add_parser('verify'); v.add_argument('--backup', type=Path, required=True)
    r = sub.add_parser('restore'); r.add_argument('--backup', type=Path, required=True); r.add_argument('--target', type=Path, required=True)
    args = parser.parse_args()
    if args.action == 'backup':
        result = backup(args.data_dir, args.output, args.db, args.uploads_dir)
    elif args.action == 'verify':
        result = verify(args.backup)
    else:
        result = restore(args.backup, args.target)
    print(json.dumps(result))
