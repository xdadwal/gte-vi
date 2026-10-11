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
	cells := make([]string, 4096)
	for i := range cells {
		cells[i] = fmt.Sprintf("%d:12668", i)
	}
	if got, err := parseCells(strings.Join(cells, ",")); err != nil || len(got) != 4096 {
		t.Fatalf("full 250 m subscription rejected: %d %v", len(got), err)
	}

	if _, e := parseCells("123:456,123:456"); e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"oops", "1:2:3", "-1:2", strings.Repeat("123:456,", 4097)} {
		if _, e := parseCells(s); e == nil {
			t.Fatal("accepted invalid zones")
		}
	}
}

// Removing the additional-origin check must break both normal writes and login.
func TestProductionAllowedOrigins(t *testing.T) {
	a := New(nil, nil, Config{PublicOrigin: "https://map.example", AllowedOrigins: []string{"https://alternate.example"}, DevelopmentOrigins: []string{"http://localhost:5173"}, Secure: true})
	for _, tc := range []struct {
		origin  string
		allowed bool
	}{
		{"https://map.example", true}, {"https://alternate.example", true},
		{"https://alternate.example.evil.test", false}, {"http://alternate.example", false},
		{"https://alternate.example:444", false}, {"null", false}, {"http://localhost:5173", false},
	} {
		for _, path := range []string{"/api/v1/admin/moderate", "/api/v1/auth/login"} {
			t.Run(tc.origin+path, func(t *testing.T) {
				r := httptest.NewRequest("POST", path, strings.NewReader(`{}`))
				r.Header.Set("Origin", tc.origin)
				w := httptest.NewRecorder()
				a.Handler().ServeHTTP(w, r)
				want := http.StatusForbidden
				if tc.allowed {
					want = http.StatusUnauthorized
					if path == "/api/v1/auth/login" {
						want = http.StatusServiceUnavailable
					}
				}
				if w.Code != want {
					t.Fatalf("got %d want %d: %s", w.Code, want, w.Body.String())
				}
			})
		}
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{}`)))
	if w.Code != http.StatusForbidden {
		t.Fatalf("login without Origin got %d", w.Code)
	}
}

func TestValidateProductionOrigins(t *testing.T) {
	for _, origin := range []string{"http://alternate.example", "https://*.example", "https://user@alternate.example", "https://alternate.example/", "https://alternate.example/path", "https://alternate.example?query", "https://alternate.example#fragment", "https://", "null", ""} {
		t.Run(origin, func(t *testing.T) {
			for _, c := range []Config{
				{PublicOrigin: origin, Secure: true},
				{PublicOrigin: "https://map.example", AllowedOrigins: []string{origin}, Secure: true},
			} {
				if c.ValidateOrigins() == nil {
					t.Fatalf("accepted invalid origin %q", origin)
				}
			}
		})
	}
	for _, c := range []Config{
		{PublicOrigin: "https://map.example", AllowedOrigins: []string{"https://alternate.example", "https://www.alternate.example:8443"}, Secure: true},
		{PublicOrigin: "http://localhost:5173"},
	} {
		if err := c.ValidateOrigins(); err != nil {
			t.Fatal(err)
		}
	}
}
