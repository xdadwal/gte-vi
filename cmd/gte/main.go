package main

import (
	"context"
	"github.com/redis/go-redis/v9"
	"github.com/xdadwal/gte-vi/internal/httpapi"
	"github.com/xdadwal/gte-vi/internal/platform"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
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
	c := httpapi.Config{Role: env("APP_ROLE", "all"), PublicOrigin: env("PUBLIC_ORIGIN", "http://127.0.0.1:5173"), Owner: owner, Issuer: os.Getenv("OIDC_ISSUER"), ClientID: os.Getenv("OIDC_CLIENT_ID"), ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"), RedirectURL: os.Getenv("OIDC_REDIRECT_URL"), DevToken: os.Getenv("DEV_AUTH_TOKEN"), Secure: secure, TrustedProxyCIDRs: strings.FieldsFunc(os.Getenv("TRUSTED_PROXY_CIDRS"), func(r rune) bool { return r == ',' }), WebDir: env("WEB_DIR", "web/dist"), GraphDir: env("GRAPH_DIR", "artifacts/routing")}
	if !secure {
		c.DevelopmentOrigins = strings.FieldsFunc(env("DEV_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080"), func(r rune) bool { return r == ',' })
		for i := range c.DevelopmentOrigins {
			c.DevelopmentOrigins[i] = strings.TrimSpace(c.DevelopmentOrigins[i])
		}
	}
	if c.Role != "all" && c.Role != "api" && c.Role != "gateway" && c.Role != "worker" {
		log.Fatal("APP_ROLE must be all, api, gateway or worker")
	}
	limit, err := strconv.Atoi(env("NETWORK_RATE_PER_MINUTE", "300"))
	if err != nil || limit < 1 {
		log.Fatal("NETWORK_RATE_PER_MINUTE must be a positive integer")
	}
	c.NetworkRateLimit = limit
	for _, cidr := range c.TrustedProxyCIDRs {
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			log.Fatal("invalid TRUSTED_PROXY_CIDRS")
		}
	}
	if secure && (c.Issuer == "" || c.ClientID == "" || c.RedirectURL == "" || !strings.HasPrefix(c.PublicOrigin, "https://") || !strings.HasPrefix(c.RedirectURL, c.PublicOrigin+"/") || c.DevToken != "" || strings.HasSuffix(owner, ".test")) {
		log.Fatal("production requires HTTPS origin/callback, OIDC issuer/client, a real owner email and no development token")
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
