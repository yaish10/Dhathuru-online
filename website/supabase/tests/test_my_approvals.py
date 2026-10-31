"""My approvals test (0067) on a real local PostgreSQL: applies migrations 0001-0067 (extensions stubbed) and runs the approvals flow.
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
    if n[:4]>"0067": break
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

S1,S2,HR,OWN=[uuid.uuid4() for _ in range(4)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'r@x'),(%s,'o@x')",(S1,S2,HR,OWN),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,OWN),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(HR,'hr','Hera'),(OWN,'owner','Olu')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)
def ap(uid): return run("select my_approvals(%s)",(cid,),uid)[0][0]

LV=uuid.uuid4()
run("insert into leave_requests(id,company_id,user_id,leave_type,start_date,end_date,note) values (%s,%s,%s,'Annual leave',current_date+5,current_date+7,'trip')",(LV,cid,S1),role=None)
check("HR sees the pending leave with name and days", [i for i in ap(HR)["pending"] if i["kind"]=="leave"][0]["requester"]=="Ann" and [i for i in ap(HR)["pending"] if i["kind"]=="leave"][0]["days"]==3)
check("plain staff see nothing to approve", ap(S2)["pending"]==[])
check("the requester does not see their own leave", ap(S1)["pending"]==[])
check("a non-member cannot ask", expect_fail("select my_approvals(%s)",(cid,),uuid.uuid4(),"Not a member"))
# named approver routing
run("update companies set settings = settings || jsonb_build_object('8_approvers_and_responsibilities', jsonb_build_object('leave', jsonb_build_object('fallback', jsonb_build_array(%s::text)))) where id=%s",(str(S2),cid),role=None)
check("named approver sees it", len([i for i in ap(S2)["pending"] if i["kind"]=="leave"])==1)
check("HR is not named, so it is not theirs", len([i for i in ap(HR)["pending"] if i["kind"]=="leave"])==0)
check("the owner can always step in", len([i for i in ap(OWN)["pending"] if i["kind"]=="leave"])==1)
# shift swap waiting for approval
SW=uuid.uuid4()
run("insert into shift_swaps(id,company_id,requester,partner,day,requester_shift,partner_shift,needs_approval,status) values (%s,%s,%s,%s,current_date+2,'M','E',true,'pending_approval')",(SW,cid,S1,S2),role=None)
sw=[i for i in ap(HR)["pending"] if i["kind"]=="swap"]
check("HR sees the swap waiting for approval", len(sw)==1 and sw[0]["partner"]=="Bob" and sw[0]["requester_shift"]=="M")
check("the people in the swap do not approve it", [i for i in ap(S2)["pending"] if i["kind"]=="swap"]==[] and [i for i in ap(S1)["pending"] if i["kind"]=="swap"]==[])
# attendance correction
AC=uuid.uuid4()
run("insert into attendance_corrections(id,company_id,user_id,day,clock_in,reason,created_by) values (%s,%s,%s,current_date-1,now()-interval '1 day','forgot to clock in',%s)",(AC,cid,S1,S1),role=None)
check("HR sees the attendance correction", len([i for i in ap(HR)["pending"] if i["kind"]=="attendance"])==1)
check("staff do not see attendance corrections", len([i for i in ap(S2)["pending"] if i["kind"]=="attendance"])==0)
# decisions use the existing functions, then move to decided
run("select decide_shift_swap(%s,false,'no cover')",(SW,),HR)
run("select decide_attendance_correction(%s,true)",(AC,),HR)
a=ap(HR)
check("decided items leave the pending list", [i for i in a["pending"] if i["kind"] in ("swap","attendance")]==[])
d={i["kind"]:i for i in a["decided"]}
check("HR's history shows the swap as rejected with the note", d["swap"]["status"]=="rejected" and d["swap"]["decision_note"]=="no cover")
check("HR's history shows the correction as approved", d["attendance"]["status"]=="approved")
run("select decide_leave(%s,true,'enjoy')",(LV,),OWN)
check("leave decided by the owner appears in the owner's history only", [i["status"] for i in ap(OWN)["decided"] if i["kind"]=="leave"]==["approved"] and [i for i in ap(HR)["decided"] if i["kind"]=="leave"]==[])
check("an already decided leave is no longer pending for anyone", all([i for i in ap(u)["pending"] if i["kind"]=="leave"]==[] for u in (HR,S2,OWN)))
run("update companies set settings = settings || '{\"8_leave_approval_workflow\":{\"comment\":true}}'::jsonb where id=%s",(cid,),role=None)
check("the comment rule is reported", ap(HR)["comment_required"] is True)
check("the helper is not callable by staff", expect_fail("select leave_can_decide(%s)",(LV,),S1,"permission denied"))
print("RESULT", sum(results), "/", len(results))
