package httpapi

import (
	"fmt"
	"net/url"
	"slices"
	"strings"
)

// ValidateOrigins rejects permissive patterns and URL components that cannot
// appear in an Origin header. Production origins must use HTTPS.
func (c Config) ValidateOrigins() error {
	for _, origin := range append([]string{c.PublicOrigin}, c.AllowedOrigins...) {
		u, err := url.Parse(origin)
		if err != nil || u.Hostname() == "" || strings.Contains(origin, "*") || u.User != nil ||
			(u.Scheme != "https" && (c.Secure || u.Scheme != "http")) || origin != u.Scheme+"://"+u.Host {
			return fmt.Errorf("PUBLIC_ORIGIN and ALLOWED_ORIGINS must contain exact HTTP origins (HTTPS in production): %q", origin)
		}
	}
	return nil
}

func (a *App) allowedOrigin(origin string) bool {
	return origin != "" && (origin == a.Config.PublicOrigin || slices.Contains(a.Config.AllowedOrigins, origin) ||
		(!a.Config.Secure && slices.Contains(a.Config.DevelopmentOrigins, origin)))
}
