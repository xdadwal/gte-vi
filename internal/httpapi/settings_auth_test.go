package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/xdadwal/gte-vi/internal/domain"
	"github.com/xdadwal/gte-vi/internal/platform"
)

func TestSettingsOwnerCSRFAndConflict(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Path != "/gte_test" {
		t.Fatal("settings authorization test requires dedicated gte_test service")
	}
	ctx := context.Background()
	parent, err := platform.Open(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.DB.Close()
	// A separate disposable database prevents parallel platform test truncations
	// from altering this HTTP authorization fixture. No application data is touched.
	name := "gte_http_" + platform.ID()[:12]
	if _, err = parent.DB.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, e := parent.DB.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
	}()
	u.Path = "/" + name
	store, err := platform.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	if err = store.Migrate(ctx, "owner@example.test"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(ctx, `INSERT INTO admins(email,role) VALUES('reader@example.test','admin')`); err != nil {
		t.Fatal(err)
	}
	cookies := map[string]string{}
	for _, role := range []string{"owner", "reader"} {
		token := platform.ID()
		cookies[role] = token
		if _, err = store.DB.Exec(ctx, `INSERT INTO admin_sessions VALUES($1,$2,'csrf',now()+interval '1 hour')`, platform.Hash(token), role+"@example.test"); err != nil {
			t.Fatal(err)
		}
	}
	app := New(store, nil, Config{})
	values := domain.DefaultSettings()
	values.ReportHoldSeconds = 2
	body, err := json.Marshal(map[string]any{"revision": 1, "values": values, "reason": "Authorization test"})
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, role, csrf string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1/admin/settings", bytes.NewReader(body))
		if role != "" {
			req.AddCookie(&http.Cookie{Name: "gte_admin", Value: cookies[role]})
		}
		req.Header.Set("X-CSRF-Token", csrf)
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, req)
		return w
	}
	for _, tc := range []struct {
		method, role, csrf string
		status             int
	}{
		{"GET", "", "", 401}, {"PUT", "", "csrf", 401}, {"GET", "reader", "", 200},
		{"PUT", "reader", "csrf", 403}, {"PUT", "owner", "", 403}, {"PUT", "owner", "wrong", 403},
		{"PUT", "owner", "csrf", 200}, {"PUT", "owner", "csrf", 409},
	} {
		if got := request(tc.method, tc.role, tc.csrf); got.Code != tc.status {
			t.Fatalf("%s %s csrf=%q: %d %s", tc.method, tc.role, tc.csrf, got.Code, got.Body.String())
		}
	}
	var count int
	if err = store.DB.QueryRow(ctx, `SELECT count(*) FROM audit WHERE action='save-settings'`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if _, err = store.DB.Exec(ctx, `UPDATE admins SET enabled=false WHERE email='owner@example.test'`); err != nil {
		t.Fatal(err)
	}
	if got := request("PUT", "owner", "csrf"); got.Code != 401 {
		t.Fatal("revoked owner admitted", got.Code)
	}
}
