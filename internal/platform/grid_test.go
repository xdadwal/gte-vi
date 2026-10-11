package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
)

func TestReportingGridUsesSeparate250MetreSubcells(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// Two points in one former 500 m cell but opposite 250 m subcells.
	var aLon, aLat, bLon, bLat float64
	err := s.DB.QueryRow(ctx, `SELECT ST_X(a),ST_Y(a),ST_X(b),ST_Y(b) FROM (
 SELECT ST_Transform(ST_SetSRID(ST_Point(715550,3167050),32643),4326) a,
 ST_Transform(ST_SetSRID(ST_Point(715800,3167050),32643),4326) b) p`).Scan(&aLon, &aLat, &bLon, &bLat)
	if err != nil {
		t.Fatal(err)
	}
	a, ax, ay, err := s.Cell(ctx, aLon, aLat)
	if err != nil {
		t.Fatal(err)
	}
	b, bx, by, err := s.Cell(ctx, bLon, bLat)
	if err != nil {
		t.Fatal(err)
	}
	if a == b || ax/2 != bx/2 || ay/2 != by/2 {
		t.Fatalf("250 m split failed: %s %s", a, b)
	}
	for n, c := range []struct {
		cell string
		x, y int
	}{{a, ax, ay}, {b, bx, by}} {
		session := ID()
		if err = s.Session(ctx, session, "csrf"); err != nil {
			t.Fatal(err)
		}
		if _, err = s.Report(ctx, session, fmt.Sprint(n), c.cell, c.x, c.y, 3); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	var width, height float64
	if err = s.DB.QueryRow(ctx, `SELECT count(*) FROM incidents WHERE status='pending'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("reports grouped across subcells: %d", count)
	}
	if err = s.DB.QueryRow(ctx, `SELECT ST_XMax(g)-ST_XMin(g),ST_YMax(g)-ST_YMin(g) FROM
 (SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(incident_json(i)->>'geometry'),4326),32643) g FROM incidents i WHERE cell=$1) p`, a).Scan(&width, &height); err != nil {
		t.Fatal(err)
	}
	if width < 249.99 || width > 250.01 || height < 249.99 || height > 250.01 {
		t.Fatalf("grid footprint %f x %f", width, height)
	}
}

func TestLegacyGridMigrationArchivesAndRetiresOnce(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	// Simulate the last schema immediately before the grid migration.
	if _, err := s.DB.Exec(ctx, `ALTER TABLE incidents DROP CONSTRAINT IF EXISTS retired_coarse_grid;DELETE FROM schema_version WHERE version=2;TRUNCATE reporting_grid_archive`); err != nil {
		t.Fatal(err)
	}
	session := ID()
	if err := s.Session(ctx, session, "csrf"); err != nil {
		t.Fatal(err)
	}
	id := ID()
	report := ID()
	if _, err := s.DB.Exec(ctx, `INSERT INTO incidents(id,cell,x,y,status,count,average,buffer,cell_size) VALUES($1,'1431:6334',1431,6334,'active',1,5,500,500);
 `, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO reports(id,episode,session_id,stars,updated_at,expires_at) VALUES($1,$2,$3,5,now()-interval '2 hours',now()-interval '61 minutes')`, report, id, Hash(session)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO outbox(payload) VALUES(jsonb_build_object('type','upsert','cell','1431:6334'))`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO receipts(session_id,key,response,expires_at) SELECT $1,'fresh',incident_json(i),now()+interval '1 hour' FROM incidents i WHERE id=$2`, Hash(session), id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO receipts(session_id,key,response,expires_at) VALUES($1,'orphan','{"id":"deleted-old-episode","status":"active","cell":"1431:6334"}',now()+interval '1 hour')`, Hash(session)); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, ""); err != nil {
		t.Fatal(err)
	}
	var incident map[string]any
	var reports []map[string]any
	var iRaw, rRaw []byte
	if err := s.DB.QueryRow(ctx, `SELECT incident,reports FROM reporting_grid_archive WHERE incident_id=$1`, id).Scan(&iRaw, &rRaw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(iRaw, &incident); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(rRaw, &reports); err != nil {
		t.Fatal(err)
	}
	if incident["cell"] != "1431:6334" || incident["status"] != "active" || len(reports) != 1 || reports[0]["id"] != report || reports[0]["suppressed"] != false {
		t.Fatalf("original evidence changed: %s %s", iRaw, rRaw)
	}
	var cell, status string
	var suppressed bool
	var revision int64
	if err := s.DB.QueryRow(ctx, `SELECT cell,status,revision,(SELECT suppressed FROM reports WHERE id=$2) FROM incidents WHERE id=$1`, id, report).Scan(&cell, &status, &revision, &suppressed); err != nil {
		t.Fatal(err)
	}
	if cell != "archive:500:1431:6334" || status != "empty" || !suppressed {
		t.Fatalf("legacy cell not retired: %s %s %t", cell, status, suppressed)
	}
	var removes, upserts int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FILTER(WHERE payload->>'type'='remove'),count(*) FILTER(WHERE payload->>'type'='upsert') FROM outbox WHERE payload->>'cell'='1431:6334'`).Scan(&removes, &upserts); err != nil {
		t.Fatal(err)
	}
	if removes != 1 || upserts != 0 {
		t.Fatalf("old events not replaced with tombstone: %d %d", removes, upserts)
	}
	if err := s.Migrate(ctx, ""); err != nil {
		t.Fatal(err)
	}
	var after int64
	if err := s.DB.QueryRow(ctx, `SELECT revision FROM incidents WHERE id=$1`, id).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != revision {
		t.Fatal("migration rerun changed archived row")
	}
	// A new fine-grid cell can reuse a legacy canonical key without collision.
	response, err := s.Report(ctx, session, "fresh", "1431:6334", 1431, 6334, 2)
	if err != nil {
		t.Fatal(err)
	}
	var fresh map[string]any
	if err = json.Unmarshal(response, &fresh); err != nil {
		t.Fatal(err)
	}
	if fresh["id"] == id {
		t.Fatal("old idempotency receipt resurrected coarse incident")
	}
	orphan, err := s.Report(ctx, session, "orphan", "1431:6334", 1431, 6334, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(orphan, &fresh); err != nil {
		t.Fatal(err)
	}
	if fresh["id"] == "deleted-old-episode" {
		t.Fatal("orphaned coarse-grid receipt returned")
	}
	var fine int
	if err := s.DB.QueryRow(ctx, `SELECT cell_size FROM incidents WHERE cell='1431:6334'`).Scan(&fine); err != nil {
		t.Fatal(err)
	}
	if fine != 250 {
		t.Fatalf("new incident has coarse geometry: %d", fine)
	}
	if err := s.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	var pruned int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM reports WHERE id=$1`, report).Scan(&pruned); err != nil {
		t.Fatal(err)
	}
	if pruned != 0 {
		t.Fatal("expiry did not prune original report")
	}
	var retained int
	if err := s.DB.QueryRow(ctx, `SELECT jsonb_array_length(reports) FROM reporting_grid_archive WHERE incident_id=$1`, id).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if retained != 1 {
		t.Fatal("expiry removed archived evidence")
	}

}
