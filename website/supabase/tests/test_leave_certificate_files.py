"""Leave certificate files test (0070) on a real local PostgreSQL: applies migrations 0001-0070 (extensions stubbed) and runs the leave flow.
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
    if n[:4]>"0070": break
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


# storage.objects with row level security, as on Supabase
run("alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select, insert, delete on storage.objects to authenticated",role=None)
run("update companies set settings = settings || %s::jsonb where id=%s",(psycopg2.extras.Json({"8_leave_types_and_policies":[
  {"name":"Sick leave","days":30,"paid":True,"note":False,"cert":"Optional","nocert":5,"nocertRun":2,"certFile":True},
  {"name":"Medical leave","days":10,"paid":True,"note":False,"cert":"Required","certFile":False}]}),cid),role=None)
import datetime
today=datetime.date.today()
d0=today+datetime.timedelta(days=(7-today.weekday())%7+14)
while d0.year!=today.year: d0-=datetime.timedelta(days=7)
sun=d0-datetime.timedelta(days=(d0.weekday()+1)%7)
S=lambda n:(sun+datetime.timedelta(days=n)).isoformat()
P1=f"{cid}/{S1}/{uuid.uuid4()}.pdf"; P2=f"{cid}/{S2}/{uuid.uuid4()}.jpg"
o=run("select my_leave_overview(%s)",(cid,),S1)[0][0]
check("the file rule reaches the apps", [t for t in o["types"] if t["name"]=="Sick leave"][0]["cert_file"] is True)
# storage: upload own file, not someone else's
run("insert into storage.objects(bucket_id,name,owner) values ('leave-certificates',%s,%s)",(P1,S1),S1)
check("a person can upload into their own folder", run("select count(*) from storage.objects where name=%s",(P1,),role=None)[0][0]==1)
check("a person cannot upload into someone else's folder", expect_fail("insert into storage.objects(bucket_id,name,owner) values ('leave-certificates',%s,%s)",(P2,S1),S1,"row-level security"))
check("the owner can read the file", run("select count(*) from storage.objects where name=%s",(P1,),S1)[0][0]==1)
check("another staff member cannot read it", run("select count(*) from storage.objects where name=%s",(P1,),S2)[0][0]==0)
check("HR can read it", run("select count(*) from storage.objects where name=%s",(P1,),HR)[0][0]==1)
# a request with a certificate must carry the file when the type says so
check("the file is required when the type says so", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null,true)",(cid,S(7),S(9)),S1,"Attach a copy"))
check("someone else's file path is refused", expect_fail("select request_leave(%s,'Sick leave',%s,%s,null,true,%s,'x.jpg')",(cid,S(7),S(9),P2),S1,"not yours"))
r=run("select request_leave(%s,'Sick leave',%s,%s,null,true,%s,'doctor.pdf')",(cid,S(7),S(9),P1),S1)[0][0]
check("a request with the file is accepted", r["certificate"] is True and r["has_file"] is True)
reqs=run("select my_leave_overview(%s)",(cid,),S1)[0][0]["requests"]
check("the request lists the file name and path", reqs[0]["certificate_name"]=="doctor.pdf" and reqs[0]["certificate_path"]==P1)
# approvers can open it once it is theirs
ap=[i for i in run("select my_approvals(%s)",(cid,),HR)[0][0]["pending"] if i["kind"]=="leave"]
check("approvers get the file with the request", len(ap)==1 and ap[0]["certificate_path"]==P1 and ap[0]["certificate_name"]=="doctor.pdf")
# named approver (not HR) can read it; an unrelated person cannot
run("update companies set settings = settings || jsonb_build_object('8_approvers_and_responsibilities', jsonb_build_object('leave', jsonb_build_object('fallback', jsonb_build_array(%s::text)))) where id=%s",(str(S2),cid),role=None)
check("a named approver can read the file", run("select count(*) from storage.objects where name=%s",(P1,),S2)[0][0]==1)
run("update companies set settings = settings - '8_approvers_and_responsibilities' where id=%s",(cid,),role=None)
check("without being an approver nobody else can", run("select count(*) from storage.objects where name=%s",(P1,),S2)[0][0]==0)
# no file needed when the type does not ask for it
r2=run("select request_leave(%s,'Medical leave',%s,%s,null,true)",(cid,S(14),S(14)),S2)[0][0]
check("a type that does not require the file accepts a request without it", r2["certificate"] is True and r2["has_file"] is False)
# attach later
P3=f"{cid}/{S2}/{uuid.uuid4()}.pdf"
run("insert into storage.objects(bucket_id,name,owner) values ('leave-certificates',%s,%s)",(P3,S2),S2)
run("select attach_leave_certificate(%s,%s,'later.pdf')",(r2["id"],P3),S2)
check("the file can be added to the request later", run("select certificate_name from leave_requests where id=%s",(r2["id"],),role=None)[0][0]=="later.pdf")
check("only the owner can attach", expect_fail("select attach_leave_certificate(%s,%s,'x.pdf')",(r2["id"],P1),S1,"not found"))
check("a file cannot be attached to a request without a certificate", expect_fail("select attach_leave_certificate(%s,%s,'x.pdf')",(r["id"],P1),S2,"not found"))
# without a certificate any file is dropped
r3=run("select request_leave(%s,'Sick leave',%s,%s,null,false,%s,'sneaky.pdf')",(cid,S(21),S(21),P1),S1)[0][0]
check("a request without a certificate keeps no file", run("select certificate_path from leave_requests where id=%s",(r3["id"],),role=None)[0][0] is None)
# delete: own unused file only
P4=f"{cid}/{S1}/{uuid.uuid4()}.png"
run("insert into storage.objects(bucket_id,name,owner) values ('leave-certificates',%s,%s)",(P4,S1),S1)
run("delete from storage.objects where name=%s",(P4,),S1)
check("a person can delete a file no request uses", run("select count(*) from storage.objects where name=%s",(P4,),role=None)[0][0]==0)
run("delete from storage.objects where name=%s",(P1,),S1)
check("a file that a request uses cannot be deleted by its owner", run("select count(*) from storage.objects where name=%s",(P1,),role=None)[0][0]==1)
print("RESULT", sum(results), "/", len(results))
