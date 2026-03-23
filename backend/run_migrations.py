#!/usr/bin/env python3
"""
Run Sensoriqua migrations against the database from SENSORIQUA_DSN (.env or env).

Requires a database user with CREATE (schema/table) privileges. If your DSN points
to a read-only or restricted DB (e.g. shared Navixy), ask your DBA to run the SQL
files in migrations/ once, or use a local Postgres for app state and set SENSORIQUA_DSN
to that.

Usage: from backend dir: python run_migrations.py
"""
import os
import sys
from pathlib import Path

# Load .env from backend directory
_backend_dir = Path(__file__).resolve().parent
_env = _backend_dir / ".env"
if _env.exists():
    from dotenv import load_dotenv
    load_dotenv(_env)

dsn = os.environ.get("SENSORIQUA_DSN")
if not dsn:
    print("SENSORIQUA_DSN not set. Set it in backend/.env or the environment.", file=sys.stderr)
    sys.exit(1)

migrations_dir = _backend_dir.parent / "migrations"
if not migrations_dir.is_dir():
    print(f"Migrations dir not found: {migrations_dir}", file=sys.stderr)
    sys.exit(1)

import psycopg

def main():
    sql_files = sorted(migrations_dir.glob("*.sql"))
    if not sql_files:
        print("No .sql files in migrations/", file=sys.stderr)
        sys.exit(1)
    print(f"Connecting and running {len(sql_files)} migration(s)...")
    try:
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                for f in sql_files:
                    print(f"  Running {f.name}...")
                    sql = f.read_text()
                    cur.execute(sql)
                    conn.commit()
                    print(f"  OK {f.name}")
        print("Done.")
    except psycopg.errors.InsufficientPrivilege as e:
        print("", file=sys.stderr)
        print("Permission denied: this database user cannot CREATE schema/table.", file=sys.stderr)
        print("Either:", file=sys.stderr)
        print("  1. Ask your DBA to run the SQL in sensoriqua/migrations/ once, or", file=sys.stderr)
        print("  2. Use a DB where you have CREATE rights and set SENSORIQUA_DSN to it.", file=sys.stderr)
        print("", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
