CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS schema_version(version integer PRIMARY KEY);
INSERT INTO schema_version VALUES(1) ON CONFLICT DO NOTHING;
CREATE SEQUENCE IF NOT EXISTS entity_revision;
CREATE TABLE IF NOT EXISTS boundary(id text PRIMARY KEY, geom geometry(MultiPolygon,4326) NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY, csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS incidents(id text PRIMARY KEY, cell text UNIQUE NOT NULL, x integer NOT NULL,y integer NOT NULL,status text NOT NULL DEFAULT 'empty',count integer NOT NULL DEFAULT 0,average double precision NOT NULL DEFAULT 0,buffer double precision NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT nextval('entity_revision'),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reports(id text PRIMARY KEY,episode text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,session_id text NOT NULL REFERENCES sessions(id),stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,suppressed boolean NOT NULL DEFAULT false,UNIQUE(episode,session_id));
CREATE INDEX IF NOT EXISTS reports_expiry ON reports(expires_at) WHERE NOT suppressed;
CREATE TABLE IF NOT EXISTS receipts(session_id text NOT NULL REFERENCES sessions(id),key text NOT NULL,response jsonb NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(session_id,key));
CREATE TABLE IF NOT EXISTS admins(email text PRIMARY KEY,role text NOT NULL CHECK(role IN('owner','admin')),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS admin_sessions(id text PRIMARY KEY,email text NOT NULL REFERENCES admins(email),csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS refuges(id text PRIMARY KEY, name text NOT NULL,lon double precision NOT NULL,lat double precision NOT NULL,instructions text NOT NULL, hours jsonb NOT NULL,exceptions jsonb NOT NULL DEFAULT '{}', host_contact text NOT NULL,confirmation_note text NOT NULL,confirmed_at timestamptz,publication text NOT NULL CHECK(publication IN('draft','published','archived')),closed boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT nextval('entity_revision'),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,email text NOT NULL,action text NOT NULL,target text NOT NULL,reason text NOT NULL,before_state jsonb,after_state jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox(id bigserial PRIMARY KEY, payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE OR REPLACE FUNCTION incident_json(i incidents) RETURNS jsonb LANGUAGE SQL STABLE AS $$
 SELECT jsonb_build_object('id',i.id,'cell',i.cell,'status',i.status,'count',i.count,'average',i.average,'buffer',i.buffer,'revision',i.revision,'updatedAt',i.updated_at,
 'geometry',ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(i.x*500,i.y*500,(i.x+1)*500,(i.y+1)*500,32643),4326))::jsonb,
 'hotzone',ST_AsGeoJSON(ST_Transform(ST_Buffer(ST_MakeEnvelope(i.x*500,i.y*500,(i.x+1)*500,(i.y+1)*500,32643),i.buffer),4326))::jsonb,
 'expiresAt',(SELECT min(expires_at) FROM reports r WHERE r.episode=i.id AND NOT suppressed AND expires_at>now()))
$$;
CREATE TABLE IF NOT EXISTS login_flows(state text PRIMARY KEY,nonce text NOT NULL,verifier text NOT NULL,expires_at timestamptz NOT NULL);
