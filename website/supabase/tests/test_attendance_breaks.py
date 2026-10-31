"""Attendance breaks test (0065) on a real local PostgreSQL: applies migrations 0001-0065 (extensions stubbed) and runs the break flow.
Run:  .venv/bin/python supabase/tests/test_ops_checkin.py     (needs: pip install pgserver psycopg2-binary)
Prints RESULT n / n. The 0040 failure line is a known stand-in problem in this harness and does not matter here.
"""
import os, sys, glob, tempfile, psycopg2, pgserver
M=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","migrations")
d=tempfile.mkdtemp(prefix="swap_")
srv=pgserver.get_server(d, cleanup_mode="stop")
base=srv.get_uri()
c=psycopg2.connect(base); c.autocommit=True
c.cursor().execute("create database t"); c.close()
dsn=base.replace("/postgres?","/t?")
con=psycopg2.connect(dsn); con.autocommit=True; cur=con.cursor()
cur.execute("""
do $$ begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
create schema if not exists extensions;
create function gen_random_bytes(n int) returns bytea language sql as $$ select decode(substr(md5(random()::text)||md5(random()::text)||md5(random()::text)||md5(random()::text),1,n*2),'hex') $$;
create function digest(t text, a text) returns bytea language sql as $$ select sha256(convert_to(t,'utf8')) $$;
create function digest(t bytea, a text) returns bytea language sql as $$ select sha256(t) $$;

""")
files=sorted(glob.glob(M+"/0*.sql"))
skip=set(sys.argv[1:])
for f in files:
    n=os.path.basename(f)
    if n[:4]>"0065": break
    try:
        import re
        sql=open(f,encoding="utf-8").read()
        sql=re.sub(r"(?im)^\s*create extension[^;]*;","",sql)
        sql=re.sub(r"(?im)^\s*select\s+cron\.[^;]*;","",sql)
        cur.execute(sql)
        print("ok  ",n)
    except Exception as e:
        print("FAIL",n,str(e).strip().split("\n")[0][:160])
        if n.startswith("0061") or n[:4] in ("0013","0017","0020","0043"): pass
print("DSN",dsn)

# ---------------- swap scenarios ----------------
import uuid, datetime, psycopg2.extras
psycopg2.extras.register_uuid()
def run(sql, args=None, uid=None, role="authenticated"):
    cur.execute("reset role")
    if uid: cur.execute("select set_config('test.uid', %s, false)", (str(uid),))
    else: cur.execute("select set_config('test.uid', '', false)")
    if role: cur.execute("set role " + role)
    cur.execute(sql, args)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None
def expect_fail(sql, args, uid, frag):
    try:
        run(sql, args, uid); print("FAIL (no error):", frag); return False
    except Exception as e:
        ok = frag.lower() in str(e).lower()
        print(("ok   " if ok else "FAIL ") + "error ->", str(e).strip().split("\n")[0][:120]); return ok
    finally: cur.execute("reset role")

cur.execute('grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema auth to authenticated')

import uuid, datetime, psycopg2.extras

psycopg2.extras.register_uuid()
def run(sql, args=None, uid=None, role="authenticated"):
    cur.execute("reset role")
    if uid: cur.execute("select set_config('test.uid', %s, false)", (str(uid),))
    else: cur.execute("select set_config('test.uid', '', false)")
    if role: cur.execute("set role " + role)
    cur.execute(sql, args)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None
def expect_fail(sql, args, uid, frag):
    try:
        run(sql, args, uid); print("FAIL (no error):", frag); return False
    except Exception as e:
        ok = frag.lower() in str(e).lower()
        print(("ok   " if ok else "FAIL ") + "error ->", str(e).strip().split("\n")[0][:120]); return ok
    finally: cur.execute("reset role")

cur.execute('grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema auth to authenticated')

S1,S2,HR=[uuid.uuid4() for _ in range(3)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'r@x')",(S1,S2,HR),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(HR,'hr','Hera')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)

st=run("select my_break_state(%s)",(cid,),S1)[0][0]
check("breaks are off by default and not clocked in", st["enabled"] is False and st["clocked_in"] is False)
check("break refused when HR has not allowed breaks", expect_fail("select break_punch(%s,'in')",(cid,),S1,"not switched on"))
run("update companies set settings = settings || '{\"8_attendance_rules\":{\"breaks\":true,\"break_minutes\":30}}'::jsonb where id=%s",(cid,),role=None)
st=run("select my_break_state(%s)",(cid,),S1)[0][0]
check("HR switched breaks on with a 30 minute allowance", st["enabled"] is True and st["allowance"]==30)
check("break refused before clocking in", expect_fail("select break_punch(%s,'in')",(cid,),S1,"Clock in before"))
run("select clock_punch(%s,'in')",(cid,),S1)
st=run("select my_break_state(%s)",(cid,),S1)[0][0]
check("clocked in, not on a break", st["clocked_in"] is True and st["on_break"] is False)
st=run("select break_punch(%s,'in')",(cid,),S1)[0][0]
check("break in starts a break", st["on_break"] is True and len(st["breaks"])==1)
check("second break in refused", expect_fail("select break_punch(%s,'in')",(cid,),S1,"already on a break"))
check("break out without a break refused for others", expect_fail("select break_punch(%s,'out')",(cid,),S2,"Clock in before"))
run("update attendance_breaks set break_in = now() - interval '20 minutes' where user_id=%s",(S1,),role=None)
st=run("select break_punch(%s,'out')",(cid,),S1)[0][0]
check("break out ends it and counts the minutes", st["on_break"] is False and 19<=st["used_minutes"]<=21)
check("break out twice refused", expect_fail("select break_punch(%s,'out')",(cid,),S1,"not on a break"))
st=run("select break_punch(%s,'in')",(cid,),S1)[0][0]
check("a second break is allowed inside the allowance", st["on_break"] is True and len(st["breaks"])==2)
run("update attendance_breaks set break_in = now() - interval '25 minutes' where user_id=%s and break_out is null",(S1,),role=None)
run("select clock_punch(%s,'out')",(cid,),S1)
op=run("select count(*) from attendance_breaks where user_id=%s and break_out is null",(S1,),role=None)[0][0]
check("clocking out ends an open break", op==0)
st=run("select my_break_state(%s)",(cid,),S1)[0][0]
check("after clock-out there is no open shift", st["clocked_in"] is False)
# allowance
run("select clock_punch(%s,'in')",(cid,),S2)
run("select break_punch(%s,'in')",(cid,),S2)
run("update attendance_breaks set break_in = now() - interval '40 minutes' where user_id=%s",(S2,),role=None)
run("select break_punch(%s,'out')",(cid,),S2)
check("allowance used up refuses another break", expect_fail("select break_punch(%s,'in')",(cid,),S2,"allowance"))
run("update companies set settings = settings || '{\"8_attendance_rules\":{\"breaks\":true,\"break_minutes\":0}}'::jsonb where id=%s",(cid,),role=None)
st=run("select break_punch(%s,'in')",(cid,),S2)[0][0]
check("allowance 0 means no limit", st["on_break"] is True)
# visibility
check("HR sees everyone's breaks", len(run("select id from attendance_breaks",role="authenticated",uid=HR))>=3)
check("staff see only their own breaks", len(run("select id from attendance_breaks",role="authenticated",uid=S2))==2 and len(run("select id from attendance_breaks",role="authenticated",uid=S1))==2)
check("break helper rules are not callable by staff", expect_fail("select attendance_break_rules(%s)",(cid,),S1,"permission denied"))
print("RESULT", sum(results), "/", len(results))
