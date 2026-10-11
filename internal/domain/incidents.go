package domain

import (
	"sort"
	"time"
)

type Rating struct {
	Session string
	Stars   int
	Updated time.Time
}
type Aggregation struct {
	Status  string
	Count   int
	Average float64
	Buffer  float64
}

func Aggregate(rs []Rating, now time.Time) Aggregation {
	bySession := map[string]Rating{}
	for _, r := range rs {
		if !r.Updated.Add(30 * time.Minute).After(now) {
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
	a.Buffer = 100
	if a.Count < 5 {
		return a
	}
	sort.Slice(fresh, func(i, j int) bool {
		if fresh[i].Updated.Equal(fresh[j].Updated) {
			return fresh[i].Session < fresh[j].Session
		}
		return fresh[i].Updated.After(fresh[j].Updated)
	})
	n := len(fresh)
	if n > 50 {
		n = 50
	}
	for _, r := range fresh[:n] {
		a.Average += float64(r.Stars)
	}
	a.Average /= float64(n)
	a.Status = "active"
	a.Buffer = 100 * a.Average
	return a
}
