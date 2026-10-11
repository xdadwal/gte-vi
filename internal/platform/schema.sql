CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS schema_version(version integer PRIMARY KEY);
INSERT INTO schema_version VALUES(1) ON CONFLICT DO NOTHING;
CREATE SEQUENCE IF NOT EXISTS entity_revision;
CREATE TABLE IF NOT EXISTS boundary(id text PRIMARY KEY, geom geometry(MultiPolygon,4326) NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY, csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS incidents(id text PRIMARY KEY, cell text UNIQUE NOT NULL, x integer NOT NULL,y integer NOT NULL,status text NOT NULL DEFAULT 'empty',count integer NOT NULL DEFAULT 0,average double precision NOT NULL DEFAULT 0,buffer double precision NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT nextval('entity_revision'),updated_at timestamptz NOT NULL DEFAULT now(),cell_size integer NOT NULL DEFAULT 250 CHECK(cell_size IN(250,500)));
-- Existing incidents were snapped to 500 m; newly created incidents use 250 m.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS cell_size integer NOT NULL DEFAULT 500 CHECK(cell_size IN(250,500));
ALTER TABLE incidents ALTER COLUMN cell_size SET DEFAULT 250;
CREATE TABLE IF NOT EXISTS reports(id text PRIMARY KEY,episode text NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,session_id text NOT NULL REFERENCES sessions(id),stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,suppressed boolean NOT NULL DEFAULT false,UNIQUE(episode,session_id));
CREATE INDEX IF NOT EXISTS reports_recent ON reports(episode,updated_at DESC,session_id DESC) WHERE NOT suppressed;
CREATE INDEX IF NOT EXISTS reports_expiry ON reports(expires_at) WHERE NOT suppressed;
CREATE TABLE IF NOT EXISTS receipts(session_id text NOT NULL REFERENCES sessions(id),key text NOT NULL,response jsonb NOT NULL,expires_at timestamptz NOT NULL,PRIMARY KEY(session_id,key));
CREATE TABLE IF NOT EXISTS admins(email text PRIMARY KEY,role text NOT NULL CHECK(role IN('owner','admin')),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS admin_sessions(id text PRIMARY KEY,email text NOT NULL REFERENCES admins(email),csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS refuges(id text PRIMARY KEY, name text NOT NULL,lon double precision NOT NULL,lat double precision NOT NULL,instructions text NOT NULL, hours jsonb NOT NULL,exceptions jsonb NOT NULL DEFAULT '{}', host_contact text NOT NULL,confirmation_note text NOT NULL,confirmed_at timestamptz,publication text NOT NULL CHECK(publication IN('draft','published','archived')),closed boolean NOT NULL DEFAULT false,revision bigint NOT NULL DEFAULT nextval('entity_revision'),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,email text NOT NULL,action text NOT NULL,target text NOT NULL,reason text NOT NULL,before_state jsonb,after_state jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox(id bigserial PRIMARY KEY, payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz);
CREATE OR REPLACE FUNCTION incident_json(i incidents) RETURNS jsonb LANGUAGE SQL STABLE AS $$
 SELECT jsonb_build_object('id',i.id,'cell',i.cell,'status',i.status,'count',i.count,'average',i.average,'buffer',i.buffer,'revision',i.revision,'updatedAt',i.updated_at,
 'geometry',ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(i.x*i.cell_size,i.y*i.cell_size,(i.x+1)*i.cell_size,(i.y+1)*i.cell_size,32643),4326))::jsonb,
 'hotzone',ST_AsGeoJSON(ST_Transform(ST_Buffer(ST_MakeEnvelope(i.x*i.cell_size,i.y*i.cell_size,(i.x+1)*i.cell_size,(i.y+1)*i.cell_size,32643),i.buffer),4326))::jsonb,
 'expiresAt',(SELECT min(expires_at) FROM reports r WHERE r.episode=i.id AND NOT suppressed AND expires_at>now()))
$$;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_hash text;
-- Switching authentication invalidates previously minted provider sessions once.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=3) THEN
  DELETE FROM admin_sessions;
  INSERT INTO schema_version VALUES(3);
 END IF;
END $$;
DROP TABLE IF EXISTS login_flows;

CREATE TABLE IF NOT EXISTS runtime_state(name text PRIMARY KEY,checked_at timestamptz NOT NULL);

CREATE TABLE IF NOT EXISTS runtime_settings(id integer PRIMARY KEY CHECK(id=1),revision bigint NOT NULL,values jsonb NOT NULL);

-- Retain original coarse-grid evidence instead of assigning it to guessed subcells.
CREATE TABLE IF NOT EXISTS reporting_grid_archive(
 incident_id text PRIMARY KEY,cell_size integer NOT NULL,
 incident jsonb NOT NULL,reports jsonb NOT NULL,archived_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM schema_version WHERE version=2) THEN
  LOCK TABLE incidents,reports,outbox IN SHARE ROW EXCLUSIVE MODE;
  INSERT INTO reporting_grid_archive(incident_id,cell_size,incident,reports)
  SELECT i.id,i.cell_size,to_jsonb(i)||jsonb_build_object('public',incident_json(i)),
   COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM reports r WHERE r.episode=i.id),'[]'::jsonb)
  FROM incidents i WHERE i.cell_size=500 ON CONFLICT DO NOTHING;
  DELETE FROM outbox WHERE published_at IS NULL AND payload->>'type' IN('upsert','remove')
   AND payload->>'cell' IN(SELECT cell FROM incidents WHERE cell_size=500);
  -- Old acknowledgements must not reintroduce coarse-grid incidents on a retry.
  UPDATE receipts SET expires_at=now();
  UPDATE reports SET suppressed=true WHERE episode IN(SELECT id FROM incidents WHERE cell_size=500);
  UPDATE incidents SET status='empty',count=0,average=0,buffer=0,
   revision=nextval('entity_revision'),updated_at=now() WHERE cell_size=500;
  INSERT INTO outbox(payload)
   SELECT jsonb_build_object('type','remove','cell',cell,'incident',incident_json(i))
   FROM incidents i WHERE cell_size=500;
  UPDATE incidents SET cell='archive:500:'||cell WHERE cell_size=500;
  ALTER TABLE incidents ADD CONSTRAINT retired_coarse_grid CHECK(cell_size<>500 OR status='empty');
  INSERT INTO schema_version VALUES(2);
 END IF;
END $$;
