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
	if len(os.Args) > 1 {
		if err := credentials(ctx, s, os.Args[1:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	opts, e := redis.ParseURL(env("REDIS_URL", "redis://127.0.0.1:56379"))
	if e != nil {
		log.Fatal(e)
	}
	r := redis.NewClient(opts)
	defer r.Close()
	secure := env("APP_ENV", "production") != "development"
	c := httpapi.Config{Role: env("APP_ROLE", "all"), PublicOrigin: env("PUBLIC_ORIGIN", "http://127.0.0.1:5173"), Owner: owner, DevToken: os.Getenv("DEV_AUTH_TOKEN"), Secure: secure, TrustedProxyCIDRs: strings.FieldsFunc(os.Getenv("TRUSTED_PROXY_CIDRS"), func(r rune) bool { return r == ',' }), WebDir: env("WEB_DIR", "web/dist"), GraphDir: env("GRAPH_DIR", "artifacts/routing")}
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, origin)
		}
	}
	if err := c.ValidateOrigins(); err != nil {
		log.Fatal(err)
	}
	if !secure {
		c.DevelopmentOrigins = strings.FieldsFunc(env("DEV_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080"), func(r rune) bool { return r == ',' })
		for i := range c.DevelopmentOrigins {
			c.DevelopmentOrigins[i] = strings.TrimSpace(c.DevelopmentOrigins[i])
		}
	}
	if c.Role != "all" && c.Role != "api" && c.Role != "gateway" && c.Role != "worker" {
		log.Fatal("APP_ROLE must be all, api, gateway or worker")
	}
	if os.Getenv("NETWORK_RATE_PER_MINUTE") != "" {
		log.Print("NETWORK_RATE_PER_MINUTE is deprecated; use owner runtime settings")
	}
	for _, cidr := range c.TrustedProxyCIDRs {
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			log.Fatal("invalid TRUSTED_PROXY_CIDRS")
		}
	}
	if secure && (!strings.HasPrefix(c.PublicOrigin, "https://") || c.DevToken != "" || strings.HasSuffix(owner, ".test")) {
		log.Fatal("production requires an HTTPS origin, a real owner email and no development token")
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
