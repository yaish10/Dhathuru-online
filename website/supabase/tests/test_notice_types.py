"""Notice types (0078) and safeguards (0079): setting 3_booking_notice_recipients picks job titles, roster-only, trip staff and Operations per notice; assigned vessel limits a cashier to that vessel; Operations is the fallback. Prints RESULT n / n."""
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
    if n[:4]>"0079": break
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
S1,S2,S3,S4,OPS,HR,C1,C2,C3=[uuid.uuid4() for _ in range(9)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'c@x'),(%s,'d@x'),(%s,'o@x'),(%s,'h@x'),(%s,'c1@x'),(%s,'c2@x'),(%s,'c3@x')",(S1,S2,S3,S4,OPS,HR,C1,C2,C3),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((S1,'staff','Ann'),(S2,'staff','Bob'),(S3,'staff','Cat'),(S4,'staff','Dan'),(OPS,'operations','Omar'),(HR,'hr','Hera'),(C1,'staff','Cash One'),(C2,'staff','Cash Two'),(C3,'staff','Cash Three')):
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

JT=uuid.uuid4()
run("insert into job_titles(id,company_id,title) values (%s,%s,'Cashier')",(JT,cid),role=None)
for u in (C1,C2,C3): run("update company_members set job_title_id=%s where company_id=%s and user_id=%s",(JT,cid,u),role=None)
run("update company_members set assigned_vessel='Boat Two' where company_id=%s and user_id=%s",(cid,C3),role=None)   # a cashier of another vessel
run("update trips set depart_at = date_trunc('day', now()) + interval '10 hours', arrive_at = date_trunc('day', now()) + interval '11 hours' where id=%s",(TR,),role=None)
cur.execute("select (depart_at at time zone 'Indian/Maldives')::date from trips where id=%s",(TR,)); day=cur.fetchone()[0]
run("insert into roster_entries(company_id,user_id,day,shift) values (%s,%s,%s,'M'),(%s,%s,%s,'OFF'),(%s,%s,%s,'M')",(cid,C1,day,cid,C2,day,cid,C3,day),role=None)
results=[]
def check(name, cond): results.append(bool(cond)); print(("ok   " if cond else "FAIL ")+name)
def feed(uid): return run("select my_notifications(%s)",(cid,),uid)[0][0]
def kinds(uid,k): return [i for i in feed(uid)["items"] if i["kind"]==k]
def book(name): return run("select create_booking(%s,%s,%s,%s)",(cid,TR,'{"contact_name":"%s","contact_phone":"7770000"}'%name,'[{"full_name":"%s One","id_number":"X","phone":"7770000","category":"Adult","fare":100}]'%name),S1)[0][0]

import re, json
def setcfg(obj): run("update companies set settings = coalesce(settings,'{}'::jsonb) || jsonb_build_object('11_notice_types', %s::jsonb) where id=%s",(json.dumps(obj),cid),role=None)
def clear(): run("delete from notifications where company_id=%s",(cid,),role=None)
# 1. no setting: captain only
book("Default")
check("default: the captain is told", len(kinds(S2,"new_booking"))==1)
check("default: HR and cashiers are not", all(kinds(u,"new_booking")==[] for u in (HR,C1,C2,C3)))
# 2. teams
clear(); setcfg({"new_booking":{"enabled":True,"keepDefault":True,"teams":["hr"],"designations":[],"rosteredOnly":True}})
book("Teams")
check("team HR is added", len(kinds(HR,"new_booking"))==1)
check("the default captain is kept", len(kinds(S2,"new_booking"))==1)
# 3. designations, roster and vessel rules
clear(); setcfg({"new_booking":{"enabled":True,"keepDefault":True,"teams":[],"designations":["Cashier"],"rosteredOnly":True}})
book("Desig")
check("a rostered cashier is told", len(kinds(C1,"new_booking"))==1)
check("a cashier who is OFF is not", kinds(C2,"new_booking")==[])
check("a cashier of another vessel is not", kinds(C3,"new_booking")==[])
check("the maker of the change is not told", feed(S1)["items"]==[])
# 4. keepDefault off
clear(); setcfg({"new_booking":{"enabled":True,"keepDefault":False,"teams":[],"designations":["Cashier"],"rosteredOnly":False}})
book("NoDefault")
check("keepDefault off: the captain is not told", kinds(S2,"new_booking")==[])
check("rosteredOnly off: the OFF cashier is told", len(kinds(C2,"new_booking"))==1)
check("a cashier of another vessel is still excluded", kinds(C3,"new_booking")==[])
# 5. disabled
clear(); setcfg({"new_booking":{"enabled":False,"keepDefault":True,"teams":["hr"],"designations":["Cashier"]}})
book("Off")
check("enabled off: nobody is told", all(kinds(u,"new_booking")==[] for u in (S2,HR,C1,C2,OPS)))
# 6. another notice kind (a personal one) and kinds are independent
clear(); setcfg({"new_booking":{"enabled":False}})
AC=uuid.uuid4()
run("insert into attendance_corrections(id,company_id,user_id,day,clock_in,reason,created_by) values (%s,%s,%s,current_date-1,now()-interval '1 day','forgot',%s)",(AC,cid,S1,S1),role=None)
check("another kind is not affected by a disabled one", len(kinds(HR,"attendance_correction"))==1)
run("select decide_attendance_correction(%s,true)",(AC,),HR)
check("a personal notice reaches the person by default", len(kinds(S1,"attendance_decision"))==1)
clear(); setcfg({"attendance_decision":{"enabled":True,"keepDefault":False,"teams":["operations"],"designations":[]}})
AC2=uuid.uuid4()
run("insert into attendance_corrections(id,company_id,user_id,day,clock_in,reason,created_by) values (%s,%s,%s,current_date-2,now()-interval '2 day','forgot',%s)",(AC2,cid,S1,S1),role=None)
run("select decide_attendance_correction(%s,true)",(AC2,),HR)
check("personal notice: the person is still told (locked) and Operations is added", len(kinds(S1,"attendance_decision"))==1 and len(kinds(OPS,"attendance_decision"))==1)
clear(); setcfg({"attendance_correction":{"enabled":False}})
AC3=uuid.uuid4()
run("insert into attendance_corrections(id,company_id,user_id,day,clock_in,reason,created_by) values (%s,%s,%s,current_date-3,now()-interval '3 day','forgot',%s)",(AC3,cid,S1,S1),role=None)
check("a disabled team notice is not sent", kinds(HR,"attendance_correction")==[])
# 7. conversion of the old 0077 setting
run("update companies set settings = coalesce(settings,'{}'::jsonb) - '11_notice_types' || %s::jsonb where id=%s",(json.dumps({"3_booking_notice_recipients":{"new_booking":{"designations":["Cashier"],"rosteredOnly":True,"tripStaff":False,"operations":True}}}),cid),role=None)
src=open(M+"/0078_notice_types.sql",encoding="utf-8").read()
blk=src[src.rindex("do $$"):]
cur.execute("reset role"); cur.execute(blk)
cur.execute("select settings->'11_notice_types'->'new_booking', settings ? '3_booking_notice_recipients' from companies where id=%s",(cid,)); nb,still=cur.fetchone()
check("old booking setting is converted (designation, keepDefault off, Operations team) and removed", nb["designations"]==["Cashier"] and nb["keepDefault"] is False and nb["teams"]==["operations"] and nb["enabled"] is True and not still)
# ---- 0079 safeguards
clear(); setcfg({"leave_decision":{"enabled":False,"keepDefault":False,"teams":[],"designations":[]},"payslip":{"enabled":False,"keepDefault":False}})
cur.execute("reset role"); cur.execute("select notify_user(%s,%s,'leave_decision','approved','leave',%s,'Leave approved','ok')",(cid,S1,str(uuid.uuid4())))
check("a personal notice still reaches the person even if the setting says off", cur.fetchone()[0] is True and len(kinds(S1,"leave_decision"))==1)
cur.execute("reset role"); cur.execute("select notify_many(%s,%s::uuid[],'payslip','','payroll_run',%s,'Payslip','ready')",(cid,[S1,S2],str(uuid.uuid4())))
check("a payslip still reaches everyone paid", cur.fetchone()[0]==2)
# the saving function
ok_admin=True
try: run("select set_notice_type(%s,'new_booking','{}'::jsonb)",(cid,),S1); ok_admin=False
except Exception as e: ok_admin = "owners and admins" in str(e)
cur.execute("reset role")
check("only owners and admins may change a notice", ok_admin)
run("update company_members set role='owner' where company_id=%s and user_id=%s",(cid,HR),role=None)
b=run("select set_notice_type(%s,'new_booking',%s::jsonb)",(cid,json.dumps({"enabled":False,"keepDefault":True,"teams":["hr","bogus"],"designations":["Cashier"," "],"rosteredOnly":True})),HR)[0][0]
check("the saved shape is cleaned (unknown team and empty title dropped)", b["teams"]==["hr"] and b["designations"]==["Cashier"] and b["enabled"] is False)
b2=run("select set_notice_type(%s,'leave_decision',%s::jsonb)",(cid,json.dumps({"enabled":False,"keepDefault":False,"teams":["hr"]})),HR)[0][0]
check("a personal notice cannot be saved as off or without the person", b2["enabled"] is True and b2["keepDefault"] is True and b2["teams"]==["hr"])
bad=True
try: run("select set_notice_type(%s,'not_a_notice','{}'::jsonb)",(cid,),HR); bad=False
except Exception as e: bad="Unknown notice" in str(e)
cur.execute("reset role"); check("an unknown notice type is refused", bad)
cur.execute("select detail from company_audit where company_id=%s and action='notice_changed' order by id",(cid,)); au=[r[0] for r in cur.fetchall()]
check("each change is written to the audit log", len(au)==2 and "sending OFF" in au[0] and "designations" in au[0] and au[0].startswith("new_booking"))
run("select set_notice_type(%s,'new_booking',null)",(cid,),HR); cur.execute("reset role")
cur.execute("select settings->'11_notice_types' ? 'new_booking' from companies where id=%s",(cid,)); gone=not cur.fetchone()[0]
cur.execute("select detail from company_audit where company_id=%s and action='notice_changed' order by id desc limit 1",(cid,)); last=cur.fetchone()[0]
check("reset removes the notice's settings and is logged", gone and "reset to default" in last)
print("RESULT %d / %d"%(sum(results),len(results)))
