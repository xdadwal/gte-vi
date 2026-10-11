package main

import (
	"math"
	"testing"
)

func TestFootAccess(t *testing.T) {
	for _, tags := range []map[string]string{{"highway": "motorway"}, {"highway": "construction"}, {"highway": "residential", "access": "private"}, {"highway": "path", "foot": "no"}, {"highway": "path", "foot:conditional": "yes @ (08:00-18:00)"}} {
		if footAccess(tags) {
			t.Fatal("unsafe access accepted", tags)
		}
	}
	if !footAccess(map[string]string{"highway": "residential"}) {
		t.Fatal("residential foot access rejected")
	}
	if !footAccess(map[string]string{"highway": "service", "access": "private", "foot": "yes"}) {
		t.Fatal("explicit pedestrian access rejected")
	}
}
func TestProjection(t *testing.T) {
	x, y := project(77.209, 28.6139)
	if math.Floor(x/500) != 1431 || math.Floor(y/500) != 6334 {
		t.Fatal(x, y)
	}
}
