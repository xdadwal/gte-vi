package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRejectCrossOriginWrite(t *testing.T) {
	a := New(nil, nil, Config{PublicOrigin: "https://map.example"})
	r := httptest.NewRequest("POST", "/api/v1/session", strings.NewReader(`{}`))
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("cross origin got %d", w.Code)
	}
}
func TestUnauthenticatedAdminIsDenied(t *testing.T) {
	a := New(nil, nil, Config{})
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/admin/incidents", nil))
	if w.Code != 401 {
		t.Fatalf("got %d", w.Code)
	}
}
func TestZoneValidation(t *testing.T) {
	if _, e := parseCells("123:456,123:456"); e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"oops", "1:2:3", "-1:2", strings.Repeat("123:456,", 1025)} {
		if _, e := parseCells(s); e == nil {
			t.Fatal("accepted invalid zones")
		}
	}
}
