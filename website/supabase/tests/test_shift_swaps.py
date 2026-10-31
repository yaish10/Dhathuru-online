"""Shift swap test (0061) on a real local PostgreSQL: applies migrations 0001-0061 (extensions stubbed) and runs the swap flow.
Run:  python -m venv .venv && .venv/bin/pip install pgserver psycopg2-binary && .venv/bin/python supabase/tests/test_shift_swaps.py
0040 reports a failure on a missing pgcrypto digest in this harness; it is not used by the swap flow. Prints RESULT n / n.
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
    if n[:4]>"0063": break
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
A,B,HOD,HR,OUT=[uuid.uuid4() for _ in range(5)]
cid=uuid.uuid4()
run("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x'),(%s,'h@x'),(%s,'r@x'),(%s,'o@x')",(A,B,HOD,HR,OUT),role=None)
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ctype=cur.fetchone()[0]
run("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ctype,HR),role=None)
for u,r,n in ((A,'staff','Ann'),(B,'staff','Bob'),(HOD,'staff','Hod'),(HR,'hr','Hera'),(OUT,'staff','Out')):
    run("insert into company_members(company_id,user_id,role) values (%s,%s,%s) on conflict (company_id,user_id) do update set role=excluded.role",(cid,u,r),role=None)
    run("insert into profiles(id,full_name) values (%s,%s) on conflict (id) do update set full_name=excluded.full_name",(u,n),role=None)
run("update company_members set manager_id=%s where company_id=%s and user_id=%s",(HOD,cid,A),role=None)
cur.execute("select now()::date + 3"); day=cur.fetchone()[0]
def setroster(u,s): run("insert into roster_entries(company_id,user_id,day,shift) values (%s,%s,%s,%s) on conflict (company_id,user_id,day) do update set shift=excluded.shift",(cid,u,day,s),role=None)
def shifts(): return dict(run("select user_id::text, shift from roster_entries where company_id=%s and day=%s",(cid,day),role=None))
def swap(uid, partner, d=None, reason=None): return run("select id from request_shift_swap(%s,%s,%s,%s)",(cid,partner,d or day,reason),uid)
setroster(A,'D'); setroster(B,'E'); setroster(HOD,'D')

results=[]
def check(name, cond): results.append(cond); print(("ok   " if cond else "FAIL ")+name)

# 1 default rules: HOD approval needed
r=run("select swap_rules(%s)",(cid,),A)[0][0]; check("default rules hod=true", r["hod"] is True and r["enabled"] is True)
cur.execute("reset role")
row=swap(A,B); sid=row[0][0]
check("request creates pending_partner", run("select status,needs_approval from shift_swaps where id=%s",(sid,),A)[0]==("pending_partner",True))
check("partner got a notification", run("select count(*) from notifications where user_id=%s and kind='swap_request'",(B,),role=None)[0][0]==1)
expect_fail("select respond_shift_swap(%s,true)",(sid,),A,"Only the colleague")
check("requester cannot approve early", expect_fail("select decide_shift_swap(%s,true)",(sid,),A,"not waiting"))
# decline path
run("select id from respond_shift_swap(%s,false,'busy')",(sid,),B)
check("declined", run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="declined")
check("roster unchanged after decline", shifts()=={str(A):'D',str(B):'E',str(HOD):'D'})
# accept -> pending_approval -> hod approves
sid=swap(A,B,reason="family")[0][0]
run("select id from respond_shift_swap(%s,true)",(sid,),B)
check("accept -> pending_approval", run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="pending_approval")
check("roster not swapped before approval", shifts()[str(A)]=='D')
lst=run("select my_shift_swaps(%s)",(cid,),HOD)[0][0]
check("hod sees it and can approve", len(lst)==1 and lst[0]["can_approve"] is True)
check("stranger cannot decide", expect_fail("select decide_shift_swap(%s,true)",(sid,),OUT,"approvers"))
check("partner cannot decide own swap", expect_fail("select decide_shift_swap(%s,true)",(sid,),B,"approvers"))
run("select id from decide_shift_swap(%s,true,'ok')",(sid,),HOD)
check("approved + roster swapped", shifts()[str(A)]=='E' and shifts()[str(B)]=='D' and run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="approved")
# rule off -> instant swap on accept
run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"hod\":false}}'::jsonb where id=%s",(cid,),role=None)
sid=swap(A,B)[0][0]   # A now E, B now D -> swap back
run("select id from respond_shift_swap(%s,true)",(sid,),B)
check("no-HOD rule: swapped on accept", shifts()[str(A)]=='D' and shifts()[str(B)]=='E' and run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="approved")
# validations
check("same shift refused", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,HOD,day),A,"same shift"))
check("past day refused", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,B,datetime.date(2020,1,1)),A,"later day"))
check("self swap refused", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,A,day),A,"Choose a colleague"))
check("no shift refused", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,OUT,day),A,"has no shift"))
# disabled
run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"enabled\":false}}'::jsonb where id=%s",(cid,),role=None)
check("disabled refused", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,B,day),A,"switched off"))
run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"enabled\":true,\"hod\":true}}'::jsonb where id=%s",(cid,),role=None)
# cancel + stale roster
sid=swap(A,B)[0][0]
run("select id from cancel_shift_swap(%s)",(sid,),A)
check("cancel works", run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="cancelled")
sid=swap(A,B)[0][0]; run("select id from respond_shift_swap(%s,true)",(sid,),B)
setroster(A,'N')   # roster changed after the request
check("stale roster refused on approve", expect_fail("select decide_shift_swap(%s,true)",(sid,),HOD,"changed after"))
# HR fallback approvers when nobody set
run("update company_members set manager_id=null where company_id=%s and user_id=%s",(cid,A),role=None)
check("approvers fall back to HR", [str(x) for x in run("select swap_approver_ids(%s)",(sid,),HR)[0][0]]==[str(HR)])
# candidates
setroster(A,'D')
cands=run("select swap_candidates(%s,%s)",(cid,day),A)[0][0]
check("candidates list colleagues with shifts", {c["name"] for c in cands}=={"Bob","Hod"})

run("update shift_swaps set status='cancelled' where status in ('pending_partner','pending_approval')",role=None)
# ---- 0063: default scope is Same designation (no saved value yet)
run("update companies set settings = settings - '8_shift_swap_rules' where id=%s",(cid,),role=None)
check("default scope is Same designation", run("select swap_rules(%s)",(cid,),A)[0][0]["scope"]=="Same designation")
# ---- 0062: scope (Anyone / Same designation / Same crew group) ----
cur.execute("select column_name from information_schema.columns where table_name='job_titles' and column_name='crew_group'")
has_cg = cur.fetchone() is not None
tX,tY=uuid.uuid4(),uuid.uuid4()
run("insert into job_titles(id,company_id,title%s) values (%%s,%%s,'Deckhand'%s),(%%s,%%s,'Cook'%s)" % ((",crew_group","," + "'Deck'","," + "'Other'") if has_cg else ("","","")),(tX,cid,tY,cid),role=None)
run("update company_members set job_title_id=%s where company_id=%s and user_id in (%s,%s)",(tX,cid,A,HOD),role=None)
run("update company_members set job_title_id=%s where company_id=%s and user_id=%s",(tY,cid,B),role=None)
setroster(A,'D'); setroster(B,'E'); setroster(HOD,'E')
run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"scope\":\"Anyone\"}}'::jsonb where id=%s",(cid,),role=None)
c=run("select swap_candidates(%s,%s)",(cid,day),A)[0][0]
check("scope Anyone lists both, with designation", {x["name"]:x["designation"] for x in c}=={"Bob":"Cook","Hod":"Deckhand"})
run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"scope\":\"Same designation\"}}'::jsonb where id=%s",(cid,),role=None)
c=run("select swap_candidates(%s,%s)",(cid,day),A)[0][0]
check("same designation lists only Hod", [x["name"] for x in c]==["Hod"])
check("same designation refuses Bob", expect_fail("select request_shift_swap(%s,%s,%s)",(cid,B,day),A,"your designation"))
sid=swap(A,HOD)[0][0]
check("same designation allows Hod", run("select status from shift_swaps where id=%s",(sid,),A)[0][0]=="pending_partner")
run("select id from cancel_shift_swap(%s)",(sid,),A)
if has_cg:
    run("update companies set settings = settings || '{\"8_shift_swap_rules\":{\"scope\":\"Same crew group\"}}'::jsonb where id=%s",(cid,),role=None)
    c=run("select swap_candidates(%s,%s)",(cid,day),A)[0][0]
    check("same crew group lists only Hod", [x["name"] for x in c]==["Hod"])
lst=run("select my_shift_swaps(%s)",(cid,),A)[0][0]
check("requests carry designations", all("requester_title" in x for x in lst))
print("RESULT", sum(results), "/", len(results))

print("notifs", run("select kind, count(*) from notifications group by 1 order by 1",role=None))
