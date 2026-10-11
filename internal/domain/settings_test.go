package domain

import (
	"math"
	"testing"
	"time"
)

func TestSettingsValidation(t *testing.T) {
	d := DefaultSettings()
	if e := d.Validate(); e != nil {
		t.Fatal(e)
	}
	cases := []func(*Settings){func(s *Settings) { s.ActivationReports = 51 }, func(s *Settings) { s.AlertRadiusDefaultMeters = 1250 }, func(s *Settings) { s.StaleSeconds = 15 }, func(s *Settings) { s.ReconnectMinSeconds = 40 }, func(s *Settings) { s.WalkingMaxMeters = 5001 }, func(s *Settings) { s.MapLon = math.NaN() }, func(s *Settings) { s.StarColors[0] = "red" }}
	for i, f := range cases {
		s := d
		f(&s)
		if s.Validate() == nil {
			t.Fatalf("accepted case %d", i)
		}
	}
}
func TestAggregationUsesPersistedExpiryAndWindow(t *testing.T) {
	now := time.Now()
	s := DefaultSettings()
	s.ActivationReports = 2
	s.RatingWindow = 2
	s.BufferPerStarMeters = 200
	rs := []Rating{{Session: "old", Stars: 1, Updated: now.Add(-time.Hour), Expires: now.Add(time.Minute)}, {Session: "new", Stars: 5, Updated: now, Expires: now.Add(time.Minute)}, {Session: "middle", Stars: 3, Updated: now.Add(-time.Minute), Expires: now.Add(time.Minute)}, {Session: "expired", Stars: 5, Updated: now, Expires: now.Add(-time.Second)}}
	a := AggregateWithSettings(rs, now, s)
	if a.Count != 3 || a.Status != "active" || a.Average != 4 || a.Buffer != 800 {
		t.Fatal(a)
	}
}
