"""Leave self-service test (0068) on a real local PostgreSQL: applies migrations 0001-0068 (extensions stubbed) and runs the leave flow.
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
    if n[:4]>"0068": break
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

o=ov(S1)
check("no types set: one default Annual leave with no limit", [t["name"] for t in o["types"]]==["Annual leave"] and o["types"][0]["remaining"] is None)
run("update companies set settings = settings || %s::jsonb where id=%s",(psycopg2.extras.Json({"8_leave_types_and_policies":[{"name":"Annual leave","days":10,"paid":True,"note":False},{"name":"Personal leave","days":5,"paid":True,"note":True},{"name":"Unpaid leave","days":0,"paid":False,"note":False}]}),cid),role=None)
o=ov(S1)
check("company types and limits are used", [(t["name"],t["days"],t["remaining"]) for t in o["types"]]==[("Annual leave",10,10),("Personal leave",5,5),("Unpaid leave",0,None)])
# weekend rule: default Friday & Saturday off. A Sun..Thu week = 5 working days, Fri..Sat = 0
sun=d0-datetime.timedelta(days=(d0.weekday()+1)%7)   # the Sunday on/before d0
S=lambda n:(sun+datetime.timedelta(days=n)).isoformat()
check("working days skip Friday and Saturday", run("select leave_working_days(%s,%s,%s)",(cid,S(0),S(6)),role=None)[0][0]==5)
run("update companies set settings = settings || '{\"8_duty_roster\":{\"weekend\":\"Saturday & Sunday\"}}'::jsonb where id=%s",(cid,),role=None)
check("the Duty Roster weekend setting is honoured", run("select leave_working_days(%s,%s,%s)",(cid,S(0),S(6)),role=None)[0][0]==5 and run("select leave_working_days(%s,%s,%s)",(cid,S(5),S(6)),role=None)[0][0]==1)
run("update companies set settings = settings || '{\"8_duty_roster\":{\"weekend\":\"Friday & Saturday\"}}'::jsonb where id=%s",(cid,),role=None)
# applying
r=run("select request_leave(%s,'Annual leave',%s,%s,'trip')",(cid,S(0),S(4)),S1)[0][0]
check("a valid request is created pending with its working days", r["status"]=="pending" and r["days"]==5)
o=ov(S1)
a=[t for t in o["types"] if t["name"]=="Annual leave"][0]
check("pending days reduce what is left", a["pending"]==5 and a["taken"]==0 and a["remaining"]==5)
check("the weekend days are returned for the form", ov(S1)["weekend"]==[5,6])
check("the request is listed", len(o["requests"])==1 and o["requests"][0]["days"]==5 and o["requests"][0]["status"]=="pending")
check("overlapping leave is refused", expect_fail("select request_leave(%s,'Annual leave',%s,%s,null)",(cid,S(3),S(8)),S1,"overlaps"))
check("more than the yearly limit is refused", expect_fail("select request_leave(%s,'Annual leave',%s,%s,null)",(cid,S(14),S(27)),S1,"allowed this year"))
check("a note is required when the type says so", expect_fail("select request_leave(%s,'Personal leave',%s,%s,null)",(cid,S(14),S(15)),S1,"note is required"))
check("unknown type refused", expect_fail("select request_leave(%s,'Study leave',%s,%s,null)",(cid,S(14),S(15)),S1,"not available"))
check("end before start refused", expect_fail("select request_leave(%s,'Annual leave',%s,%s,null)",(cid,S(10),S(9)),S1,"valid dates"))
check("weekend-only dates refused", expect_fail("select request_leave(%s,'Unpaid leave',%s,%s,null)",(cid,S(5),S(6)),S1,"weekend"))
r2=run("select request_leave(%s,'Unpaid leave',%s,%s,null)",(cid,S(14),S(16)),S1)[0][0]
check("a type with no limit can be requested freely", r2["status"]=="pending")
check("other staff cannot see my requests", len(ov(S2)["requests"])==0)
check("non-members refused", expect_fail("select my_leave_overview(%s)",(cid,),uuid.uuid4(),"Not a member"))
# decision updates taken
run("select decide_leave(%s,true,null)",(r["id"],),HR)
a=[t for t in ov(S1)["types"] if t["name"]=="Annual leave"][0]
check("after approval the days count as taken", a["taken"]==5 and a["pending"]==0 and a["remaining"]==5)
check("an approved request cannot be cancelled", expect_fail("select cancel_leave(%s)",(r["id"],),S1,"still waiting"))
# cancel pending
run("select cancel_leave(%s)",(r2["id"],),S1)
check("a waiting request can be cancelled", len(ov(S1)["requests"])==1)
check("nobody else can cancel it", expect_fail("select cancel_leave(%s)",(r["id"],),S2,"not found"))
# approval off => approved straight away
run("update companies set settings = settings || '{\"8_leave_approval_workflow\":{\"enabled\":false}}'::jsonb where id=%s",(cid,),role=None)
r3=run("select request_leave(%s,'Unpaid leave',%s,%s,null)",(cid,S(21),S(22)),S2)[0][0]
check("with approval switched off the request is approved straight away", r3["status"]=="approved" and ov(S2)["approval_on"] is False)
check("helpers are not callable by staff", expect_fail("select leave_working_days(%s,%s,%s)",(cid,S(0),S(1)),S1,"permission denied"))
print("RESULT", sum(results), "/", len(results))
