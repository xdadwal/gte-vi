package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/platform"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Identity struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	CSRF  string `json:"csrf"`
}

func (a *App) initAuth(ctx context.Context) error {
	if a.Config.DevToken != "" && a.Config.Secure {
		return errors.New("development login cannot run with production cookies")
	}
	return nil
}
func (a *App) identity(r *http.Request) (Identity, bool) {
	id := token(r, "gte_admin")
	if id == "" || a.Store == nil {
		return Identity{}, false
	}
	var i Identity
	e := a.Store.DB.QueryRow(r.Context(), `SELECT a.email,a.role,s.csrf FROM admin_sessions s JOIN admins a ON a.email=s.email WHERE s.id=$1 AND s.expires_at>now() AND a.enabled`, platform.Hash(id)).Scan(&i.Email, &i.Role, &i.CSRF)
	return i, e == nil
}
func (a *App) require(w http.ResponseWriter, r *http.Request, mutation, owner bool) (Identity, bool) {
	i, ok := a.identity(r)
	if !ok {
		fail(w, 401, "admin sign-in required")
		return i, false
	}
	if owner && i.Role != "owner" {
		fail(w, 403, "owner access required")
		return i, false
	}
	if mutation && subtle.ConstantTimeCompare([]byte(i.CSRF), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
		fail(w, 403, "refresh your admin session")
		return i, false
	}
	return i, true
}
func (a *App) createAdminSession(w http.ResponseWriter, r *http.Request, email string) bool {
	id, csrf := platform.ID(), platform.ID()
	result, e := a.Store.DB.Exec(r.Context(), `INSERT INTO admin_sessions(id,email,csrf,expires_at)SELECT $1,email,$2,now()+interval '8 hours' FROM admins WHERE email=$3 AND enabled`, platform.Hash(id), csrf, email)
	if e != nil || result.RowsAffected() != 1 {
		fail(w, 503, "sign-in unavailable")
		return false
	}
	a.cookie(w, "gte_admin", id, 8*3600)
	return true
}

// The limiter is shared across replicas and fails closed when Redis is unavailable.
var passwordLimit = redis.NewScript(`
 local ip = redis.call('INCR', KEYS[1])
 if ip == 1 then redis.call('EXPIRE', KEYS[1], 900) end
 if ip > 30 then return 0 end
 local account = redis.call('INCR', KEYS[2])
 if account == 1 then redis.call('EXPIRE', KEYS[2], 900) end
 if account > 10 then return 0 end
 return 1
`)
var dummyPasswordHash []byte
var dummyPasswordOnce sync.Once

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	// Requiring an allowed Origin also prevents login CSRF; cookies alone are not a login proof.
	origin := r.Header.Get("Origin")
	if !a.allowedOrigin(origin) {
		fail(w, 403, "request origin rejected")
		return
	}
	var b struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &b) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(b.Username))
	if a.Redis == nil || a.Store == nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	allowed, err := passwordLimit.Run(r.Context(), a.Redis, []string{"login:ip:" + platform.Hash(a.clientIP(r)), "login:account:" + platform.Hash(email)}).Int()
	if err != nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	if allowed != 1 {
		w.Header().Set("Retry-After", "900")
		fail(w, 429, "too many sign-in attempts; try again in 15 minutes")
		return
	}
	if len(email) > 254 || len(b.Password) > 72 {
		fail(w, 401, "invalid username or password")
		return
	}
	select {
	case a.loginSlots <- struct{}{}:
		defer func() { <-a.loginSlots }()
	default:
		fail(w, 503, "sign-in busy; try again shortly")
		return
	}
	var hash string
	err = a.Store.DB.QueryRow(r.Context(), `SELECT password_hash FROM admins WHERE email=$1 AND enabled AND password_hash IS NOT NULL`, email).Scan(&hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 503, "sign-in unavailable")
		return
	}
	dummyPasswordOnce.Do(func() {
		dummyPasswordHash, _ = bcrypt.GenerateFromPassword([]byte(platform.ID()), platform.PasswordCost)
	})
	candidate := []byte(hash)
	if hash == "" {
		candidate = dummyPasswordHash
	}
	valid := bcrypt.CompareHashAndPassword(candidate, []byte(b.Password)) == nil
	if !valid || hash == "" {
		fail(w, 401, "invalid username or password")
		return
	}
	// Serialize against credential resets so a stale password cannot mint a new session.
	tx, err := a.Store.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var current string
	err = tx.QueryRow(r.Context(), `SELECT password_hash FROM admins WHERE email=$1 AND enabled FOR UPDATE`, email).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && current != hash) {
		fail(w, 401, "invalid username or password")
		return
	}
	if err != nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	id, csrf := platform.ID(), platform.ID()
	if _, err = tx.Exec(r.Context(), `DELETE FROM admin_sessions WHERE id=$1`, platform.Hash(token(r, "gte_admin"))); err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO admin_sessions VALUES($1,$2,$3,now()+interval '8 hours')`, platform.Hash(id), email, csrf)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	a.cookie(w, "gte_admin", id, 8*3600)
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) devLogin(w http.ResponseWriter, r *http.Request) {
	if a.Config.DevToken == "" || a.Config.Secure {
		http.NotFound(w, r)
		return
	}
	var b struct {
		Token string `json:"token"`
	}
	if !decode(w, r, &b) {
		return
	}
	if subtle.ConstantTimeCompare([]byte(b.Token), []byte(a.Config.DevToken)) != 1 {
		fail(w, 403, "invalid development token")
		return
	}
	if a.createAdminSession(w, r, a.Config.Owner) {
		write(w, 200, map[string]bool{"ok": true})
	}
}
func (a *App) me(w http.ResponseWriter, r *http.Request) {
	i, ok := a.require(w, r, false, false)
	if ok {
		write(w, 200, i)
	}
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	_, ok := a.require(w, r, true, false)
	if !ok {
		return
	}
	a.Store.DB.Exec(r.Context(), `DELETE FROM admin_sessions WHERE id=$1`, platform.Hash(token(r, "gte_admin")))
	a.cookie(w, "gte_admin", "", -1)
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) adminList(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	_, ok := a.require(w, r, false, kind == "team")
	if !ok {
		return
	}
	v, e := a.Store.AdminData(r.Context(), kind)
	if e != nil {
		fail(w, 404, "admin view unavailable")
		return
	}
	write(w, 200, map[string]any{"items": v, "serverTime": time.Now().UTC()})
}
func adminError(w http.ResponseWriter, e error) {
	if errors.Is(e, platform.ErrConflict) {
		fail(w, 409, e.Error())
	} else if errors.Is(e, platform.ErrNotFound) {
		fail(w, 404, e.Error())
	} else {
		fail(w, 400, e.Error())
	}
}
func (a *App) moderate(w http.ResponseWriter, r *http.Request) {
	i, ok := a.require(w, r, true, false)
	if !ok {
		return
	}
	var b struct {
		Episode  string `json:"episode"`
		Revision int64  `json:"revision"`
		Action   string `json:"action"`
		Report   string `json:"report"`
		Reason   string `json:"reason"`
	}
	if !decode(w, r, &b) {
		return
	}
	if e := a.Store.Moderate(r.Context(), i.Email, b.Episode, b.Revision, b.Action, b.Report, b.Reason); e != nil {
		adminError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) saveRefuge(w http.ResponseWriter, r *http.Request) {
	i, ok := a.require(w, r, true, false)
	if !ok {
		return
	}
	var b platform.Refuge
	if !decode(w, r, &b) {
		return
	}
	if e := a.Store.SaveRefuge(r.Context(), i.Email, b); e != nil {
		adminError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) team(w http.ResponseWriter, r *http.Request) {
	i, ok := a.require(w, r, true, true)
	if !ok {
		return
	}
	var b struct {
		Email   string `json:"email"`
		Role    string `json:"role"`
		Enabled bool   `json:"enabled"`
	}
	if !decode(w, r, &b) {
		return
	}
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	if e := a.Store.Team(r.Context(), i.Email, b.Email, b.Role, b.Enabled); e != nil {
		adminError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
