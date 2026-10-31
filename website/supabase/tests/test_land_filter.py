"""Land filter (0075 + seed): points inside an island by more than 15 m are land, sea and shore margin are not, harbour zones count as sea, a land fix is marked on_land and not broadcast, and the map list holds the last sea position (setting 3_vessel_map.holdOnLand turns it off). Needs: pip install pgserver psycopg2-binary shapely. Prints RESULT n / n."""
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
import uuid, json, pickle, math
from shapely.geometry import Polygon, Point
SEED=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","seed")+"/"
for i in (1,2,3,4):
    cur.execute(open(SEED+"maldives_land_masses_%d.sql"%i).read())
cur.execute("select count(*) from land_masses"); n=cur.fetchone()[0]
cur.execute("select ring from land_masses order by jsonb_array_length(ring) desc limit 1"); ring=cur.fetchone()[0]
P=Polygon([(x[1],x[0]) for x in ring]); rp=P.representative_point()
cur.execute("select fix_on_land(null,%s,%s)",(rp.y,rp.x)); inland=cur.fetchone()[0]
cur.execute("select fix_on_land(null,%s,%s)",(4.30,73.30)); sea=cur.fetchone()[0]
# 5 m inside the coast: not land (margin 15 m)
b=P.exterior.interpolate(0.5,normalized=True); c=P.centroid
dx=(c.x-b.x); dy=(c.y-b.y); L=math.hypot(dx,dy); k=5/111320/L
near=Point(b.x+dx*k,b.y+dy*k)
cur.execute("select fix_on_land(null,%s,%s)",(near.y,near.x)); edge=cur.fetchone()[0]
# harbour exception
U=lambda:str(uuid.uuid4())
cid,u1,vid,hid=U(),U(),U(),U()
cur.execute("insert into auth.users(id,email) values (%s,'a@x')",(u1,))
cur.execute("select unnest(enum_range(null::company_type))::text limit 1"); ct=cur.fetchone()[0]
cur.execute("insert into companies(id,name,type,created_by) values (%s,'Test Co',%s,%s)",(cid,ct,u1))
cur.execute("insert into vessels(id,company_id,name,code) values (%s,%s,'Boat','B1')",(vid,cid))
cur.execute("insert into harbours(company_id,name,lat,lng,geofence_type,radius_m) values (%s,'Port',%s,%s,'circle',300)",(cid,rp.y,rp.x))
cur.execute("select fix_on_land(%s,%s,%s)",(cid,rp.y,rp.x)); inport=cur.fetchone()[0]
cur.execute("delete from harbours where company_id=%s",(cid,))
# live positions: sea fix then land fix => held at the sea fix
cur.execute("insert into vessel_positions (company_id,vessel_id,source,device_ref,observed_at,lat,lng,heading,validity) values (%s,%s,'crew_device','d',now()-interval '60 s',4.30,73.30,45,'no_active_trip')",(cid,vid))
cur.execute("insert into vessel_positions (company_id,vessel_id,source,device_ref,observed_at,lat,lng,heading,validity) values (%s,%s,'crew_device','d',now()-interval '5 s',%s,%s,90,'no_active_trip')",(cid,vid,rp.y,rp.x))
cur.execute("select on_land from vessel_positions order by observed_at"); flags=[r[0] for r in cur.fetchall()]
cur.execute("select count(*) from realtime.sent"); sent=cur.fetchone()[0]
cur.execute("select set_config('test.uid', %s, false)",(u1,))
cur.execute("select role from company_members where company_id=%s and user_id=%s",(cid,u1)); print("member",cur.fetchall())
cur.execute("set role authenticated"); 
cur.execute("select vessel_live_positions(%s)",(cid,)); r=cur.fetchone()[0]
cur.execute("reset role")
print("polygons",n,"inland",inland,"sea",sea,"edge5m",edge,"inport",inport,"flags",flags,"broadcasts",sent)
v=r[0] if r else None; print(json.dumps(v)[:300] if v else r)
# setting off => shows the land fix
cur.execute("update companies set settings = settings || '{\"3_vessel_map\":{\"holdOnLand\":false}}'::jsonb where id=%s",(cid,))
cur.execute("set role authenticated"); cur.execute("select vessel_live_positions(%s)",(cid,)); r2=cur.fetchone()[0]; cur.execute("reset role")
ok = n>1000 and inland and not sea and not edge and not inport and flags==[False,True] and sent==1 and v and v['held'] and abs(v['lat']-4.30)<1e-9 and (not r2[0]['held']) and abs(r2[0]['lat']-rp.y)<1e-6
print("RESULT","1 / 1" if ok else "0 / 1")
