"""Leave routes by department (0073): Group:<crew group> rules are rewritten to Dept rules. Prints RESULT n / n."""
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

import uuid, json, re
U=lambda:str(uuid.uuid4())
cid,u1,a1,d1,d2,jt1,jt2=U(),U(),U(),U(),U(),U(),U()
cur.execute("insert into auth.users(id,email) values (%s,'a@x'),(%s,'b@x')",(u1,a1))
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ct=cur.fetchone()[0]
cur.execute("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ct,u1))
cur.execute("insert into departments(id,company_id,name) values (%s,%s,'Shore Ops'),(%s,%s,'Deck')",(d1,cid,d2,cid))
cur.execute("insert into job_titles(id,company_id,title,crew_group,department_id) values (%s,%s,'Cashier','Shore',%s),(%s,%s,'Mate','Deck',%s)",(jt1,cid,d1,jt2,cid,d2))
cfg={'leave':{'useManager':False,'routes':[{'applies':'Group:Shore','approvers':[a1]},{'applies':'Group:Deck','approvers':[u1]},{'applies':'All staff','approvers':[u1]}],'fallback':[]}}
cur.execute("update companies set settings=jsonb_build_object('8_approvers_and_responsibilities',%s::jsonb) where id=%s",(json.dumps(cfg),cid))
sql=open(M+"/0073_leave_routes_by_department.sql",encoding="utf-8").read()
cur.execute(sql)
cur.execute("select settings->'8_approvers_and_responsibilities'->'leave'->'routes' from companies where id=%s",(cid,))
r=cur.fetchone()[0]; print(json.dumps(r))
ok=[x['applies'] for x in r]==['Dept:'+d1,'Dept:'+d2,'All staff']
print("RESULT", "1 / 1" if ok else "0 / 1")
