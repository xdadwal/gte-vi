package platform

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
)

type Refuge struct {
	ID               string          `json:"id"`
	Name             string          `json:"name"`
	Lon              float64         `json:"lon"`
	Lat              float64         `json:"lat"`
	Instructions     string          `json:"instructions"`
	Hours            json.RawMessage `json:"hours"`
	Exceptions       json.RawMessage `json:"exceptions"`
	HostContact      string          `json:"hostContact"`
	ConfirmationNote string          `json:"confirmationNote"`
	ConfirmedAt      *time.Time      `json:"confirmedAt"`
	Publication      string          `json:"publication"`
	Closed           bool            `json:"closed"`
	Revision         int64           `json:"revision"`
}

func publicRefuges(ctx context.Context, tx pgx.Tx) ([]json.RawMessage, error) {
	rows, e := tx.Query(ctx, `SELECT jsonb_build_object('id',id,'name',name,'lon',lon,'lat',lat,'instructions',instructions,'hours',hours,'exceptions',exceptions,'closed',closed,'revision',revision) FROM refuges WHERE publication='published' AND confirmed_at IS NOT NULL`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func refugeJSON(ctx context.Context, tx pgx.Tx, id string) ([]byte, error) {
	var b []byte
	e := tx.QueryRow(ctx, `SELECT jsonb_build_object('id',id,'name',name,'lon',lon,'lat',lat,'instructions',instructions,'hours',hours,'exceptions',exceptions,'hostContact',host_contact,'confirmationNote',confirmation_note,'confirmedAt',confirmed_at,'publication',publication,'closed',closed,'revision',revision) FROM refuges WHERE id=$1`, id).Scan(&b)
	return b, e
}
func validIntervals(b json.RawMessage, exceptions bool) bool {
	var m map[string][][]int
	if json.Unmarshal(b, &m) != nil || m == nil {
		return false
	}
	for k, ranges := range m {
		if exceptions {
			if _, e := time.Parse("2006-01-02", k); e != nil {
				return false
			}
		} else if len(k) != 1 || k < "0" || k > "6" {
			return false
		}
		last := -1
		for _, r := range ranges {
			if len(r) != 2 || r[0] < 0 || r[1] > 1440 || r[0] >= r[1] || r[0] < last {
				return false
			}
			last = r[1]
		}
	}
	return true
}
func (s *Store) SaveRefuge(ctx context.Context, email string, r Refuge) error {
	if strings.TrimSpace(r.Name) == "" || len(r.Name) > 200 || len(r.Instructions) > 2000 || len(r.HostContact) > 500 || len(r.ConfirmationNote) > 2000 {
		return errors.New("provide a name and keep details within field limits")
	}
	if r.Publication != "draft" && r.Publication != "published" && r.Publication != "archived" {
		return errors.New("invalid publication state")
	}
	if !validIntervals(r.Hours, false) || !validIntervals(r.Exceptions, true) {
		return errors.New("hours must be ordered minute intervals, with valid weekday/date keys")
	}
	if _, _, _, e := s.Cell(ctx, r.Lon, r.Lat); e != nil {
		return e
	}
	if r.Publication == "published" && (strings.TrimSpace(r.Instructions) == "" || strings.TrimSpace(r.HostContact) == "" || strings.TrimSpace(r.ConfirmationNote) == "" || r.ConfirmedAt == nil || r.ConfirmedAt.After(time.Now())) {
		return errors.New("publishing requires entrance instructions and dated host confirmation")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	before, e := refugeJSON(ctx, tx, r.ID)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		return e
	}
	if r.ID == "" {
		r.ID = ID()
	}
	if e == nil {
		tag, err := tx.Exec(ctx, `UPDATE refuges SET name=$2,lon=$3,lat=$4,instructions=$5,hours=$6,exceptions=$7,host_contact=$8,confirmation_note=$9,confirmed_at=$10,publication=$11,closed=$12,revision=nextval('entity_revision'),updated_at=now() WHERE id=$1 AND revision=$13`, r.ID, r.Name, r.Lon, r.Lat, r.Instructions, r.Hours, r.Exceptions, r.HostContact, r.ConfirmationNote, r.ConfirmedAt, r.Publication, r.Closed, r.Revision)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrConflict
		}
	} else {
		if r.Revision != 0 {
			return ErrConflict
		}
		_, e = tx.Exec(ctx, `INSERT INTO refuges(id,name,lon,lat,instructions,hours,exceptions,host_contact,confirmation_note,confirmed_at,publication,closed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, r.ID, r.Name, r.Lon, r.Lat, r.Instructions, r.Hours, r.Exceptions, r.HostContact, r.ConfirmationNote, r.ConfirmedAt, r.Publication, r.Closed)
		if e != nil {
			return e
		}
	}
	after, e := refugeJSON(ctx, tx, r.ID)
	if e != nil {
		return e
	}
	if e = audit(ctx, tx, email, "save-refuge", r.ID, "refuge details/availability updated", before, after); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO outbox(payload) VALUES('{"type":"refuges"}')`)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func audit(ctx context.Context, tx pgx.Tx, email, action, target, reason string, before, after []byte) error {
	_, e := tx.Exec(ctx, `INSERT INTO audit(email,action,target,reason,before_state,after_state)VALUES($1,$2,$3,$4,$5,$6)`, email, action, target, reason, before, after)
	return e
}
func (s *Store) Moderate(ctx context.Context, email, episode string, revision int64, action, reportID, reason string) error {
	if strings.TrimSpace(reason) == "" || len(reason) > 500 {
		return errors.New("a moderation reason is required (max500 characters)")
	}
	if action != "hide" && action != "remove" {
		return errors.New("invalid action")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = settingsTx(ctx, tx, "FOR SHARE"); e != nil {
		return e
	}
	var cell string
	e = tx.QueryRow(ctx, `SELECT cell FROM incidents WHERE id=$1`, episode).Scan(&cell)
	if errors.Is(e, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if e != nil {
		return e
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1))`, cell); e != nil {
		return e
	}
	var current int64
	var before []byte
	e = tx.QueryRow(ctx, `SELECT revision,incident_json(i) FROM incidents i WHERE id=$1 FOR UPDATE`, episode).Scan(&current, &before)
	if e != nil {
		return e
	}
	if current != revision {
		return ErrConflict
	}
	if action == "hide" {
		_, e = tx.Exec(ctx, `UPDATE reports SET suppressed=true WHERE episode=$1`, episode)
	} else {
		result, err := tx.Exec(ctx, `UPDATE reports SET suppressed=true WHERE id=$1 AND episode=$2 AND NOT suppressed`, reportID, episode)
		e = err
		if e == nil && result.RowsAffected() == 0 {
			return ErrNotFound
		}
	}
	if e != nil {
		return e
	}
	if e = recompute(ctx, tx, episode, time.Now().UTC()); e != nil {
		return e
	}
	var after []byte
	if e = tx.QueryRow(ctx, `SELECT incident_json(i) FROM incidents i WHERE id=$1`, episode).Scan(&after); e != nil {
		return e
	}
	if e = audit(ctx, tx, email, action, episode, reason, before, after); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func (s *Store) AdminData(ctx context.Context, kind string) ([]json.RawMessage, error) {
	q := map[string]string{
		"refuges":   `SELECT jsonb_build_object('id',id,'name',name,'lon',lon,'lat',lat,'instructions',instructions,'hours',hours,'exceptions',exceptions,'hostContact',host_contact,'confirmationNote',confirmation_note,'confirmedAt',confirmed_at,'publication',publication,'closed',closed,'revision',revision) FROM refuges ORDER BY name`,
		"activity":  `SELECT to_jsonb(a) FROM (SELECT * FROM audit ORDER BY id DESC LIMIT 500) a`,
		"team":      `SELECT jsonb_build_object('email',email,'role',role,'enabled',enabled) FROM admins ORDER BY email`,
		"incidents": `SELECT incident_json(i)||jsonb_build_object('reports',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'stars',r.stars,'updatedAt',r.updated_at,'expiresAt',r.expires_at) ORDER BY r.updated_at DESC) FROM (SELECT * FROM reports WHERE episode=i.id AND NOT suppressed AND expires_at>now() ORDER BY updated_at DESC,session_id DESC LIMIT 100) r),'[]'::jsonb)) FROM incidents i WHERE status<>'empty' ORDER BY average DESC,updated_at DESC`,
	}[kind]
	if q == "" {
		return nil, ErrNotFound
	}
	rows, e := s.DB.Query(ctx, q)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			return nil, e
		}
		out = append(out, b)
	}
	return out, rows.Err()
}
func (s *Store) Team(ctx context.Context, actor, email, role string, enabled bool) error {
	if role != "owner" && role != "admin" {
		return errors.New("invalid role")
	}
	if !strings.Contains(email, "@") || len(email) > 254 {
		return errors.New("valid email required")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(741852)`); e != nil {
		return e
	}
	var owners int
	var oldRole string
	var oldEnabled bool
	tx.QueryRow(ctx, `SELECT role,enabled FROM admins WHERE email=$1`, email).Scan(&oldRole, &oldEnabled)
	tx.QueryRow(ctx, `SELECT count(*) FROM admins WHERE role='owner' AND enabled`).Scan(&owners)
	if oldRole == "owner" && oldEnabled && (role != "owner" || !enabled) && owners <= 1 {
		return errors.New("cannot remove the last owner")
	}
	before, _ := json.Marshal(map[string]any{"email": email, "role": oldRole, "enabled": oldEnabled})
	after, _ := json.Marshal(map[string]any{"email": email, "role": role, "enabled": enabled})
	_, e = tx.Exec(ctx, `INSERT INTO admins(email,role,enabled)VALUES($1,$2,$3) ON CONFLICT(email)DO UPDATE SET role=excluded.role,enabled=excluded.enabled`, email, role, enabled)
	if e != nil {
		return e
	}
	if !enabled {
		if _, e = tx.Exec(ctx, `DELETE FROM admin_sessions WHERE email=$1`, email); e != nil {
			return e
		}
	}
	if e = audit(ctx, tx, actor, "team-access", email, "access updated", before, after); e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Refuge updates read authoritative state; polling snapshot caches must not be
// used to acknowledge a closure or withdrawal event.
func (s *Store) PublicRefuges(ctx context.Context) ([]json.RawMessage, error) {
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	items, e := publicRefuges(ctx, tx)
	if e != nil {
		return nil, e
	}
	return items, tx.Commit(ctx)
}
