package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	u := os.Getenv("TEST_DATABASE_URL")
	if u == "" {
		t.Skip("TEST_DATABASE_URL required for PostGIS integration")
	}
	s, e := Open(context.Background(), u)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.DB.Close)
	if e = s.Migrate(context.Background(), "owner@example.test"); e != nil {
		t.Fatal(e)
	}
	_, e = s.DB.Exec(context.Background(), `TRUNCATE receipts,reports,incidents,sessions,outbox,refuges,audit,admin_sessions RESTART IDENTITY CASCADE`)
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestReportActivationReplacementAndModeration(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, x, y, e := s.Cell(ctx, 77.209, 28.6139)
	if e != nil {
		t.Fatal(e)
	}
	if _, _, _, e = s.Cell(ctx, 72.8, 19); e == nil {
		t.Fatal("Mumbai accepted")
	}
	sessions := []string{}
	var last map[string]any
	for i := 0; i < 5; i++ {
		id := ID()
		sessions = append(sessions, id)
		s.Session(ctx, id, "csrf")
		b, e := s.Report(ctx, id, "one", c, x, y, i+1)
		if e != nil {
			t.Fatal(e)
		}
		json.Unmarshal(b, &last)
	}
	if last["status"] != "active" || last["count"] != float64(5) || last["average"] != float64(3) {
		t.Fatalf("%v", last)
	}
	b, e := s.Report(ctx, sessions[0], "two", c, x, y, 5)
	if e != nil {
		t.Fatal(e)
	}
	json.Unmarshal(b, &last)
	if last["count"] != float64(5) || last["average"] != 3.8 {
		t.Fatal(last)
	}
	before := last["revision"]
	b, e = s.Report(ctx, sessions[0], "two", c, x, y, 1)
	json.Unmarshal(b, &last)
	if e != nil || last["revision"] != before {
		t.Fatal("idempotency mutated state")
	}
	if e = s.Moderate(ctx, "owner@example.test", last["id"].(string), int64(last["revision"].(float64)), "hide", "", "spam"); e != nil {
		t.Fatal(e)
	}
	b, e = s.Report(ctx, sessions[0], "three", c, x, y, 5)
	if e != nil {
		t.Fatal(e)
	}
	var fresh map[string]any
	json.Unmarshal(b, &fresh)
	if fresh["id"] == last["id"] || fresh["count"] != float64(1) {
		t.Fatal("hide did not start new episode", fresh)
	}
}
func TestExpiryAndPrivateRefugeDetails(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, x, y, _ := s.Cell(ctx, 77.209, 28.6139)
	for i := 0; i < 5; i++ {
		id := ID()
		s.Session(ctx, id, "c")
		s.Report(ctx, id, fmt.Sprint(i), c, x, y, 5)
	}
	s.DB.Exec(ctx, `UPDATE reports SET updated_at=now()-interval '30 minutes 1 second',expires_at=now()-interval '1 second' WHERE id=(SELECT id FROM reports LIMIT 1)`)
	s.DB.Exec(ctx, `UPDATE incidents SET updated_at=now()-interval '2 seconds'`)
	if e := s.Expire(ctx); e != nil {
		t.Fatal(e)
	}
	snap, e := s.Snapshot(ctx, []string{c}, false)
	if e != nil {
		t.Fatal(e)
	}
	var i map[string]any
	json.Unmarshal(snap["incidents"].([]json.RawMessage)[0], &i)
	if i["status"] != "pending" {
		t.Fatal(i)
	}
	r := Refuge{ID: ID(), Name: "Test host", Lon: 77.22, Lat: 28.62, Instructions: "Front gate", Hours: json.RawMessage(`{"0":[[0,1440]],"1":[[0,1440]],"2":[[0,1440]],"3":[[0,1440]],"4":[[0,1440]],"5":[[0,1440]],"6":[[0,1440]]}`), Exceptions: json.RawMessage(`{}`), HostContact: "private phone", ConfirmationNote: "agreed", ConfirmedAt: ptrTime(time.Now()), Publication: "published"}
	if e := s.SaveRefuge(ctx, "owner@example.test", r); e != nil {
		t.Fatal(e)
	}
	snap, e = s.Snapshot(ctx, nil, true)
	if e != nil {
		t.Fatal(e)
	}
	rs := snap["refuges"].([]json.RawMessage)
	if len(rs) != 1 {
		t.Fatal("missing public refuge")
	}
	var pub map[string]any
	json.Unmarshal(rs[0], &pub)
	if _, ok := pub["hostContact"]; ok {
		t.Fatal("private contact leaked")
	}
	if e = s.SaveRefuge(ctx, "owner@example.test", r); e != ErrConflict {
		t.Fatal("stale refuge update accepted", e)
	}
}
func ptrTime(t time.Time) *time.Time { return &t }
