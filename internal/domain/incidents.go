package domain

import (
	"sort"
	"time"
)

type Rating struct {
	Session string
	Stars   int
	Updated time.Time
	Expires time.Time
}
type Aggregation struct {
	Status  string
	Count   int
	Average float64
	Buffer  float64
}

func Aggregate(rs []Rating, now time.Time) Aggregation {
	return AggregateWithSettings(rs, now, DefaultSettings())
}
func AggregateWithSettings(rs []Rating, now time.Time, settings Settings) Aggregation {
	bySession := map[string]Rating{}
	for _, r := range rs {
		expiry := r.Expires
		if expiry.IsZero() {
			expiry = r.Updated.Add(time.Duration(settings.ReportExpiryMinutes) * time.Minute)
		}
		if !expiry.After(now) {
			continue
		}
		old, ok := bySession[r.Session]
		if !ok || r.Updated.After(old.Updated) {
			bySession[r.Session] = r
		}
	}
	fresh := make([]Rating, 0, len(bySession))
	for _, r := range bySession {
		fresh = append(fresh, r)
	}
	a := Aggregation{Status: "empty", Count: len(fresh)}
	if a.Count == 0 {
		return a
	}
	a.Status = "pending"
	a.Buffer = float64(settings.PendingBufferMeters)
	if a.Count < settings.ActivationReports {
		return a
	}
	sort.Slice(fresh, func(i, j int) bool {
		if fresh[i].Updated.Equal(fresh[j].Updated) {
			return fresh[i].Session < fresh[j].Session
		}
		return fresh[i].Updated.After(fresh[j].Updated)
	})
	n := len(fresh)
	if n > settings.RatingWindow {
		n = settings.RatingWindow
	}
	for _, r := range fresh[:n] {
		a.Average += float64(r.Stars)
	}
	a.Average /= float64(n)
	a.Status = "active"
	a.Buffer = float64(settings.BufferPerStarMeters) * a.Average
	return a
}
