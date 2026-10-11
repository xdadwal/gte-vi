package platform

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xdadwal/gte-vi/internal/data"
	"github.com/xdadwal/gte-vi/internal/domain"
	"time"
)

//go:embed schema.sql
var schema string
var ErrConflict = errors.New("record changed; refresh and review again")
var ErrOutsideDelhi = errors.New("location is outside Delhi NCT")
var ErrNotFound = errors.New("not found")

type Store struct{ DB *pgxpool.Pool }

func ID() string {
	b := make([]byte, 24)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func Hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func Open(ctx context.Context, url string) (*Store, error) {
	p, e := pgxpool.New(ctx, url)
	if e != nil {
		return nil, e
	}
	return &Store{p}, p.Ping(ctx)
}
func (s *Store) Migrate(ctx context.Context, owner string) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('gte-schema',2))`); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, schema); e != nil {
		return e
	}
	var f struct {
		Geometry json.RawMessage `json:"geometry"`
	}
	if e := json.Unmarshal(data.Delhi, &f); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO boundary VALUES('delhi',ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($1),4326))) ON CONFLICT(id) DO UPDATE SET geom=excluded.geom`, string(f.Geometry))
	if e != nil {
		return e
	}
	if owner != "" {
		_, e = tx.Exec(ctx, `INSERT INTO admins(email,role) VALUES($1,'owner') ON CONFLICT DO NOTHING`, owner)
	}
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Store) Cell(ctx context.Context, lon, lat float64) (string, int, int, error) {
	var x, y int
	var inside bool
	e := s.DB.QueryRow(ctx, `WITH p AS(SELECT ST_SetSRID(ST_Point($1,$2),4326) geom) SELECT ST_Covers(b.geom,p.geom),floor(ST_X(ST_Transform(p.geom,32643))/500)::int,floor(ST_Y(ST_Transform(p.geom,32643))/500)::int FROM p,boundary b WHERE b.id='delhi'`, lon, lat).Scan(&inside, &x, &y)
	if e != nil {
		return "", 0, 0, e
	}
	if !inside {
		return "", 0, 0, ErrOutsideDelhi
	}
	return fmt.Sprintf("%d:%d", x, y), x, y, nil
}
func (s *Store) Session(ctx context.Context, id, csrf string) error {
	_, e := s.DB.Exec(ctx, `INSERT INTO sessions VALUES($1,$2,now()+interval '30 days')`, Hash(id), csrf)
	return e
}
func (s *Store) SessionValid(ctx context.Context, id, csrf string) bool {
	var ok bool
	e := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sessions WHERE id=$1 AND csrf=$2 AND expires_at>now())`, Hash(id), csrf).Scan(&ok)
	return e == nil && ok
}
func recompute(ctx context.Context, tx pgx.Tx, episode string, now time.Time) error {
	rows, e := tx.Query(ctx, `SELECT session_id,stars,updated_at FROM reports WHERE episode=$1 AND NOT suppressed AND expires_at>$2 ORDER BY updated_at DESC,session_id DESC LIMIT 50`, episode, now)
	if e != nil {
		return e
	}
	rs := []domain.Rating{}
	for rows.Next() {
		var r domain.Rating
		if e = rows.Scan(&r.Session, &r.Stars, &r.Updated); e != nil {
			rows.Close()
			return e
		}
		rs = append(rs, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	a := domain.Aggregate(rs, now)
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM reports WHERE episode=$1 AND NOT suppressed AND expires_at>$2`, episode, now).Scan(&a.Count); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE incidents SET status=$2,count=$3,average=$4,buffer=$5,revision=nextval('entity_revision'),updated_at=$6 WHERE id=$1`, episode, a.Status, a.Count, a.Average, a.Buffer, now)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO outbox(payload) SELECT jsonb_build_object('type',CASE WHEN status='empty' THEN 'remove' ELSE 'upsert' END,'cell',cell,'incident',incident_json(i)) FROM incidents i WHERE id=$1`, episode)
	return e
}
func (s *Store) Report(ctx context.Context, session, key, cell string, x, y, stars int) (json.RawMessage, error) {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	// Session lock protects idempotency across concurrent retries in different cells.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, session); e != nil {
		return nil, e
	}
	var response []byte
	e = tx.QueryRow(ctx, `SELECT response FROM receipts WHERE session_id=$1 AND key=$2 AND expires_at>now()`, Hash(session), key).Scan(&response)
	if e == nil {
		return response, nil
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		return nil, e
	}
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1))`, cell); e != nil {
		return nil, e
	}
	var episode string
	var status string
	e = tx.QueryRow(ctx, `SELECT id,CASE WHEN EXISTS(SELECT 1 FROM reports r WHERE r.episode=incidents.id AND NOT suppressed AND expires_at>now()) THEN status ELSE 'empty' END FROM incidents WHERE cell=$1 FOR UPDATE`, cell).Scan(&episode, &status)
	if errors.Is(e, pgx.ErrNoRows) || status == "empty" {
		if episode != "" {
			if _, e = tx.Exec(ctx, `DELETE FROM incidents WHERE id=$1`, episode); e != nil {
				return nil, e
			}
		}
		episode = ID()
		_, e = tx.Exec(ctx, `INSERT INTO incidents(id,cell,x,y)VALUES($1,$2,$3,$4)`, episode, cell, x, y)
	}
	if e != nil {
		return nil, e
	}
	now := time.Now().UTC()
	_, e = tx.Exec(ctx, `INSERT INTO reports(id,episode,session_id,stars,updated_at,expires_at)VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(episode,session_id) DO UPDATE SET stars=excluded.stars,updated_at=excluded.updated_at,expires_at=excluded.expires_at,suppressed=false`, ID(), episode, Hash(session), stars, now, now.Add(30*time.Minute))
	if e != nil {
		return nil, e
	}
	if e = recompute(ctx, tx, episode, now); e != nil {
		return nil, e
	}
	e = tx.QueryRow(ctx, `SELECT incident_json(i) FROM incidents i WHERE id=$1`, episode).Scan(&response)
	if e != nil {
		return nil, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO receipts VALUES($1,$2,$3,now()+interval '1 hour') ON CONFLICT(session_id,key) DO UPDATE SET response=excluded.response,expires_at=excluded.expires_at`, Hash(session), key, response)
	if e != nil {
		return nil, e
	}
	return response, tx.Commit(ctx)
}
func (s *Store) Snapshot(ctx context.Context, cells []string, overview bool) (map[string]any, error) {
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	var current bool
	if e = tx.QueryRow(ctx, `SELECT COALESCE((SELECT checked_at>now()-interval '3 seconds' FROM runtime_state WHERE name='expiry'),false)`).Scan(&current); e != nil {
		return nil, e
	}
	if !current {
		return nil, errors.New("report expiry worker is not current")
	}
	rows, e := tx.Query(ctx, `SELECT incident_json(i) FROM incidents i WHERE status<>'empty' AND cell=ANY($1) ORDER BY cell`, cells)
	if e != nil {
		return nil, e
	}
	inc := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			rows.Close()
			return nil, e
		}
		inc = append(inc, b)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	revisions := map[string]int64{}
	rows, e = tx.Query(ctx, `SELECT cell,revision FROM incidents WHERE cell=ANY($1)`, cells)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var cell string
		var rev int64
		if e = rows.Scan(&cell, &rev); e != nil {
			rows.Close()
			return nil, e
		}
		revisions[cell] = rev
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	refuges, e := publicRefuges(ctx, tx)
	if e != nil {
		return nil, e
	}
	overviewItems := []json.RawMessage{}
	if overview {
		rows, e = tx.Query(ctx, `SELECT json_build_object('lon',ST_X(p),'lat',ST_Y(p),'count',n) FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint((floor(x/4.0)+0.5)*2000,(floor(y/4.0)+0.5)*2000),32643),4326) p,count(*) n FROM incidents WHERE status<>'empty' GROUP BY floor(x/4.0),floor(y/4.0)) clusters`)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var b []byte
			if e = rows.Scan(&b); e != nil {
				rows.Close()
				return nil, e
			}
			overviewItems = append(overviewItems, b)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	return map[string]any{"incidents": inc, "refuges": refuges, "overview": overviewItems, "revisions": revisions, "serverTime": time.Now().UTC()}, tx.Commit(ctx)
}
func (s *Store) Expire(ctx context.Context) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, `SELECT DISTINCT i.cell FROM incidents i JOIN reports r ON r.episode=i.id WHERE i.status<>'empty' AND NOT r.suppressed AND r.expires_at<=now() AND r.expires_at>i.updated_at ORDER BY i.cell`)
	if e != nil {
		return e
	}
	cells := []string{}
	for rows.Next() {
		var c string
		rows.Scan(&c)
		cells = append(cells, c)
	}
	rows.Close()
	for _, c := range cells {
		if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1))`, c); e != nil {
			return e
		}
		var id string
		e = tx.QueryRow(ctx, `SELECT id FROM incidents WHERE cell=$1`, c).Scan(&id)
		if e == nil {
			e = recompute(ctx, tx, id, time.Now().UTC())
		}
		if e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, `DELETE FROM reports WHERE expires_at<now()-interval '1 hour'; DELETE FROM receipts WHERE expires_at<now(); DELETE FROM outbox WHERE published_at<now()-interval '1 hour'; DELETE FROM admin_sessions WHERE expires_at<now(); DELETE FROM login_flows WHERE expires_at<now(); DELETE FROM sessions s WHERE expires_at<now() AND NOT EXISTS(SELECT 1 FROM reports r WHERE r.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM receipts r WHERE r.session_id=s.id); INSERT INTO runtime_state(name,checked_at) VALUES('expiry',now()) ON CONFLICT(name) DO UPDATE SET checked_at=excluded.checked_at`)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

func (s *Store) WorkerCurrent(ctx context.Context) bool {
	var current bool
	err := s.DB.QueryRow(ctx, `SELECT COALESCE((SELECT checked_at>now()-interval '3 seconds' FROM runtime_state WHERE name='expiry'),false)`).Scan(&current)
	return err == nil && current
}
