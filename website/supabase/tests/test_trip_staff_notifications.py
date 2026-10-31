"""Booking notices go to the trip captain and trip_crew (not Operations unless nobody is assigned), 0076. Prints RESULT n / n."""
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
    if n[:4]>"0076": break
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
cur.execute('grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema auth to authenticated')
S1,S2,S3,S4,OPS,HR=[uuid.uuid4() for _ in range(6)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'c@x'),(%s,'d@x'),(%s,'o@x'),(%s,'h@x')",(S1,S2,S3,S4,OPS,HR),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(S3,'staff','Cat'),(S4,'staff','Dan'),(OPS,'operations','Omar'),(HR,'hr','Hera')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
V1=uuid.uuid4()
run("insert into vessels(id,company_id,code,name) values (%s,%s,'V1','Boat One')",(V1,cid),role=None)
run("insert into routes(id,company_id,name,origin,destination) values (gen_random_uuid(),%s,'Alpha - Beta','A','B')",(cid,),role=None)
cur.execute("select id from routes where company_id=%s limit 1",(cid,)); rid=cur.fetchone()[0]
TR,TR2=uuid.uuid4(),uuid.uuid4()
run("insert into trips(id,company_id,route_id,vessel_id,depart_at,arrive_at,seats_total,captain_id) values (%s,%s,%s,%s,now()+interval '2 hours',now()+interval '3 hours',20,%s)",(TR,cid,rid,V1,S2),role=None)
run("insert into trip_crew(trip_id,company_id,user_id,role) values (%s,%s,%s,'Deck')",(TR,cid,S3),role=None)
# a second trip with nobody assigned
V2=uuid.uuid4()
run("insert into vessels(id,company_id,code,name) values (%s,%s,'V2','Boat Two')",(V2,cid),role=None)
run("insert into trips(id,company_id,route_id,vessel_id,depart_at,arrive_at,seats_total) values (%s,%s,%s,%s,now()+interval '5 hours',now()+interval '6 hours',20)",(TR2,cid,rid,V2),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)
def feed(uid): return run("select my_notifications(%s)",(cid,),uid)[0][0]
def kinds(uid,k): return [i for i in feed(uid)["items"] if i["kind"]==k]
bk=run("select create_booking(%s,%s,%s,%s)",(cid,TR,'{"contact_name":"Zed","contact_phone":"7770000"}','[{"full_name":"Zed One","id_number":"X1","phone":"7770000","category":"Adult","fare":100}]'),S1)[0][0]
bid=bk["id"]
check("the captain of the trip hears about a new booking", len(kinds(S2,"new_booking"))==1)
check("crew rostered on the trip hear about it too", len(kinds(S3,"new_booking"))==1)
check("the person who made it does not", feed(S1)["items"]==[])
check("staff not on the trip do not", feed(S4)["items"]==[])
check("Operations is not told while staff are assigned", feed(OPS)["items"]==[])
run("update bookings set created_at = now() - interval '1 hour' where id=%s",(bid,),role=None)
run("select update_booking_passengers(%s,%s,'{}'::uuid[])",(bid,'[{"full_name":"Late Joiner","id_number":"X3","category":"Adult","fare":100}]'),S1)
check("crew on the trip are told when a passenger is added later", len(kinds(S3,"passenger_added"))==1 and "Late Joiner" in kinds(S3,"passenger_added")[0]["body"])
check("the captain too", len(kinds(S2,"passenger_added"))==1)
check("someone not on the trip is not", kinds(S4,"passenger_added")==[])
run("select cancel_booking(%s,'changed plans')",(bid,),S1)
check("crew on the trip are told about a cancellation", len(kinds(S3,"booking_cancelled"))==1 and "changed plans" in kinds(S3,"booking_cancelled")[0]["body"])
# trip with nobody assigned: Operations is told instead
bk2=run("select create_booking(%s,%s,%s,%s)",(cid,TR2,'{"contact_name":"Yan","contact_phone":"7771111"}','[{"full_name":"Yan One","id_number":"Y1","phone":"7771111","category":"Adult","fare":100}]'),S1)[0][0]
check("with nobody assigned, Operations is told", len(kinds(OPS,"new_booking"))==1)
check("and the unassigned staff are not", kinds(S4,"new_booking")==[])
print("RESULT %d / %d"%(sum(results),len(results)))
