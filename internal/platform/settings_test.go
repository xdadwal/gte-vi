package platform

import (
	"context"
	"errors"
	"github.com/xdadwal/gte-vi/internal/domain"
	"testing"
	"time"
)

func TestSettingsSaveConflictAuditExpiryAndRecompute(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	cell, x, y, e := s.Cell(ctx, 77.209, 28.6139)
	if e != nil {
		t.Fatal(e)
	}
	id := ID()
	if e = s.Session(ctx, id, "csrf"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Report(ctx, id, "first", cell, x, y, 4); e != nil {
		t.Fatal(e)
	}
	old, e := s.GetSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	v := old.Values
	v.ActivationReports = 1
	v.BufferPerStarMeters = 200
	v.ReportExpiryMinutes = 1
	if _, e = s.SaveSettings(ctx, "owner@example.test", "   ", old.Revision, v); e == nil {
		t.Fatal("blank reason accepted")
	}
	saved, e := s.SaveSettings(ctx, "owner@example.test", "adjust rules", old.Revision, v)
	if e != nil {
		t.Fatal(e)
	}
	if saved.Revision != old.Revision+1 {
		t.Fatal(saved)
	}
	if _, e = s.SaveSettings(ctx, "owner@example.test", "stale", old.Revision, v); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	var status string
	var buffer float64
	var expiry time.Time
	if e = s.DB.QueryRow(ctx, `SELECT status,buffer,expires_at FROM incidents JOIN reports ON reports.episode=incidents.id`).Scan(&status, &buffer, &expiry); e != nil {
		t.Fatal(e)
	}
	if status != "active" || buffer != 800 || expiry.After(time.Now().Add(61*time.Second)) {
		t.Fatal(status, buffer, expiry)
	}
	var audits, events int
	if e = s.DB.QueryRow(ctx, `SELECT count(*) FROM audit WHERE action='save-settings' AND reason='adjust rules' AND before_state->>'revision'='1' AND after_state->>'revision'='2'`).Scan(&audits); e != nil || audits != 1 {
		t.Fatal(audits, e)
	}
	s.DB.QueryRow(ctx, `SELECT count(*) FROM outbox WHERE payload->>'type'='settings'`).Scan(&events)
	if events != 1 {
		t.Fatal(events)
	}
	s.DB.Exec(ctx, `UPDATE reports SET expires_at=now()-interval '1 second'`)
	v.ReportExpiryMinutes = 60
	if _, e = s.SaveSettings(ctx, "owner@example.test", "extend future reports", saved.Revision, v); e != nil {
		t.Fatal(e)
	}
	var live bool
	s.DB.QueryRow(ctx, `SELECT expires_at>now() FROM reports`).Scan(&live)
	if live {
		t.Fatal("expired report revived")
	}
}

func TestSettingsSaveWaitsForAdmissionAndReportUsesSameValues(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	cell, x, y, e := s.Cell(ctx, 77.209, 28.6139)
	if e != nil {
		t.Fatal(e)
	}
	id := ID()
	if e = s.Session(ctx, id, "csrf"); e != nil {
		t.Fatal(e)
	}
	current, e := s.GetSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	entered := make(chan struct{})
	release := make(chan struct{})
	reported := make(chan error, 1)
	go func() {
		_, e := s.ReportWithAdmission(ctx, id, "coherent", cell, x, y, 5, func(v domain.Settings) error {
			if v.ReportExpiryMinutes != 30 {
				return errors.New("unexpected admission settings")
			}
			close(entered)
			<-release
			return nil
		})
		reported <- e
	}()
	<-entered
	saved := make(chan error, 1)
	go func() {
		v := current.Values
		v.ReportExpiryMinutes = 60
		_, e := s.SaveSettings(ctx, "owner@example.test", "longer future reports", current.Revision, v)
		saved <- e
	}()
	select {
	case e := <-saved:
		close(release)
		t.Fatalf("save passed admission lock: %v", e)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if e = <-reported; e != nil {
		t.Fatal(e)
	}
	if e = <-saved; e != nil {
		t.Fatal(e)
	}
	var minutes float64
	if e = s.DB.QueryRow(ctx, `SELECT extract(epoch from expires_at-updated_at)/60 FROM reports`).Scan(&minutes); e != nil || minutes != 30 {
		t.Fatal(minutes, e)
	}
	// A confirmed retry does not re-run admission after the rules change.
	_, e = s.ReportWithAdmission(ctx, id, "coherent", cell, x, y, 1, func(domain.Settings) error { return errors.New("confirmed retry must not invoke admission") })
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.ReportWithAdmission(ctx, id, "rejected", cell, x, y, 1, func(domain.Settings) error { return errors.New("admission rejected") })
	if e == nil {
		t.Fatal("rejection ignored")
	}
	var stars int
	s.DB.QueryRow(ctx, `SELECT stars FROM reports`).Scan(&stars)
	if stars != 5 {
		t.Fatal("rejection changed reports")
	}
}
