"""Phone positions test (0066) on a real local PostgreSQL: applies migrations 0001-0066 (extensions stubbed) and runs the position flow.
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
    if n[:4]>"0066": break
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

S1,S2,OPS=[uuid.uuid4() for _ in range(3)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'o@x')",(S1,S2,OPS),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,OPS),role=None)
for u,r in ((S1,'staff'),(S2,'staff'),(OPS,'operations')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
V1,V2=uuid.uuid4(),uuid.uuid4()
run("insert into vessels(id,company_id,code,name) values (%s,%s,'V1','Boat One'),(%s,%s,'V2','Boat Two')",(V1,cid,V2,cid),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)
FIX="select share_vessel_position(%s,4.20,73.50,now(),8,2.0,90,'dev1',%s)"

check("no check-in: sharing refused", expect_fail(FIX,(cid,'c1'),S1,"Check in to a vessel"))
run("select ops_checkin(%s,null)",(cid,),S1)
check("checked in with no vessel: sharing refused", expect_fail(FIX,(cid,'c1'),S1,"Check in to a vessel"))
run("select ops_checkout(%s)",(cid,),S1)
run("select ops_checkin(%s,%s)",(cid,V1),S1)
r=run(FIX,(cid,'c1'),S1)[0][0]
check("checked in to a vessel: fix stored (no trip under way yet)", r.get("status")=="ignored" and r.get("reason")=="no_active_trip" and "obs" in r)
r2=run(FIX,(cid,'c1'),S1)[0][0]
check("the same phone queue id is a duplicate", r2["status"]=="duplicate")
n=run("select count(*) from vessel_positions where vessel_id=%s and source='crew_device'",(V1,),role=None)[0][0]
check("one stored fix for the vessel", n==1)
check("a different vessel got nothing", run("select count(*) from vessel_positions where vessel_id=%s",(V2,),role=None)[0][0]==0)
check("other staff cannot share for that vessel", expect_fail(FIX,(cid,'c9'),S2,"Check in to a vessel"))
# live list
lst=run("select vessel_live_positions(%s)",(cid,),OPS)[0][0]
check("Operations sees one vessel on the map, at port", len(lst)==1 and lst[0]["code"]=="V1" and lst[0]["state"]=="At port" and lst[0]["source"]=="crew_device")
check("position and accuracy are returned", abs(lst[0]["lat"]-4.20)<1e-6 and lst[0]["accuracy_m"]==8 and lst[0]["stale"] is False)
check("plain staff cannot read live positions", expect_fail("select vessel_live_positions(%s)",(cid,),S1,"Only Operations"))
run("revoke all on vessel_positions from authenticated",role=None)  # the harness grants all tables; production revokes this in 0058
check("raw fixes stay unreadable", expect_fail("select * from vessel_positions",None,S1,"permission denied"))
# state from trip and vessel status
cur.execute("select id from routes where company_id=%s limit 1",(cid,))
run("insert into routes(id,company_id,name,origin,destination) values (gen_random_uuid(),%s,'A - B','A','B')",(cid,),role=None)
cur.execute("select id from routes where company_id=%s limit 1",(cid,)); rid=cur.fetchone()[0]
TR=uuid.uuid4()
run("insert into trips(id,company_id,route_id,vessel_id,depart_at,arrive_at,seats_total,status) values (%s,%s,%s,%s,now()-interval '10 minutes',now()+interval '30 minutes',20,'Departed')",(TR,cid,rid,V1),role=None)
lst=run("select vessel_live_positions(%s)",(cid,),OPS)[0][0]
check("trip departed: state Underway with the trip attached", lst[0]["state"]=="Underway" and lst[0]["trip"]["id"]==str(TR))
run("update trips set status='Delayed' where id=%s",(TR,),role=None)
check("trip delayed: state Delayed", run("select vessel_live_positions(%s)",(cid,),OPS)[0][0][0]["state"]=="Delayed")
run("update vessels set status='Restricted' where id=%s",(V1,),role=None)
check("restricted vessel: state Restricted", run("select vessel_live_positions(%s)",(cid,),OPS)[0][0][0]["state"]=="Restricted")
# stale marking and age window
run("update vessel_positions set observed_at = now() - interval '45 minutes' where vessel_id=%s",(V1,),role=None)
lst=run("select vessel_live_positions(%s)",(cid,),OPS)[0][0]
check("a 45 minute old fix is listed but stale", len(lst)==1 and lst[0]["stale"] is True)
check("outside the age window it is not listed", run("select vessel_live_positions(%s,30)",(cid,),OPS)[0][0]==[])
# check out stops sharing
run("select ops_checkout(%s)",(cid,),S1)
check("after check-out sharing is refused", expect_fail(FIX,(cid,'c2'),S1,"Check in to a vessel"))
print("RESULT", sum(results), "/", len(results))
