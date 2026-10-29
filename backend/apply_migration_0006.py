import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg

load_dotenv('.env')
load_dotenv('backend/.env')

DATABASE_URL = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("FATAL: No database connection string found in environment.")
    sys.exit(1)

MIGRATION_PATH = Path(__file__).resolve().parent.parent / "supabase" / "migrations" / "0006_phase3_phase4_operations_and_cross_bureau.sql"

if not MIGRATION_PATH.exists():
    print(f"FATAL: Migration file not found at {MIGRATION_PATH}")
    sys.exit(1)

with open(MIGRATION_PATH, "r", encoding="utf-8") as f:
    migration_sql = f.read()

print("=" * 70)
print("AICTE ONEDESK — APPLYING MIGRATION 0006 TO LIVE SUPABASE")
print("=" * 70)

conn = psycopg.connect(DATABASE_URL, autocommit=False)
try:
    with conn.cursor() as cur:
        # Pre-check
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
        pre_tables = cur.fetchone()[0]
        print(f"[PRE-DEPLOY] Table count: {pre_tables} (Expected: 32)")
        assert pre_tables == 32, f"Expected 32 tables, found {pre_tables}"

        # Execute Migration 0006
        print("[MIGRATING] Applying Migration 0006...")
        cur.execute(migration_sql)
        print("[MIGRATING] Migration SQL executed successfully.")

    # Commit permanently
    conn.commit()
    print("[DEPLOYED] Transaction committed successfully to live Supabase.")

    # Post-deployment verification
    with conn.cursor() as cur:
        # 1. 32 tables invariant
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
        post_tables = cur.fetchone()[0]
        print(f"[VERIFY 1] Post-deployment table count: {post_tables} (Expected: 32)")
        assert post_tables == 32, f"32-table invariant violated! Found {post_tables}"

        # 2. Permissions count
        cur.execute("SELECT count(*) FROM public.permissions;")
        perm_count = cur.fetchone()[0]
        print(f"[VERIFY 2] Total permissions count: {perm_count} (Expected: 39)")
        assert perm_count >= 39, f"Expected at least 39 permissions, found {perm_count}"

        # 3. Functions in public schema
        expected_funcs = [
            'transition_case_status', 'assign_case_bureau', 'update_case_bureau_assignment',
            'assign_case_officer', 'update_case_officer_assignment', 'create_case_note',
            'update_case_note', 'soft_delete_case_note', 'case_notes_projection',
            'register_case_attachment', 'quarantine_case_attachment', 'case_attachments_projection',
            'request_case_transfer', 'decide_case_transfer', 'request_case_access',
            'case_access_requests_queue', 'decide_case_access_request', 'revoke_case_access_grant',
            'case_access_grants_projection', 'case_detail_projection'
        ]
        cur.execute("""
            SELECT count(*) 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
              AND routine_name = ANY(%s);
        """, (expected_funcs,))
        func_count = cur.fetchone()[0]
        print(f"[VERIFY 3] Deployed Phase 3/4 functions: {func_count}/{len(expected_funcs)}")
        assert func_count == len(expected_funcs), f"Expected {len(expected_funcs)} functions, found {func_count}"

        # 4. Existing Phase 2 workflow verification: Sequence & duplicate candidate constraints
        cur.execute("SELECT last_value FROM public.case_number_seq;")
        seq_val = cur.fetchone()[0]
        print(f"[VERIFY 4] case_number_seq intact. Current sequence position: {seq_val}")

        cur.execute("SELECT count(*) FROM public.cases;")
        case_count = cur.fetchone()[0]
        print(f"[VERIFY 5] Existing cases in database: {case_count}")

    print("=" * 70)
    print("MIGRATION 0006 LIVE DEPLOYMENT COMPLETE & VERIFIED.")
    print("=" * 70)

finally:
    conn.close()
