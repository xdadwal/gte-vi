package httpapi

import (
	"context"
	"testing"
	"time"
)

func TestPollingCacheCanonicalizesZonesAndReturnsBoundedFreshEntry(t *testing.T) {
	a := New(nil, nil, Config{})
	a.snapCache["1:2,3:4"] = cachedSnapshot{body: []byte(`{"incidents":[]}`), until: time.Now().Add(500 * time.Millisecond)}
	b, e := a.pollSnapshot(context.Background(), []string{"3:4", "1:2"}, false)
	if e != nil || string(b) != `{"incidents":[]}` {
		t.Fatalf("cached read failed %s %v", b, e)
	}
}
