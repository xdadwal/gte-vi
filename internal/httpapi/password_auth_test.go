package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/platform"
)

func TestPasswordLoginAndReset(t *testing.T) {
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Path != "/gte_test" {
		t.Fatal("dedicated gte_test database required")
	}
	ctx := context.Background()
	parent, err := platform.Open(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.DB.Close()
	name := "gte_auth_" + platform.ID()[:12]
	if _, err = parent.DB.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	defer parent.DB.Exec(ctx, "DROP DATABASE "+name+" WITH (FORCE)")
	u.Path = "/" + name
	store, err := platform.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	email := "auth-" + platform.ID() + "@example.test"
	if err = store.Migrate(ctx, email); err != nil {
		t.Fatal(err)
	}
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Fatal("TEST_REDIS_URL required")
	}
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(opts)
	defer client.Close()
	// Delete only this fixture's login keys; never flush a shared Redis service.
	keys := []string{"login:ip:" + platform.Hash("127.0.0.241"), "login:account:" + platform.Hash(email), "login:account:" + platform.Hash("absent-"+email)}
	client.Del(ctx, keys...)
	defer client.Del(ctx, keys...)
	app := New(store, client, Config{PublicOrigin: "https://map.example", AllowedOrigins: []string{"https://alternate.example"}, Secure: true})
	request := func(username, password, origin string, cookie *http.Cookie) *httptest.ResponseRecorder {
		data, _ := json.Marshal(map[string]string{"username": username, "password": password})
		r := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(string(data)))
		r.RemoteAddr = "127.0.0.241:12345"
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		return w
	}
	check := func(w *httptest.ResponseRecorder, code int) {
		t.Helper()
		if w.Code != code {
			t.Fatalf("got %d want %d: %s", w.Code, code, w.Body.String())
		}
	}
	password := "A long initial password"
	check(request(email, password, "", nil), 403)
	check(request(email, password, "https://attacker.example", nil), 403)
	check(request(email, password, "https://map.example", nil), 401) // unprovisioned
	if err = store.SetAdminPassword(ctx, email, password); err != nil {
		t.Fatal(err)
	}
	wrong := request(email, "incorrect password", "https://map.example", nil)
	absent := request("absent-"+email, "incorrect password", "https://map.example", nil)
	check(wrong, 401)
	check(absent, 401)
	if wrong.Body.String() != absent.Body.String() {
		t.Fatal("account enumeration response")
	}
	success := request("  "+strings.ToUpper(email)+"  ", password, "https://map.example", nil)
	check(success, 200)
	cookie := success.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge != 28800 || cookie.Domain != "" {
		t.Fatal("insecure session", cookie)
	}
	me := func(c *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/v1/admin/me", nil)
		r.AddCookie(c)
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		return w
	}
	check(me(cookie), 200)
	var identity Identity
	if err = json.Unmarshal(me(cookie).Body.Bytes(), &identity); err != nil || identity.Role != "owner" || identity.CSRF == "" {
		t.Fatal(identity, err)
	}
	rotated := request(email, password, "https://alternate.example", cookie)
	check(rotated, 200)
	check(me(cookie), 401)
	cookie = rotated.Result().Cookies()[0]
	if err = store.SetAdminPassword(ctx, email, "A different long password"); err != nil {
		t.Fatal(err)
	}
	check(me(cookie), 401)
	check(request(email, password, "https://map.example", nil), 401)
	check(request(email, "A different long password", "https://map.example", nil), 200)
	if _, err = store.DB.Exec(ctx, `UPDATE admins SET enabled=false WHERE email=$1`, email); err != nil {
		t.Fatal(err)
	}
	check(request(email, "A different long password", "https://map.example", nil), 401)
	// Account and IP caps apply independently, across replicas.
	client.Set(ctx, keys[1], 10, 15*time.Minute)
	check(request(email, password, "https://map.example", nil), 429)
	client.Del(ctx, keys[1])
	client.Set(ctx, keys[0], 30, 15*time.Minute)
	check(request(email, password, "https://map.example", nil), 429)
	client.Del(ctx, keys...)
	app.Redis = nil
	check(request(email, password, "https://map.example", nil), 503)
	var leaked int
	if err = store.DB.QueryRow(ctx, `SELECT count(*) FROM audit WHERE before_state::text LIKE '%password%' OR after_state::text LIKE '%password%'`).Scan(&leaked); err != nil || leaked != 0 {
		t.Fatal("credentials in audit", err)
	}
}
