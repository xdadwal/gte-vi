package domain

import (
	"fmt"
	"testing"
	"time"
)

func TestAggregationLatestFiftyAndExpiry(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	rs := []Rating{}
	for i := 0; i < 60; i++ {
		stars := 5
		if i < 10 {
			stars = 1
		}
		rs = append(rs, Rating{Session: fmt.Sprint(i), Stars: stars, Updated: now.Add(time.Duration(i-60) * time.Second)})
	}
	a := Aggregate(rs, now)
	if a.Status != "active" || a.Count != 60 || a.Average != 5 || a.Buffer != 500 {
		t.Fatalf("latest50: %+v", a)
	}
	a = Aggregate(rs, now.Add(31*time.Minute))
	if a.Status != "empty" || a.Count != 0 {
		t.Fatalf("expired: %+v", a)
	}
}
func TestOneSessionCannotActivate(t *testing.T) {
	now := time.Now()
	rs := []Rating{}
	for i := 0; i < 10; i++ {
		rs = append(rs, Rating{Session: "one", Stars: 5, Updated: now.Add(time.Duration(i) * time.Millisecond)})
	}
	a := Aggregate(rs, now.Add(time.Second))
	if a.Count != 1 || a.Status != "pending" || a.Buffer != 100 {
		t.Fatalf("duplicates %+v", a)
	}
}
func TestExpiryBoundary(t *testing.T) {
	now := time.Now()
	a := Aggregate([]Rating{{Session: "s", Stars: 5, Updated: now.Add(-30 * time.Minute)}}, now)
	if a.Count != 0 {
		t.Fatal("exact deadline must expire")
	}
}
