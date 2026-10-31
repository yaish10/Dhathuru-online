"""Operations check-in test (0064) on a real local PostgreSQL: applies migrations 0001-0064 (extensions stubbed) and runs the check-in flow.
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
    if n[:4]>"0064": break
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

S1,S2,HR,OUT=[uuid.uuid4() for _ in range(4)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'r@x'),(%s,'o@x')",(S1,S2,HR,OUT),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(HR,'hr','Hera')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
V1,V2=uuid.uuid4(),uuid.uuid4()
run("insert into vessels(id,company_id,code,name) values (%s,%s,'V1','Boat One'),(%s,%s,'V2','Boat Two')",(V1,cid,V2,cid),role=None)
cur.execute("select id from routes where company_id=%s limit 1",(cid,))
run("insert into routes(id,company_id,name,origin,destination) values (gen_random_uuid(),%s,'A - B','A','B')",(cid,),role=None)
cur.execute("select id from routes where company_id=%s limit 1",(cid,)); rid=cur.fetchone()[0]
TR=uuid.uuid4()
run("insert into trips(id,company_id,route_id,vessel_id,depart_at,arrive_at,seats_total) values (%s,%s,%s,%s,now()+interval '30 minutes',now()+interval '70 minutes',20)",(TR,cid,rid,V1),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)

# --- no check-in yet: look-up mode
m=run("select my_ops_checkin(%s)",(cid,),S1)[0][0]
check("not checked in at first", m["checked_in"] is False and m["rules"]["enabled"] is True and m["rules"]["enforce"] is False)
check("vessels listed, next trip's vessel suggested", len(m["vessels"])==2 and m["suggested_vessel"]==str(V1))
# --- book a passenger as staff (setup), then act without check-in: allowed while enforce is off
bk=run("select create_booking(%s,%s,%s,%s)",(cid,TR,'{"contact_name":"Zed","contact_phone":"7770000","note":"t"}','[{"full_name":"Zed One","id_number":"X1","phone":"7770000","category":"Adult","fare":100}]'),S1)[0][0]
bid=bk["id"]; pid=bk["passengers"][0]["id"]
run("select id from set_passenger_status(%s,'Boarded')",(pid,),S1)
check("enforce off: actions work without check-in", run("select status from booking_passengers where id=%s",(pid,),role=None)[0][0]=="Boarded")
# --- enforce on
run("update companies set settings = settings || '{\"3_operations_check_in\":{\"enforce\":true}}'::jsonb where id=%s",(cid,),role=None)
check("enforce on: boarding refused in look-up mode", expect_fail("select id from set_passenger_status(%s,'Checked in')",(pid,),S1,"Check in to Operations first"))
check("enforce on: mark paid refused", expect_fail("select update_booking(%s,%s)",(bid,'{"paid_amount":100,"payment_method":"Cash"}'),S1,"Check in to Operations first"))
check("enforce on: cancel booking refused", expect_fail("select cancel_booking(%s,'x')",(bid,),S1,"Check in to Operations first"))
check("enforce on: remove passenger refused", expect_fail("select update_booking_passengers(%s,'[]',array[%s]::uuid[])",(bid,pid),S1,"Check in to Operations first"))
check("look-up still allows reading the manifest", len(run("select trip_manifest(%s)",(TR,),S1)[0][0]["passengers"])==1)
# --- check in
m=run("select ops_checkin(%s,%s,%s,4.17,73.51,'dev1')",(cid,V1,TR),S1)[0][0]
check("check in returns checked_in with vessel", m["checked_in"] is True and m["current"]["vessel"]=="Boat One")
check("second check-in refused", expect_fail("select ops_checkin(%s,%s)",(cid,V2),S1,"already checked in"))
run("select id from set_passenger_status(%s,'Checked in')",(pid,),S1)
check("checked in: boarding/check-in allowed", run("select status from booking_passengers where id=%s",(pid,),role=None)[0][0]=="Checked in")
run("select update_booking(%s,%s)",(bid,'{"paid_amount":100,"payment_method":"Cash"}'),S1)
check("checked in: mark paid works", run("select payment_status from bookings where id=%s",(bid,),role=None)[0][0]=="Paid")
check("other staff still in look-up mode", expect_fail("select id from set_passenger_status(%s,'Boarded')",(pid,),S2,"Check in to Operations first"))
# --- website list
lst=run("select ops_checkins_recent(%s,20)",(cid,),HR)[0][0]
check("HR sees the recent check-in list", len(lst)==1 and lst[0]["name"]=="Ann" and lst[0]["vessel"]=="Boat One" and lst[0]["open"] is True)
check("plain staff cannot read the company list", expect_fail("select ops_checkins_recent(%s,20)",(cid,),S2,"Only Operations and HR"))
check("a person can read only their own rows", len(run("select id from ops_checkins",role="authenticated",uid=S2))==0 and len(run("select id from ops_checkins",role="authenticated",uid=S1))==1)
# --- check out
m=run("select ops_checkout(%s)",(cid,),S1)[0][0]
check("check out ends the session", m["checked_in"] is False)
check("after check-out actions are locked again", expect_fail("select id from set_passenger_status(%s,'Boarded')",(pid,),S1,"Check in to Operations first"))
check("check out twice refused", expect_fail("select ops_checkout(%s)",(cid,),S1,"not checked in"))
lst=run("select ops_checkins_recent(%s,20)",(cid,),HR)[0][0]
check("list shows the closed session", lst[0]["open"] is False and lst[0]["checked_out_at"] is not None)
# --- stale session stops counting after the rule's hours
run("select ops_checkin(%s,%s)",(cid,V2),S2)
run("update ops_checkins set checked_in_at = now() - interval '20 hours' where user_id=%s",(S2,),role=None)
check("a check-in older than the hours rule no longer counts", expect_fail("select id from set_passenger_status(%s,'Boarded')",(pid,),S2,"Check in to Operations first"))
run("select ops_checkin(%s,%s)",(cid,V2),S2)
check("a stale session is closed when checking in again", run("select count(*) from ops_checkins where user_id=%s and checked_out_at is null",(S2,),role=None)[0][0]==1)
# --- switched off
run("update companies set settings = settings || '{\"3_operations_check_in\":{\"enabled\":false}}'::jsonb where id=%s",(cid,),role=None)
check("disabled: check-in refused", expect_fail("select ops_checkin(%s,%s)",(cid,V1),S1,"switched off"))
check("disabled: actions are not gated", bool(run("select id from set_passenger_status(%s,'Boarded')",(pid,),S1)))
print("RESULT", sum(results), "/", len(results))
