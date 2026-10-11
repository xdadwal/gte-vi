package httpapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
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

func TestDevelopmentOrigins(t *testing.T) {
	localOrigins := []string{"http://localhost:5173", "http://127.0.0.1:8080", "http://localhost:8080"}
	for _, secure := range []bool{false, true} {
		for _, origin := range append([]string{"http://127.0.0.1:5173", "https://evil.example", "http://localhost:9999", "http://localhost:5173.evil.example"}, localOrigins...) {
			t.Run(fmt.Sprintf("secure=%t/%s", secure, origin), func(t *testing.T) {
				a := New(nil, nil, Config{PublicOrigin: "http://127.0.0.1:5173", DevelopmentOrigins: localOrigins, Secure: secure})
				r := httptest.NewRequest("POST", "/api/v1/auth/dev", strings.NewReader(`{}`))
				r.Header.Set("Origin", origin)
				w := httptest.NewRecorder()
				a.Handler().ServeHTTP(w, r)
				allowed := origin == a.Config.PublicOrigin || (!secure && slices.Contains(localOrigins, origin))
				rejected := strings.Contains(w.Body.String(), "request origin rejected")
				if rejected == allowed {
					t.Fatalf("allowed=%t got %d %s", allowed, w.Code, w.Body.String())
				}
			})
		}
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
