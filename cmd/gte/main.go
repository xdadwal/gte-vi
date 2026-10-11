package main

import (
	"context"
	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/httpapi"
	"github.com/xdadwal/gte-vi/internal/platform"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func env(k, d string) string {
	if s := os.Getenv(k); s != "" {
		return s
	}
	return d
}
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	s, e := platform.Open(ctx, env("DATABASE_URL", "postgres://gte:local-only@127.0.0.1:55432/gte"))
	if e != nil {
		log.Fatal(e)
	}
	defer s.DB.Close()
	owner := strings.ToLower(env("OWNER_EMAIL", "owner@example.test"))
	if e = s.Migrate(ctx, owner); e != nil {
		log.Fatal(e)
	}
	opts, e := redis.ParseURL(env("REDIS_URL", "redis://127.0.0.1:56379"))
	if e != nil {
		log.Fatal(e)
	}
	r := redis.NewClient(opts)
	defer r.Close()
	secure := env("APP_ENV", "production") != "development"
	c := httpapi.Config{PublicOrigin: env("PUBLIC_ORIGIN", "http://127.0.0.1:5173"), Owner: owner, Issuer: os.Getenv("OIDC_ISSUER"), ClientID: os.Getenv("OIDC_CLIENT_ID"), ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"), RedirectURL: os.Getenv("OIDC_REDIRECT_URL"), DevToken: os.Getenv("DEV_AUTH_TOKEN"), Secure: secure, WebDir: env("WEB_DIR", "web/dist"), GraphDir: env("GRAPH_DIR", "artifacts/routing")}
	if secure && (c.Issuer == "" || strings.HasSuffix(owner, ".test")) {
		log.Fatal("production requires OIDC_ISSUER and a real OWNER_EMAIL")
	}
	a := httpapi.New(s, r, c)
	if e = a.Start(ctx); e != nil {
		log.Fatal(e)
	}
	srv := &http.Server{Addr: env("LISTEN_ADDR", "127.0.0.1:8080"), Handler: a.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 75 * time.Second}
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(c)
	}()
	log.Printf("listening on %s", srv.Addr)
	if e = srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
