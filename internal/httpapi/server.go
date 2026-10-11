package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/domain"
	"github.com/xdadwal/gte-vi/internal/platform"
	"golang.org/x/sync/singleflight"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Config struct {
	PublicOrigin, Owner, Issuer, ClientID, ClientSecret, RedirectURL, DevToken, GraphDir, WebDir string
	Secure                                                                                       bool
	Role                                                                                         string
	TrustedProxyCIDRs                                                                            []string
	DevelopmentOrigins                                                                           []string
}
type App struct {
	settingsMu  sync.RWMutex
	settings    domain.SettingsEnvelope
	Store       *platform.Store
	Redis       *redis.Client
	Config      Config
	hub         *Hub
	auth        *Auth
	connected   atomic.Bool
	workerFresh atomic.Bool
	snapMu      sync.Mutex
	snapCache   map[string]cachedSnapshot
	snapFlights singleflight.Group
}

func New(s *platform.Store, r *redis.Client, c Config) *App {
	return &App{Store: s, Redis: r, Config: c, hub: NewHub(), snapCache: map[string]cachedSnapshot{}}
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	write(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<10)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "invalid request")
		return false
	}
	if e := d.Decode(new(any)); e != io.EOF {
		fail(w, 400, "one JSON object required")
		return false
	}
	return true
}
func (a *App) cookie(w http.ResponseWriter, name, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.Config.Secure, SameSite: http.SameSiteLaxMode, MaxAge: age})
}
func token(r *http.Request, name string) string {
	c, e := r.Cookie(name)
	if e != nil {
		return ""
	}
	return c.Value
}
func parseCells(s string) ([]string, error) {
	if s == "" {
		return []string{}, nil
	}
	parts := strings.Split(s, ",")
	if len(parts) > 4096 {
		return nil, errors.New("maximum 4096 cells")
	}
	out := []string{}
	seen := map[string]bool{}
	for _, p := range parts {
		xy := strings.Split(p, ":")
		if len(xy) != 2 {
			return nil, errors.New("invalid cell")
		}
		x, e := strconv.Atoi(xy[0])
		if e != nil || x < 0 || x > 8000 {
			return nil, errors.New("invalid cell")
		}
		y, e := strconv.Atoi(xy[1])
		if e != nil || y < 0 || y > 40000 {
			return nil, errors.New("invalid cell")
		}
		canonical := fmt.Sprintf("%d:%d", x, y)
		if canonical != p {
			return nil, errors.New("invalid cell")
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out, nil
}
func (a *App) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/v1/settings", a.publicSettings)
	m.HandleFunc("GET /api/v1/admin/settings", a.adminSettings)
	m.HandleFunc("PUT /api/v1/admin/settings", a.adminSettings)
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		ctx, c := context.WithTimeout(r.Context(), 2*time.Second)
		defer c()
		if a.Store == nil || a.Store.DB.Ping(ctx) != nil || a.Redis == nil || a.Redis.Ping(ctx).Err() != nil || !a.workerFresh.Load() {
			fail(w, 503, "dependencies unavailable")
			return
		}
		write(w, 200, map[string]any{"status": "ok", "devLogin": a.Config.DevToken != ""})
	})
	m.HandleFunc("POST /api/v1/session", a.session)
	m.HandleFunc("PUT /api/v1/report", a.report)
	m.HandleFunc("GET /api/v1/snapshot", a.snapshot)
	m.HandleFunc("GET /api/v1/refuges", func(w http.ResponseWriter, r *http.Request) {
		items, e := a.Store.PublicRefuges(r.Context())
		if e != nil {
			fail(w, 503, "refuge updates unavailable")
			return
		}
		write(w, 200, map[string]any{"refuges": items})
	})
	m.HandleFunc("GET /api/v1/events", a.events)
	m.HandleFunc("GET /api/v1/routing/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "manifest.json") {
			w.Header().Set("Cache-Control", "public,max-age=60")
		} else {
			w.Header().Set("Cache-Control", "public,max-age=31536000,immutable")
		}
		if strings.Contains(r.URL.Path, "..") {
			http.NotFound(w, r)
			return
		}
		http.StripPrefix("/api/v1/routing/", http.FileServer(http.Dir(a.Config.GraphDir))).ServeHTTP(w, r)
	})
	m.HandleFunc("GET /api/v1/auth/login", a.login)
	m.HandleFunc("GET /api/v1/auth/callback", a.callback)
	m.HandleFunc("POST /api/v1/auth/dev", a.devLogin)
	m.HandleFunc("GET /api/v1/admin/me", a.me)
	m.HandleFunc("POST /api/v1/admin/logout", a.logout)
	m.HandleFunc("GET /api/v1/admin/{kind}", a.adminList)
	m.HandleFunc("POST /api/v1/admin/moderate", a.moderate)
	m.HandleFunc("PUT /api/v1/admin/refuges", a.saveRefuge)
	m.HandleFunc("PUT /api/v1/admin/team", a.team)
	m.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(a.Config.WebDir, filepath.Clean("/"+r.URL.Path))
		if st, e := os.Stat(p); e == nil && !st.IsDir() {
			http.ServeFile(w, r, p)
			return
		}
		http.ServeFile(w, r, filepath.Join(a.Config.WebDir, "index.html"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "geolocation=(self)")
		if strings.HasPrefix(r.URL.Path, "/api/v1/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			if origin != "" && origin != a.Config.PublicOrigin && (a.Config.Secure || !slices.Contains(a.Config.DevelopmentOrigins, origin)) {
				fail(w, 403, "request origin rejected")
				return
			}
		}
		defer func() {
			if e := recover(); e != nil {
				log.Printf("request panic: %v", e)
				fail(w, 500, "internal error")
			}
		}()
		m.ServeHTTP(w, r)
	})
}
func (a *App) session(w http.ResponseWriter, r *http.Request) {
	old := token(r, "gte_session")
	if old != "" {
		var csrf string
		e := a.Store.DB.QueryRow(r.Context(), `SELECT csrf FROM sessions WHERE id=$1 AND expires_at>now()`, platform.Hash(old)).Scan(&csrf)
		if e == nil {
			write(w, 200, map[string]string{"csrf": csrf})
			return
		}
	}
	if !a.networkLimit(r.Context(), r) {
		fail(w, 429, "too many requests; try again shortly")
		return
	}
	id, csrf := platform.ID(), platform.ID()
	if e := a.Store.Session(r.Context(), id, csrf); e != nil {
		fail(w, 503, "session unavailable")
		return
	}
	a.cookie(w, "gte_session", id, 30*86400)
	write(w, 200, map[string]string{"csrf": csrf})
}

var rateScript = redis.NewScript(`if redis.call('EXISTS',KEYS[3])==1 then return 1 end;local now=tonumber(ARGV[1]);local last=redis.call('GET',KEYS[1]);if last and now-tonumber(last)<tonumber(ARGV[3]) then return 0 end;redis.call('ZREMRANGEBYSCORE',KEYS[2],0,now-3600000);if redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[4]) then return 0 end;redis.call('SET',KEYS[1],now,'PX',3600000);redis.call('ZADD',KEYS[2],now,ARGV[2]);redis.call('PEXPIRE',KEYS[2],3600000);redis.call('SET',KEYS[3],1,'PX',3600000);return 1`)

func (a *App) networkLimit(ctx context.Context, r *http.Request) bool {
	return a.networkLimitWithSettings(ctx, r, a.currentSettings().Values)
}
func (a *App) networkLimitWithSettings(ctx context.Context, r *http.Request, settings domain.Settings) bool {
	if a.Redis == nil {
		return false
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	for _, cidr := range a.Config.TrustedProxyCIDRs {
		_, network, err := net.ParseCIDR(cidr)
		if err == nil && network.Contains(net.ParseIP(host)) {
			if forwarded := net.ParseIP(r.Header.Get("X-Real-IP")); forwarded != nil {
				host = forwarded.String()
			}
			break
		}
	}
	k := "flood:" + platform.Hash(host)
	n, e := a.Redis.Incr(ctx, k).Result()
	if e != nil {
		return false
	}
	if n == 1 {
		a.Redis.Expire(ctx, k, time.Minute)
	}
	limit := settings.NetworkRequestsPerMinute
	return n <= int64(limit)
}
func (a *App) report(w http.ResponseWriter, r *http.Request) {
	id := token(r, "gte_session")
	if id == "" || !a.Store.SessionValid(r.Context(), id, r.Header.Get("X-CSRF-Token")) {
		fail(w, 401, "refresh your session before reporting")
		return
	}
	var b struct {
		Lon       float64 `json:"lon"`
		Lat       float64 `json:"lat"`
		Accuracy  float64 `json:"accuracy"`
		Timestamp int64   `json:"timestamp"`
		Stars     int     `json:"stars"`
	}
	if !decode(w, r, &b) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 16 || len(key) > 128 {
		fail(w, 400, "a valid idempotency key is required")
		return
	}
	var cached []byte
	e := a.Store.DB.QueryRow(r.Context(), `SELECT response FROM receipts WHERE session_id=$1 AND key=$2 AND expires_at>now()`, platform.Hash(id), key).Scan(&cached)
	if e == nil {
		write(w, 200, json.RawMessage(cached))
		return
	}
	if b.Stars < 1 || b.Stars > 5 || math.IsNaN(b.Lon) || math.IsNaN(b.Lat) || b.Lon < -180 || b.Lon > 180 || b.Lat < -90 || b.Lat > 90 || math.IsNaN(b.Accuracy) || math.IsInf(b.Accuracy, 0) || b.Accuracy < 0 {
		fail(w, 400, "choose 1–5 stars and obtain a recent accurate location")
		return
	}
	cell, x, y, e := a.Store.Cell(r.Context(), b.Lon, b.Lat)
	if e != nil {
		if errors.Is(e, platform.ErrOutsideDelhi) {
			fail(w, 400, "Reporting is available within Delhi NCT")
		} else {
			fail(w, 503, "Location check unavailable; please retry")
		}
		return
	}
	admissionStatus := 0
	admissionMessage := ""
	reject := func(status int, message string) error {
		admissionStatus = status
		admissionMessage = message
		return errors.New(message)
	}
	res, e := a.Store.ReportWithAdmission(r.Context(), id, key, cell, x, y, b.Stars, func(settings domain.Settings) error {
		age := time.Since(time.UnixMilli(b.Timestamp))
		if b.Accuracy > float64(settings.LocationAccuracyMeters) || age > time.Duration(settings.LocationMaxAgeSeconds)*time.Second || age < -5*time.Second {
			return reject(400, "choose 1–5 stars and obtain a recent accurate location")
		}
		if !a.networkLimitWithSettings(r.Context(), r, settings) {
			return reject(429, "too many requests; try again shortly")
		}
		n, err := rateScript.Run(r.Context(), a.Redis, []string{"report-last:" + platform.Hash(id), "report-hour:" + platform.Hash(id), "report-admitted:" + platform.Hash(id) + ":" + platform.Hash(key)}, time.Now().UnixMilli(), key, settings.ReportCooldownSeconds*1000, settings.SessionReportsPerHour).Int()
		if err != nil {
			return reject(503, "reporting temporarily unavailable")
		}
		if n != 1 {
			return reject(429, fmt.Sprintf("wait %d seconds between reports; maximum %d per hour", settings.ReportCooldownSeconds, settings.SessionReportsPerHour))
		}
		return nil
	})
	if admissionStatus != 0 {
		fail(w, admissionStatus, admissionMessage)
		return
	}
	if e != nil {
		log.Printf("report write failed: %v", e)
		fail(w, 503, "report not confirmed; retry with the same request")
		return
	}
	write(w, 200, res)
}
func (a *App) snapshot(w http.ResponseWriter, r *http.Request) {
	cells, e := parseCells(r.URL.Query().Get("cells"))
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	overview := r.URL.Query().Get("overview") == "true"
	v, e := a.pollSnapshot(r.Context(), cells, overview)
	if e != nil {
		fail(w, 503, "map updates unavailable")
		return
	}
	write(w, 200, json.RawMessage(v))
}
func (a *App) Start(ctx context.Context) error {
	if e := a.refreshSettings(ctx); e != nil {
		return e
	}
	go a.monitorSettings(ctx)
	if e := a.initAuth(ctx); e != nil {
		return e
	}
	go a.monitorWorker(ctx)
	if a.Config.Role != "api" && a.Config.Role != "worker" {
		go a.receive(ctx)
	}
	if a.Config.Role == "" || a.Config.Role == "all" || a.Config.Role == "worker" {
		go a.work(ctx)
	}
	return nil
}
func (a *App) work(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if e := a.Store.Expire(ctx); e != nil {
			log.Printf("expiry failed: %v", e)
		}
		func() {
			tx, e := a.Store.DB.Begin(ctx)
			if e != nil {
				return
			}
			defer tx.Rollback(ctx)
			rows, e := tx.Query(ctx, `SELECT id,payload FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED`)
			if e != nil {
				return
			}
			type item struct {
				id int64
				p  []byte
			}
			items := []item{}
			for rows.Next() {
				var i item
				rows.Scan(&i.id, &i.p)
				items = append(items, i)
			}
			rows.Close()
			latest := map[string]item{}
			for _, i := range items {
				var event struct {
					Cell     string `json:"cell"`
					Type     string `json:"type"`
					Incident struct {
						Revision int64 `json:"revision"`
					} `json:"incident"`
				}
				if json.Unmarshal(i.p, &event) != nil {
					return
				}
				key := event.Cell
				if key == "" {
					key = event.Type
				}
				previous, ok := latest[key]
				if !ok || event.Incident.Revision == 0 {
					latest[key] = i
				} else {
					var prev struct {
						Incident struct {
							Revision int64 `json:"revision"`
						} `json:"incident"`
					}
					json.Unmarshal(previous.p, &prev)
					if event.Incident.Revision > prev.Incident.Revision {
						latest[key] = i
					}
				}
			}
			for _, i := range latest {
				if a.Redis.Publish(ctx, "gte:events", i.p).Err() != nil {
					return
				}
			}
			for _, i := range items {
				if _, e = tx.Exec(ctx, `UPDATE outbox SET published_at=now() WHERE id=$1`, i.id); e != nil {
					return
				}
			}
			if e = tx.Commit(ctx); e != nil {
				log.Printf("outbox commit: %v", e)
			}
		}()
	}
}

// Hub indexes subscribers by grid cell, avoiding a full connection scan on incident updates.
type subscriber struct {
	cells  []string
	ch     chan []byte
	closed chan struct{}
	once   sync.Once
}
type Hub struct {
	mu     sync.Mutex
	byCell map[string]map[*subscriber]bool
	all    map[*subscriber]bool
}

func NewHub() *Hub {
	return &Hub{byCell: map[string]map[*subscriber]bool{}, all: map[*subscriber]bool{}}
}
func (h *Hub) add(cells []string) *subscriber {
	s := &subscriber{cells: cells, ch: make(chan []byte, 256), closed: make(chan struct{})}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.all[s] = true
	for _, c := range cells {
		if h.byCell[c] == nil {
			h.byCell[c] = map[*subscriber]bool{}
		}
		h.byCell[c][s] = true
	}
	return s
}
func (h *Hub) remove(s *subscriber) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.all, s)
	for _, c := range s.cells {
		delete(h.byCell[c], s)
		if len(h.byCell[c]) == 0 {
			delete(h.byCell, c)
		}
	}
}
func (h *Hub) publish(b []byte) {
	var e struct {
		Cell string `json:"cell"`
	}
	if json.Unmarshal(b, &e) != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	targets := h.all
	if e.Cell != "" {
		targets = h.byCell[e.Cell]
	}
	for s := range targets {
		select {
		case s.ch <- b:
		default:
			s.once.Do(func() { close(s.closed) })
		}
	}
}
func (h *Hub) reset() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for s := range h.all {
		s.once.Do(func() { close(s.closed) })
	}
}
func (a *App) receive(ctx context.Context) {
	for ctx.Err() == nil {
		p := a.Redis.Subscribe(ctx, "gte:events")
		if _, e := p.Receive(ctx); e != nil {
			p.Close()
			a.connected.Store(false)
			a.hub.reset()
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		a.hub.reset()
		a.connected.Store(true)
		for {
			msg, e := p.Receive(ctx)
			if e != nil {
				a.connected.Store(false)
				a.hub.reset()
				p.Close()
				break
			}
			switch msg := msg.(type) {
			case *redis.Message:
				var event struct {
					Settings domain.SettingsEnvelope `json:"settings"`
				}
				if json.Unmarshal([]byte(msg.Payload), &event) == nil && event.Settings.Revision > 0 {
					a.applySettings(event.Settings)
				}
				a.hub.publish([]byte(msg.Payload))
			case *redis.Subscription:
				a.hub.reset() // Reconnect requires a fresh authoritative snapshot.
			}
		}
	}
}
func (a *App) events(w http.ResponseWriter, r *http.Request) {
	cells, e := parseCells(r.URL.Query().Get("cells"))
	if e != nil || len(cells) == 0 {
		fail(w, 400, "subscribe to 1–4096 cells")
		return
	}
	f, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "stream unsupported")
		return
	}
	sub := a.hub.add(cells)
	defer a.hub.remove(sub)
	if !a.connected.Load() {
		fail(w, 503, "live updates reconnecting")
		return
	}
	snap, e := a.Store.Snapshot(r.Context(), cells, false)
	if e != nil {
		fail(w, 503, "snapshot unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	send := func(event string, v any) bool {
		http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Second))
		b, e := json.Marshal(v)
		if e != nil {
			return false
		}
		if _, e = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b); e != nil {
			return false
		}
		f.Flush()
		return true
	}
	if !send("snapshot", snap) {
		return
	}
	t := time.NewTicker(time.Duration(a.currentSettings().Values.SseHeartbeatSeconds) * time.Second)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-sub.closed:
			return
		case b := <-sub.ch:
			t.Reset(time.Duration(a.currentSettings().Values.SseHeartbeatSeconds) * time.Second)
			if !send("update", json.RawMessage(b)) {
				return
			}
		case <-t.C:
			if !a.workerFresh.Load() {
				return
			}
			if !send("heartbeat", map[string]any{"serverTime": time.Now().UTC()}) {
				return
			}
		}
	}
}

func (a *App) monitorWorker(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		current := a.Store.WorkerCurrent(readCtx)
		cancel()
		a.workerFresh.Store(current)
		if !current {
			a.hub.reset()
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
