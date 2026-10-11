package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type cachedSnapshot struct {
	body  []byte
	until time.Time
}

// Only polling uses this bounded, half-second cache. SSE must read after subscribing
// to preserve the snapshot/buffer handoff even when the cache predates subscription.
func (a *App) pollSnapshot(ctx context.Context, cells []string, overview bool) ([]byte, error) {
	sort.Strings(cells)
	key := strings.Join(cells, ",")
	a.settingsMu.RLock()
	revision := a.settings.Revision
	a.settingsMu.RUnlock()
	if revision > 0 {
		key = fmt.Sprintf("%d|", revision) + key
	}
	if overview {
		key += "|overview"
	}
	result := a.snapFlights.DoChan(key, func() (any, error) {
		a.snapMu.Lock()
		cached := a.snapCache[key]
		a.snapMu.Unlock()
		if time.Now().Before(cached.until) {
			return cached.body, nil
		}
		readCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		snapshot, err := a.Store.Snapshot(readCtx, cells, overview)
		if err != nil {
			return nil, err
		}
		body, err := json.Marshal(snapshot)
		if err != nil {
			return nil, err
		}
		if len(body) <= 256<<10 {
			a.snapMu.Lock()
			if len(a.snapCache) >= 256 {
				for k := range a.snapCache {
					delete(a.snapCache, k)
					break
				}
			}
			a.snapCache[key] = cachedSnapshot{body: body, until: time.Now().Add(time.Duration(a.currentSettings().Values.SnapshotCacheMillis) * time.Millisecond)}
			a.snapMu.Unlock()
		}
		return body, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-result:
		if r.Err != nil {
			return nil, r.Err
		}
		return r.Val.([]byte), nil
	}
}
