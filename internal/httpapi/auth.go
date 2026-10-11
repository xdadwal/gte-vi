package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/xdadwal/gte-vi/internal/platform"
	"golang.org/x/oauth2"
	"net/http"
	"strings"
	"time"
)

type Auth struct {
	config   oauth2.Config
	verifier *oidc.IDTokenVerifier
}
type Identity struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	CSRF  string `json:"csrf"`
}

func (a *App) initAuth(ctx context.Context) error {
	if a.Config.Issuer == "" {
		if a.Config.DevToken != "" && a.Config.Secure {
			return errors.New("development login cannot run with production cookies")
		}
		return nil
	}
	p, e := oidc.NewProvider(ctx, a.Config.Issuer)
	if e != nil {
		return e
	}
	a.auth = &Auth{config: oauth2.Config{ClientID: a.Config.ClientID, ClientSecret: a.Config.ClientSecret, Endpoint: p.Endpoint(), RedirectURL: a.Config.RedirectURL, Scopes: []string{oidc.ScopeOpenID, "email"}}, verifier: p.Verifier(&oidc.Config{ClientID: a.Config.ClientID})}
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
	_, e := a.Store.DB.Exec(r.Context(), `INSERT INTO admin_sessions(id,email,csrf,expires_at)SELECT $1,email,$2,now()+interval '8 hours' FROM admins WHERE email=$3 AND enabled`, platform.Hash(id), csrf, email)
	if e != nil {
		fail(w, 503, "sign-in unavailable")
		return false
	}
	a.cookie(w, "gte_admin", id, 8*3600)
	return true
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.networkLimit(r.Context(), r) {
		fail(w, 429, "too many sign-in requests")
		return
	}
	if a.auth == nil {
		fail(w, 503, "configure operator sign-in before production deployment")
		return
	}
	state, nonce, verifier := platform.ID(), platform.ID(), oauth2.GenerateVerifier()
	_, e := a.Store.DB.Exec(r.Context(), `INSERT INTO login_flows VALUES($1,$2,$3,now()+interval '5 minutes')`, state, nonce, verifier)
	if e != nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	a.cookie(w, "gte_login", state, 300)
	http.Redirect(w, r, a.auth.config.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}
func (a *App) callback(w http.ResponseWriter, r *http.Request) {
	if a.auth == nil {
		fail(w, 503, "sign-in unavailable")
		return
	}
	state := r.URL.Query().Get("state")
	if state == "" || subtle.ConstantTimeCompare([]byte(state), []byte(token(r, "gte_login"))) != 1 {
		fail(w, 403, "invalid sign-in state")
		return
	}
	var nonce, verifier string
	e := a.Store.DB.QueryRow(r.Context(), `DELETE FROM login_flows WHERE state=$1 AND expires_at>now() RETURNING nonce,verifier`, state).Scan(&nonce, &verifier)
	a.cookie(w, "gte_login", "", -1)
	if e != nil {
		fail(w, 403, "sign-in expired")
		return
	}
	ctx, c := context.WithTimeout(r.Context(), 15*time.Second)
	defer c()
	tok, e := a.auth.config.Exchange(ctx, r.URL.Query().Get("code"), oauth2.VerifierOption(verifier))
	if e != nil {
		fail(w, 403, "sign-in exchange failed")
		return
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok {
		fail(w, 403, "identity token missing")
		return
	}
	verified, e := a.auth.verifier.Verify(ctx, raw)
	if e != nil || verified.Nonce != nonce {
		fail(w, 403, "identity verification failed")
		return
	}
	var claims struct {
		Email    string `json:"email"`
		Verified bool   `json:"email_verified"`
	}
	if verified.Claims(&claims) != nil || !claims.Verified {
		fail(w, 403, "verified email required")
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	var allowed bool
	a.Store.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM admins WHERE email=$1 AND enabled)`, email).Scan(&allowed)
	if !allowed {
		fail(w, 403, "this account has not been approved")
		return
	}
	if a.createAdminSession(w, r, email) {
		http.Redirect(w, r, "/admin", http.StatusFound)
	}
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
