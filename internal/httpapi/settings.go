package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/xdadwal/gte-vi/internal/domain"
	"github.com/xdadwal/gte-vi/internal/platform"
	"net/http"
	"time"
)

func (a *App) currentSettings() domain.SettingsEnvelope {
	a.settingsMu.RLock()
	defer a.settingsMu.RUnlock()
	if a.settings.Revision == 0 {
		return domain.SettingsEnvelope{Revision: 1, Values: domain.DefaultSettings()}
	}
	return a.settings
}
func (a *App) applySettings(v domain.SettingsEnvelope) bool {
	a.settingsMu.Lock()
	if v.Revision <= a.settings.Revision {
		a.settingsMu.Unlock()
		return false
	}
	a.settings = v
	a.settingsMu.Unlock()
	a.snapMu.Lock()
	a.snapCache = map[string]cachedSnapshot{}
	a.snapMu.Unlock()
	return true
}
func (a *App) refreshSettings(ctx context.Context) error {
	v, e := a.Store.GetSettings(ctx)
	if e == nil && a.applySettings(v) {
		b, _ := json.Marshal(map[string]any{"type": "settings", "settings": v})
		a.hub.publish(b)
	}
	return e
}
func (a *App) monitorSettings(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			read, cancel := context.WithTimeout(ctx, 2*time.Second)
			a.refreshSettings(read)
			cancel()
		}
	}
}
func (a *App) publicSettings(w http.ResponseWriter, r *http.Request) {
	write(w, 200, a.currentSettings())
}
func (a *App) adminSettings(w http.ResponseWriter, r *http.Request) {
	i, ok := a.require(w, r, r.Method == "PUT", r.Method == "PUT")
	if !ok {
		return
	}
	if r.Method == "GET" {
		v, e := a.Store.GetSettings(r.Context())
		if e != nil {
			fail(w, 503, "settings unavailable")
			return
		}
		write(w, 200, map[string]any{"revision": v.Revision, "values": v.Values, "defaults": domain.DefaultSettings()})
		return
	}
	var b struct {
		Revision int64           `json:"revision"`
		Values   domain.Settings `json:"values"`
		Reason   string          `json:"reason"`
	}
	if !decode(w, r, &b) {
		return
	}
	if e := b.Values.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if b.Reason == "" || len(b.Reason) > 1000 {
		fail(w, 400, "reason required (maximum 1000 characters)")
		return
	}
	v, e := a.Store.SaveSettings(r.Context(), i.Email, b.Reason, b.Revision, b.Values)
	if errors.Is(e, platform.ErrConflict) {
		fail(w, 409, e.Error())
		return
	}
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	a.applySettings(v)
	write(w, 200, v)
}
