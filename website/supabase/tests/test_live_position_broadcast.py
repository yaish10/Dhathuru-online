"""Live position broadcast (0074) with a stubbed realtime.send: each stored fix is sent once on vessel-pos:<company>, fixes without coordinates are not. Prints RESULT n / n."""
import os, glob, tempfile, psycopg2, pgserver, re
M=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","migrations")
d=tempfile.mkdtemp(prefix="b74_"); srv=pgserver.get_server(d, cleanup_mode="stop"); base=srv.get_uri()
c=psycopg2.connect(base); c.autocommit=True; c.cursor().execute("create database t"); c.close()
con=psycopg2.connect(base.replace("/postgres?","/t?")); con.autocommit=True; cur=con.cursor()
cur.execute("""
do $$ begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create schema if not exists storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
create schema if not exists extensions;
create function gen_random_bytes(n int) returns bytea language sql as $$ select decode(substr(md5(random()::text)||md5(random()::text)||md5(random()::text)||md5(random()::text),1,n*2),'hex') $$;
create function digest(t text, a text) returns bytea language sql as $$ select sha256(convert_to(t,'utf8')) $$;
create function digest(t bytea, a text) returns bytea language sql as $$ select sha256(t) $$;
create schema realtime; create table realtime.sent (payload jsonb, event text, topic text, priv boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql as $$ insert into realtime.sent values (payload, event, topic, private) $$;
""")
for f in sorted(glob.glob(M+"/0*.sql")):
    n=os.path.basename(f)
    sql=open(f,encoding="utf-8").read(); sql=re.sub(r"(?im)^\s*create extension[^;]*;","",sql); sql=re.sub(r"(?im)^\s*select\s+cron\.[^;]*;","",sql)
    try: cur.execute(sql)
    except Exception as e:
        if n[:4]>="0073": print("FAIL",n,str(e)[:200])
import uuid
u=str(uuid.uuid4()); cid=str(uuid.uuid4()); vid=str(uuid.uuid4())
cur.execute("insert into auth.users(id,email) values (%s,'a@x')",(u,))
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ct=cur.fetchone()[0]
cur.execute("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ct,u))
cur.execute("insert into vessels(id,company_id,name,code) values (%s,%s,'Boat','B1')",(vid,cid))
cur.execute("insert into vessel_positions (company_id,vessel_id,source,device_ref,observed_at,lat,lng,heading,speed_kn,validity) values (%s,%s,'crew_device','d',now(),4.2,73.5,123.4,2.0,'pending')",(cid,vid))
cur.execute("select payload->>'heading', payload->>'lat', event, topic, priv from realtime.sent"); r=cur.fetchall()
ok = len(r)==1 and r[0][0]=='123.4' and r[0][2]=='position' and r[0][3]=='vessel-pos:'+cid and r[0][4]
cur.execute("insert into vessel_positions (company_id,vessel_id,source,device_ref,observed_at,lat,lng,validity) values (%s,%s,'crew_device','d',now()+interval '1 s',null,null,'pending')",(cid,vid))
cur.execute("select count(*) from realtime.sent"); ok = ok and cur.fetchone()[0]==1
print(r); print("RESULT","1 / 1" if ok else "0 / 1")
