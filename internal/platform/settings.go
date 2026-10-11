package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/xdadwal/gte-vi/internal/domain"
	"strings"
	"time"
)

func settingsTx(ctx context.Context, tx pgx.Tx, lock string) (domain.SettingsEnvelope, error) {
	var v domain.SettingsEnvelope
	var b []byte
	err := tx.QueryRow(ctx, `SELECT revision,values FROM runtime_settings WHERE id=1 `+lock).Scan(&v.Revision, &b)
	if err == nil {
		err = json.Unmarshal(b, &v.Values)
	}
	return v, err
}
func (s *Store) GetSettings(ctx context.Context) (domain.SettingsEnvelope, error) {
	var v domain.SettingsEnvelope
	var b []byte
	e := s.DB.QueryRow(ctx, `SELECT revision,values FROM runtime_settings WHERE id=1`).Scan(&v.Revision, &b)
	if e == nil {
		e = json.Unmarshal(b, &v.Values)
		if e == nil {
			e = v.Values.Validate()
		}
	}
	return v, e
}
func (s *Store) SaveSettings(ctx context.Context, email, reason string, expected int64, values domain.Settings) (domain.SettingsEnvelope, error) {
	var zero domain.SettingsEnvelope
	if err := values.Validate(); err != nil {
		return zero, err
	}
	reason = strings.TrimSpace(reason)
	if reason == "" || len(reason) > 1000 {
		return zero, fmt.Errorf("reason must contain 1–1000 characters")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return zero, e
	}
	defer tx.Rollback(ctx)
	old, e := settingsTx(ctx, tx, "FOR UPDATE")
	if e != nil {
		return zero, e
	}
	if expected != old.Revision {
		return zero, ErrConflict
	}
	next := domain.SettingsEnvelope{Revision: old.Revision + 1, Values: values}
	b, _ := json.Marshal(values)
	if _, e = tx.Exec(ctx, `UPDATE runtime_settings SET revision=$1,values=$2 WHERE id=1`, next.Revision, b); e != nil {
		return zero, e
	}
	now := time.Now().UTC()
	if values.ReportExpiryMinutes < old.Values.ReportExpiryMinutes {
		_, e = tx.Exec(ctx, `UPDATE reports SET expires_at=LEAST(expires_at,updated_at+$1*interval '1 minute') WHERE expires_at>$2`, values.ReportExpiryMinutes, now)
		if e != nil {
			return zero, e
		}
	}
	recalculate := values.ReportExpiryMinutes < old.Values.ReportExpiryMinutes || values.ActivationReports != old.Values.ActivationReports || values.RatingWindow != old.Values.RatingWindow || values.BufferPerStarMeters != old.Values.BufferPerStarMeters || values.PendingBufferMeters != old.Values.PendingBufferMeters
	if recalculate {
		rows, e := tx.Query(ctx, `SELECT id,cell FROM incidents ORDER BY cell`)
		if e != nil {
			return zero, e
		}
		type item struct{ id, cell string }
		items := []item{}
		for rows.Next() {
			var i item
			if e = rows.Scan(&i.id, &i.cell); e != nil {
				rows.Close()
				return zero, e
			}
			items = append(items, i)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return zero, e
		}
		for _, i := range items {
			if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1))`, i.cell); e != nil {
				return zero, e
			}
			if e = recompute(ctx, tx, i.id, now); e != nil {
				return zero, e
			}
		}
	}
	before, _ := json.Marshal(old)
	after, _ := json.Marshal(next)
	if e = audit(ctx, tx, email, "save-settings", "runtime-settings", reason, before, after); e != nil {
		return zero, e
	}
	event, _ := json.Marshal(map[string]any{"type": "settings", "settings": next})
	if _, e = tx.Exec(ctx, `INSERT INTO outbox(payload) VALUES($1)`, event); e != nil {
		return zero, e
	}
	return next, tx.Commit(ctx)
}
