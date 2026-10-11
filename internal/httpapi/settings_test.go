package httpapi

import (
	"context"
	"encoding/json"
	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/domain"
	"github.com/xdadwal/gte-vi/internal/platform"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestPublicSettingsAndMonotonicCacheInvalidation(t *testing.T) {
	a := New(nil, nil, Config{})
	v := domain.SettingsEnvelope{Revision: 2, Values: domain.DefaultSettings()}
	v.Values.ReportHoldSeconds = 2
	a.snapCache["one"] = cachedSnapshot{until: time.Now().Add(time.Minute)}
	sub := a.hub.add([]string{"1:2"})
	defer a.hub.remove(sub)
	if !a.applySettings(v) || len(a.snapCache) != 0 {
		t.Fatal("settings did not invalidate cache")
	}
	v.Revision = 1
	if a.applySettings(v) {
		t.Fatal("older settings applied")
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/settings", nil))
	var got domain.SettingsEnvelope
	if e := json.Unmarshal(w.Body.Bytes(), &got); e != nil || got.Revision != 2 || got.Values.ReportHoldSeconds != 2 {
		t.Fatal(w.Body.String(), e)
	}
	for _, method := range []string{"GET", "PUT"} {
		w = httptest.NewRecorder()
		a.Handler().ServeHTTP(w, httptest.NewRequest(method, "/api/v1/admin/settings", nil))
		if w.Code != 401 {
			t.Fatal(method, w.Code)
		}
	}
}

func TestReportCooldownChangesUseRetainedTimestamp(t *testing.T) {
	url := os.Getenv("TEST_REDIS_URL")
	if url == "" {
		t.Skip("TEST_REDIS_URL required")
	}
	options, e := redis.ParseURL(url)
	if e != nil {
		t.Fatal(e)
	}
	client := redis.NewClient(options)
	defer client.Close()
	ctx := context.Background()
	prefix := "settings-test:" + platform.ID()
	last, hour, receipt := prefix+":last", prefix+":hour", prefix+":receipt"
	defer client.Del(ctx, last, hour, receipt, receipt+"2", receipt+"3")
	now := time.Now().UnixMilli()
	n, e := rateScript.Run(ctx, client, []string{last, hour, receipt}, now-40000, "first", 30000, 30).Int()
	if e != nil || n != 1 {
		t.Fatal(n, e)
	}
	ttl, e := client.PTTL(ctx, last).Result()
	if e != nil || ttl < 59*time.Minute {
		t.Fatal("last submission must survive cooldown increases", ttl, e)
	}
	n, e = rateScript.Run(ctx, client, []string{last, hour, receipt + "2"}, now, "second", 60000, 30).Int()
	if e != nil || n != 0 {
		t.Fatal("raised cooldown ignored", n, e)
	}
	n, e = rateScript.Run(ctx, client, []string{last, hour, receipt + "3"}, now, "third", 10000, 30).Int()
	if e != nil || n != 1 {
		t.Fatal("lowered cooldown ignored", n, e)
	}
}
