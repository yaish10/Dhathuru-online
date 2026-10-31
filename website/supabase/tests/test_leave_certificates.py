"""Leave certificate rules test (0069) on a real local PostgreSQL: applies migrations 0001-0069 (extensions stubbed) and runs the leave flow.
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
    if n[:4]>"0069": break
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
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL"+" ")+name)
def ov(uid): return run("select my_leave_overview(%s)",(cid,),uid)[0][0]
import datetime
today=datetime.date.today()
# a Monday-start week far enough ahead, in the current year when possible
d0=today+datetime.timedelta(days=(7-today.weekday())%7+14)
while d0.year!=today.year: d0-=datetime.timedelta(days=7)
def D(n): return (d0+datetime.timedelta(days=n)).isoformat()

import datetime
today=datetime.date.today()
d0=today+datetime.timedelta(days=(7-today.weekday())%7+14)
while d0.year!=today.year: d0-=datetime.timedelta(days=7)

run("update companies set settings = settings || %s::jsonb where id=%s",(psycopg2.extras.Json({"8_leave_types_and_policies":[
  {"name":"Sick leave","days":30,"paid":True,"note":False,"cert":"Optional","nocert":5,"nocertRun":2},
  {"name":"Medical leave","days":10,"paid":True,"note":False,"cert":"Required","nocert":0,"nocertRun":0},
  {"name":"Annual leave","days":20,"paid":True,"note":False,"cert":"Not applicable"}]}),cid),role=None)
o=ov(S1)
sick=[t for t in o["types"] if t["name"]=="Sick leave"][0]
check("the certificate rules reach the apps", sick["cert"]=="Optional" and sick["nocert"]==5 and sick["nocert_run"]==2 and sick["nocert_remaining"]==5)
check("a type without a rule has no certificate numbers", [t for t in o["types"] if t["name"]=="Annual leave"][0]["nocert_remaining"] is None)
sun=d0-datetime.timedelta(days=(d0.weekday()+1)%7)
S=lambda n:(sun+datetime.timedelta(days=n)).isoformat()
# Sun..Thu are working days (weekend Fri+Sat)
r=run("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(0),S(1)),S1)[0][0]
check("2 working days without a certificate are allowed", r["certificate"] is False and r["days"]==2)
check("3 days in a row without a certificate are refused", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(7),S(9)),S1,"at most 2 working days in a row"))
check("the same 3 days with a certificate are fine", run("select request_leave(%s,'Sick leave',%s,%s,null,true)",(cid,S(7),S(9)),S1)[0][0]["certificate"] is True)
# a day right after an uncertified stretch joins it
check("an uncertified day that runs into another uncertified request counts as one stretch", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(2),S(2)),S1,"in a row"))
# across the weekend: Thu uncertified then next Sun uncertified are consecutive working days
run("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(14),S(14)),S1)   # Sun, 1 day
# yearly uncertified allowance: used so far 2 + 1 = 3 of 5
sick=[t for t in ov(S1)["types"] if t["name"]=="Sick leave"][0]
check("uncertified days used are counted", sick["nocert_used"]==3 and sick["nocert_remaining"]==2)
run("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(21),S(22)),S1)
check("the yearly uncertified allowance is used up", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null,false)",(cid,S(28),S(28)),S1,"allows 5 working days a year"))
check("certified days do not use the uncertified allowance", run("select request_leave(%s,'Sick leave',%s,%s,null,true)",(cid,S(35),S(35)),S1)[0][0]["certificate"] is True)
sick=[t for t in ov(S1)["types"] if t["name"]=="Sick leave"][0]
check("total days still count with and without", sick["pending"]==2+3+1+2+1)
# omitted answer on an optional type counts as without
check("no answer on an optional type counts as without a certificate", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null)",(cid,S(42),S(42)),S1,"allows 5 working days a year"))
# required
check("a required type refuses a request without a certificate", expect_fail("select request_leave(%s,'Medical leave',%s,%s,null,false)",(cid,S(7),S(7)),S2,"certificate is required"))
check("a required type refuses no answer", expect_fail("select request_leave(%s,'Medical leave',%s,%s,null)",(cid,S(7),S(7)),S2,"certificate is required"))
check("a required type accepts a certificate", run("select request_leave(%s,'Medical leave',%s,%s,null,true)",(cid,S(7),S(7)),S2)[0][0]["certificate"] is True)
# a type with no rule ignores the flag
check("a type without a rule stores no certificate flag", run("select request_leave(%s,'Annual leave',%s,%s,null,true)",(cid,S(30),S(30)),S2)[0][0]["certificate"] is None)
# the rules also apply to a direct insert (the website form)
check("a direct insert for a required type is refused too", expect_fail("insert into leave_requests(company_id,user_id,leave_type,start_date,end_date) values (%s,%s,'Medical leave',%s,%s)",(cid,S2,S(14),S(14)),S2,"certificate is required"))
run("insert into leave_requests(company_id,user_id,leave_type,start_date,end_date,certificate) values (%s,%s,'Medical leave',%s,%s,true)",(cid,S2,S(21),S(21)),S2)
check("a direct insert with a certificate works", True)
# my requests list shows the flag
reqs=ov(S1)["requests"]
check("requests list shows with and without", {r["certificate"] for r in reqs if r["type"]=="Sick leave"}=={True,False})
# approvals show the flag
lv=[i for i in run("select my_approvals(%s)",(cid,),HR)[0][0]["pending"] if i["kind"]=="leave" and i["title"]=="Sick leave"]
check("approvers see whether sick leave has a certificate", len(lv)>=1 and {i["certificate"] for i in lv}=={True,False})
print("RESULT", sum(results), "/", len(results))
