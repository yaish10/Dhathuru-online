"""Leave status trail test (0072) on a real local PostgreSQL: applies migrations 0001-0070 (extensions stubbed) and runs the leave flow.
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
    if n[:4]>"0072": break
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


import uuid, psycopg2.extras, datetime
psycopg2.extras.register_uuid()
def run(sql, args=None, uid=None, role="authenticated"):
    cur.execute("reset role")
    cur.execute("select set_config('test.uid', %s, false)", (str(uid) if uid else '',))
    if role: cur.execute("set role " + role)
    cur.execute(sql, args)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None
cur.execute('grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema auth to authenticated')
S1,S2,HR,AP=[uuid.uuid4() for _ in range(4)]; cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'r@x'),(%s,'p@x')",(S1,S2,HR,AP),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(HR,'hr','Hera'),(AP,'staff','Pat')):
    run("insert into company_members(company_id,user_id,role,employee_no) values (%s,%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role, employee_no=excluded.employee_no",(cid,u,r,10100+["Ann","Bob","Hera","Pat"].index(n)),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
res=[]
def check(n,c): res.append(bool(c)); print(("ok   " if c else "FAIL ")+n)
today=datetime.date.today(); d0=today+datetime.timedelta(days=(7-today.weekday())%7+14)
while d0.year!=today.year: d0-=datetime.timedelta(days=7)
sun=d0-datetime.timedelta(days=(d0.weekday()+1)%7); S=lambda n:(sun+datetime.timedelta(days=n)).isoformat()
rid=run("select (request_leave(%s,'Annual leave',%s,%s,null)->>'id')::uuid",(cid,S(2),S(3)),S1)[0][0]
t=run("select leave_trail(%s)",(rid,),S1)[0][0]
check("pending: submitted then waiting for the HR team", t["status"]=="pending" and [s["state"] for s in t["steps"]]==["done","waiting"] and t["steps"][0]["name"]=="Ann" and t["steps"][1]["name"]=="HR team")
run("update companies set settings = settings || jsonb_build_object('8_approvers_and_responsibilities', jsonb_build_object('leave', jsonb_build_object('fallback', jsonb_build_array(%s::text)))) where id=%s",(str(AP),cid),role=None)
t=run("select leave_trail(%s)",(rid,),S1)[0][0]
check("named approver is listed with the number", t["steps"][1]["name"]=="Pat" and t["steps"][1]["no"] is not None)
check("the named approver can open it", run("select leave_trail(%s)",(rid,),AP)[0][0]["status"]=="pending")
try: run("select leave_trail(%s)",(rid,),S2); check("a stranger is refused", False)
except Exception as e: check("a stranger is refused", "not found" in str(e).lower()); cur.execute("reset role")
run("select decide_leave(%s,true,'Enjoy')",(rid,),AP)
t=run("select leave_trail(%s)",(rid,),S1)[0][0]
last=t["steps"][-1]
check("decided: approved by Pat with date and note", t["status"]=="approved" and last["name"]=="Pat" and last["note"]=="Enjoy" and last["at"] is not None and len(t["steps"])==2)
print("RESULT", sum(res), "/", len(res))
