import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg

# Load environment credentials
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

EXPECTED_PERMISSIONS = [
    'CASE.STATUS.CHANGE',
    'CASE.HISTORY.VIEW',
    'CASE.NOTE.VIEW',
    'CASE.NOTE.CREATE',
    'CASE.NOTE.EDIT',
    'CASE.ASSIGN.BUREAU',
    'CASE.ASSIGN.OFFICER',
    'ATTACHMENT.UPLOAD',
    'ATTACHMENT.VIEW',
    'ATTACHMENT.DOWNLOAD',
    'ATTACHMENT.QUARANTINE',
    'CASE.TRANSFER.REQUEST',
    'CASE.TRANSFER.DECIDE',
    'CASE.ACCESS.REQUEST',
    'CASE.ACCESS.REVIEW',
    'CASE.ACCESS.APPROVE',
    'CASE.ACCESS.MANAGE',
    'CASE.ACCESS.REVOKE',
]

EXPECTED_FUNCTIONS = [
    'transition_case_status',
    'assign_case_bureau',
    'update_case_bureau_assignment',
    'assign_case_officer',
    'update_case_officer_assignment',
    'create_case_note',
    'update_case_note',
    'soft_delete_case_note',
    'case_notes_projection',
    'register_case_attachment',
    'quarantine_case_attachment',
    'case_attachments_projection',
    'request_case_transfer',
    'decide_case_transfer',
    'request_case_access',
    'case_access_requests_queue',
    'decide_case_access_request',
    'revoke_case_access_grant',
    'case_access_grants_projection',
    'case_detail_projection',
]

print("=" * 70)
print("AICTE ONEDESK — PHASE 3 + 4 ROLLBACK-ONLY DATABASE PROBES")
print("=" * 70)

conn = psycopg.connect(DATABASE_URL, autocommit=False)
try:
    with conn.cursor() as cur:
        # Step 1: Pre-migration table count
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
        pre_table_count = cur.fetchone()[0]
        print(f"[CHECK 1] Pre-migration table count: {pre_table_count} (Expected: 32)")
        assert pre_table_count == 32, f"Expected 32 tables, found {pre_table_count}"

        # Pre-migration permission count
        cur.execute("SELECT count(*) FROM public.permissions;")
        pre_perm_count = cur.fetchone()[0]
        print(f"[CHECK 2] Pre-migration permission count: {pre_perm_count}")

        # Pre-migration function count for expected set
        cur.execute("""
            SELECT count(*) 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
              AND routine_name = ANY(%s);
        """, (EXPECTED_FUNCTIONS,))
        pre_func_count = cur.fetchone()[0]
        print(f"[CHECK 2b] Pre-migration matching function count: {pre_func_count} (case_detail_projection from Phase 2.3)")

        # Step 2: Execute Migration 0006 inside transaction
        print("[ACTION] Applying Migration 0006 within uncommitted transaction...")
        cur.execute(migration_sql)
        print("[ACTION] Migration 0006 executed successfully.")

        # Step 3: During-migration table count
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
        mid_table_count = cur.fetchone()[0]
        print(f"[CHECK 3] During-migration table count: {mid_table_count} (Expected: 32)")
        assert mid_table_count == 32, f"Table count altered! Expected 32 tables, found {mid_table_count}"

        # Step 4: Verify all 18 permissions exist
        cur.execute("SELECT code FROM public.permissions WHERE code = ANY(%s);", (EXPECTED_PERMISSIONS,))
        found_perms = [r[0] for r in cur.fetchall()]
        print(f"[CHECK 4] Verified seeded permissions count: {len(found_perms)}/{len(EXPECTED_PERMISSIONS)}")
        assert len(found_perms) == len(EXPECTED_PERMISSIONS), f"Missing permissions: {set(EXPECTED_PERMISSIONS) - set(found_perms)}"

        # Step 5: Verify all functions exist in public schema
        cur.execute("""
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
              AND routine_name = ANY(%s);
        """, (EXPECTED_FUNCTIONS,))
        found_funcs = [r[0] for r in cur.fetchall()]
        print(f"[CHECK 5] Verified functions in public schema: {len(found_funcs)}/{len(EXPECTED_FUNCTIONS)}")
        assert len(found_funcs) == len(EXPECTED_FUNCTIONS), f"Missing functions: {set(EXPECTED_FUNCTIONS) - set(found_funcs)}"

        # Step 6: Functional probes of read functions
        cur.execute("SELECT * FROM public.case_notes_projection('00000000-0000-0000-0000-000000000000'::uuid);")
        notes_rows = cur.fetchall()
        print(f"[CHECK 6] Functional probe case_notes_projection: OK ({len(notes_rows)} rows)")

        cur.execute("SELECT * FROM public.case_attachments_projection('00000000-0000-0000-0000-000000000000'::uuid);")
        att_rows = cur.fetchall()
        print(f"[CHECK 7] Functional probe case_attachments_projection: OK ({len(att_rows)} rows)")

        cur.execute("SELECT * FROM public.case_access_grants_projection('00000000-0000-0000-0000-000000000000'::uuid);")
        grants_rows = cur.fetchall()
        print(f"[CHECK 8] Functional probe case_access_grants_projection: OK ({len(grants_rows)} rows)")

        cur.execute("SELECT * FROM public.case_access_requests_queue();")
        pending_reqs = cur.fetchall()
        print(f"[CHECK 9] Functional probe case_access_requests_queue: OK ({len(pending_reqs)} rows)")

    # Step 7: Rollback
    print("[ACTION] Explicitly rolling back transaction (Forward-Only Rollback-Only Probe)...")
    conn.rollback()
    print("[ACTION] Rollback complete.")

    # Step 8: Verify database returned to exact pristine state
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';")
        post_table_count = cur.fetchone()[0]
        print(f"[CHECK 10] Post-rollback table count: {post_table_count} (Expected: 32)")
        assert post_table_count == 32

        cur.execute("SELECT count(*) FROM public.permissions;")
        post_perm_count = cur.fetchone()[0]
        print(f"[CHECK 11] Post-rollback permission count: {post_perm_count} (Matches pre-migration: {post_perm_count == pre_perm_count})")
        assert post_perm_count == pre_perm_count

        cur.execute("""
            SELECT count(*) 
            FROM information_schema.routines 
            WHERE routine_schema = 'public' 
              AND routine_name = ANY(%s);
        """, (EXPECTED_FUNCTIONS,))
        post_func_count = cur.fetchone()[0]
        print(f"[CHECK 12] Post-rollback function count in public schema: {post_func_count} (Matches pre-migration: {post_func_count == pre_func_count})")
        assert post_func_count == pre_func_count

    print("=" * 70)
    print("ALL 12 ROLLBACK-ONLY PROBES PASSED WITH ZERO LEFTOVER MUTATIONS.")
    print("=" * 70)

finally:
    conn.close()
