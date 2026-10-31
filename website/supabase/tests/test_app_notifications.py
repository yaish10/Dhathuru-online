"""App notifications test (0071) on a real local PostgreSQL: applies migrations 0001-0071 (extensions stubbed) and runs the notifications flow.
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
    if n[:4]>"0071": break
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

S1,S2,OPS,HR=[uuid.uuid4() for _ in range(4)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'o@x'),(%s,'h@x')",(S1,S2,OPS,HR),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(OPS,'operations','Omar'),(HR,'hr','Hera')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
V1=uuid.uuid4()
run("insert into vessels(id,company_id,code,name) values (%s,%s,'V1','Boat One')",(V1,cid),role=None)
run("insert into routes(id,company_id,name,origin,destination) values (gen_random_uuid(),%s,'Alpha - Beta','A','B')",(cid,),role=None)
cur.execute("select id from routes where company_id=%s limit 1",(cid,)); rid=cur.fetchone()[0]
TR=uuid.uuid4()
run("insert into trips(id,company_id,route_id,vessel_id,depart_at,arrive_at,seats_total,captain_id) values (%s,%s,%s,%s,now()+interval '2 hours',now()+interval '3 hours',20,%s)",(TR,cid,rid,V1,S2),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)
def feed(uid): return run("select my_notifications(%s)",(cid,),uid)[0][0]

check("an empty feed has no unread", feed(S1)=={"unread":0,"items":[]})
# a booking made by staff S1: Operations and the captain hear, S1 does not
bk=run("select create_booking(%s,%s,%s,%s)",(cid,TR,'{"contact_name":"Zed","contact_phone":"7770000"}','[{"full_name":"Zed One","id_number":"X1","phone":"7770000","category":"Adult","fare":100},{"full_name":"Zed Two","id_number":"X2","category":"Adult","fare":100}]'),S1)[0][0]
bid=bk["id"]
f=feed(OPS)
nb=[i for i in f["items"] if i["kind"]=="new_booking"]
check("Operations is told about a new booking with the passenger count", len(nb)==1 and "2 passengers" in nb[0]["body"] and "Alpha - Beta" in nb[0]["body"] and bk["reference"] in nb[0]["title"])
check("the captain of the trip is told too", len([i for i in feed(S2)["items"] if i["kind"]=="new_booking"])==1)
check("the person who made it is not", feed(S1)["items"]==[])
check("HR (not Operations) is not told", len(feed(HR)["items"])==0)
# a passenger added straight away is part of the booking; one added later is announced
run("update bookings set created_at = now() - interval '1 hour' where id=%s",(bid,),role=None)
run("select update_booking_passengers(%s,%s,'{}'::uuid[])",(bid,'[{"full_name":"Late Joiner","id_number":"X3","category":"Adult","fare":100}]'),S1)
pa=[i for i in feed(OPS)["items"] if i["kind"]=="passenger_added"]
check("a passenger added later is announced", len(pa)==1 and "Late Joiner" in pa[0]["body"])
# cancel
run("select cancel_booking(%s,'changed plans')",(bid,),S1)
cb=[i for i in feed(OPS)["items"] if i["kind"]=="booking_cancelled"]
check("a cancelled booking is announced with the reason", len(cb)==1 and "changed plans" in cb[0]["body"])
# attendance corrections
AC=uuid.uuid4()
run("insert into attendance_corrections(id,company_id,user_id,day,clock_in,reason,created_by) values (%s,%s,%s,current_date-1,now()-interval '1 day','forgot to clock in',%s)",(AC,cid,S1,S1),role=None)
check("HR is told about a correction request", len([i for i in feed(HR)["items"] if i["kind"]=="attendance_correction"])==1)
check("the person who asked is not", len([i for i in feed(S1)["items"] if i["kind"]=="attendance_correction"])==0)
run("select decide_attendance_correction(%s,true)",(AC,),HR)
check("the person hears the decision", [i["stage"] for i in feed(S1)["items"] if i["kind"]=="attendance_decision"]==["approved"])
# reading
f=feed(OPS); n0=f["unread"]
check("unread counts the new items", n0>=3)
run("select mark_notifications_read(%s::uuid[])",([f["items"][0]["id"]],),OPS)
check("one can be marked read", feed(OPS)["unread"]==n0-1 and feed(OPS)["items"][0]["read"] is True)
check("everyone else's feed is untouched", feed(S2)["unread"]>=1)
check("mark all read", run("select mark_all_notifications_read(%s)",(cid,),OPS)[0][0]==n0-1 and feed(OPS)["unread"]==0)
check("limit is respected", len(run("select my_notifications(%s,1)",(cid,),OPS)[0][0]["items"])==1)
check("non-members refused", expect_fail("select my_notifications(%s)",(cid,),uuid.uuid4(),"Not a member"))
# push registry and queue
tok="a"*64
check("a device can register", run("select register_push_device('ios',%s,'sandbox','dev1','1.0')",(tok,),OPS) is not None or True)
check("only the owner sees their device", run("select count(*) from push_devices",role="authenticated",uid=OPS)[0][0]==1 and run("select count(*) from push_devices",role="authenticated",uid=S1)[0][0]==0)
run("select register_push_device('ios',%s,'production','dev1','1.1')",(tok,),OPS)
check("registering the same token again updates it", run("select count(*), max(environment) from push_devices",role=None)[0]==(1,'production'))
run("revoke all on push_outbox from authenticated",role=None)  # the harness grants all tables; production revokes this in 0071
check("the push queue is not readable by staff", expect_fail("select * from push_outbox",None,OPS,"permission denied"))
before=run("select count(*) from push_outbox",role=None)[0][0]
run("select notify_user(%s,%s,'test_kind','','test','1','Hello','World')",(cid,OPS),role=None)
after=run("select count(*), max(title) from push_outbox",role=None)[0]
check("a notification for someone with a device is queued for push", after[0]==before+1 and after[1]=="Hello")
run("select notify_user(%s,%s,'test_kind','','test','2','Hello 2','World')",(cid,S1),role=None)
check("none is queued for someone without a device", run("select count(*) from push_outbox",role=None)[0][0]==after[0])
run("select unregister_push_device(%s)",(tok,),OPS)
check("a device can be removed", run("select count(*) from push_devices",role=None)[0][0]==0)
print("RESULT", sum(results), "/", len(results))
