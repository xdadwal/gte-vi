package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/paulmach/orb"
	"github.com/paulmach/orb/geojson"
	"github.com/paulmach/orb/planar"
	"github.com/paulmach/osm"
	"github.com/paulmach/osm/osmpbf"
	"github.com/xdadwal/gte-vi/internal/data"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

type Node struct {
	ID  string  `json:"id"`
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Lon float64 `json:"lon"`
	Lat float64 `json:"lat"`
}
type Edge struct {
	ID     string  `json:"id"`
	A      string  `json:"a"`
	B      string  `json:"b"`
	Length float64 `json:"length"`
}
type Tile struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

func footAccess(t map[string]string) bool {
	h := t["highway"]
	if h == "" || t["foot:conditional"] != "" || t["access:conditional"] != "" || t["opening_hours"] != "" {
		return false
	}
	if h == "motorway" || h == "motorway_link" || h == "construction" || h == "proposed" || h == "raceway" {
		return false
	}
	foot := t["foot"]
	if foot == "no" || foot == "private" {
		return false
	}
	if foot != "yes" && foot != "designated" && foot != "permissive" && (t["access"] == "no" || t["access"] == "private" || t["access"] == "customers") {
		return false
	}
	return true
}

// WGS84 transverse Mercator series for UTM43N. Shared grid fixtures compare against PostGIS/PROJ.
func project(lon, lat float64) (float64, float64) {
	const a = 6378137.
	const ecc = 0.0066943799901413165
	const k = .9996
	phi := lat * math.Pi / 180
	lam := (lon - 75) * math.Pi / 180
	e2 := ecc / (1 - ecc)
	s, c := math.Sin(phi), math.Cos(phi)
	T := math.Pow(math.Tan(phi), 2)
	C := e2 * c * c
	A := c * lam
	N := a / math.Sqrt(1-ecc*s*s)
	M := a * ((1-ecc/4-3*ecc*ecc/64-5*ecc*ecc*ecc/256)*phi - (3*ecc/8+3*ecc*ecc/32+45*ecc*ecc*ecc/1024)*math.Sin(2*phi) + (15*ecc*ecc/256+45*ecc*ecc*ecc/1024)*math.Sin(4*phi) - (35*ecc*ecc*ecc/3072)*math.Sin(6*phi))
	x := 500000 + k*N*(A+(1-T+C)*math.Pow(A, 3)/6+(5-18*T+T*T+72*C-58*e2)*math.Pow(A, 5)/120)
	y := k * (M + N*math.Tan(phi)*(A*A/2+(5-T+9*C+4*C*C)*math.Pow(A, 4)/24+(61-58*T+T*T+600*C-330*e2)*math.Pow(A, 6)/720))
	return x, y
}
func main() {
	source := flag.String("source", "", "OSM .pbf source")
	out := flag.String("out", "artifacts/routing", "output directory")
	flag.Parse()
	if *source == "" {
		log.Fatal("-source .osm.pbf required")
	}
	if e := build(*source, *out); e != nil {
		log.Fatal(e)
	}
}
func build(source, out string) error {
	f, e := os.Open(source)
	if e != nil {
		return e
	}
	defer f.Close()
	feat, e := geojson.UnmarshalFeature(data.Delhi)
	if e != nil {
		return e
	}
	var polys orb.MultiPolygon
	switch g := feat.Geometry.(type) {
	case orb.Polygon:
		polys = orb.MultiPolygon{g}
	case orb.MultiPolygon:
		polys = g
	default:
		return fmt.Errorf("unsupported boundary")
	}
	inside := func(lon, lat float64) bool {
		p := orb.Point{lon, lat}
		for _, poly := range polys {
			if planar.PolygonContains(poly, p) {
				return true
			}
		}
		return false
	}
	scanner := osmpbf.New(context.Background(), f, runtime.NumCPU())
	defer scanner.Close()
	scanner.SkipRelations = true
	scanner.FilterNode = func(n *osm.Node) bool { return n.Lon > 76.8 && n.Lon < 77.5 && n.Lat > 28.35 && n.Lat < 29.0 }
	scanner.FilterWay = func(w *osm.Way) bool { return footAccess(w.Tags.Map()) }
	nodes := map[osm.NodeID]Node{}
	blocked := map[osm.NodeID]bool{}
	edges := []Edge{}
	for scanner.Scan() {
		switch o := scanner.Object().(type) {
		case *osm.Node:
			tags := o.Tags.Map()
			if !inside(o.Lon, o.Lat) {
				continue
			}
			barrier := tags["barrier"]
			if tags["foot"] == "no" || tags["access"] == "no" || tags["locked"] == "yes" || (barrier != "" && barrier != "entrance" && barrier != "kerb" && barrier != "bollard" && barrier != "cycle_barrier" && tags["foot"] != "yes") {
				blocked[o.ID] = true
				continue
			}
			x, y := project(o.Lon, o.Lat)
			nodes[o.ID] = Node{ID: strconv.FormatInt(int64(o.ID), 10), X: math.Round(x*100) / 100, Y: math.Round(y*100) / 100, Lon: o.Lon, Lat: o.Lat}
		case *osm.Way:
			for i := 1; i < len(o.Nodes); i++ {
				a, ok := nodes[o.Nodes[i-1].ID]
				b, ok2 := nodes[o.Nodes[i].ID]
				if !ok || !ok2 || blocked[o.Nodes[i-1].ID] || blocked[o.Nodes[i].ID] {
					continue
				}
				length := math.Hypot(a.X-b.X, a.Y-b.Y)
				if length <= 0 || length > 3000 {
					continue
				}
				valid := true
				for step := 1; step < int(math.Ceil(length/25)); step++ {
					t := float64(step) / math.Ceil(length/25)
					if !inside(a.Lon+t*(b.Lon-a.Lon), a.Lat+t*(b.Lat-a.Lat)) {
						valid = false
						break
					}
				}
				if valid {
					edges = append(edges, Edge{ID: fmt.Sprintf("%d:%d", o.ID, i), A: a.ID, B: b.ID, Length: math.Round(length*100) / 100})
				}
			}
		}
	}
	if e = scanner.Err(); e != nil {
		return e
	}
	tiles := map[string]*Tile{}
	all := map[string]Node{}
	for _, n := range nodes {
		all[n.ID] = n
	}
	for _, edge := range edges {
		a, b := all[edge.A], all[edge.B]
		for x := int(math.Floor(math.Min(a.X, b.X) / 500)); x <= int(math.Floor(math.Max(a.X, b.X)/500)); x++ {
			for y := int(math.Floor(math.Min(a.Y, b.Y) / 500)); y <= int(math.Floor(math.Max(a.Y, b.Y)/500)); y++ {
				cell := fmt.Sprintf("%d:%d", x, y)
				if tiles[cell] == nil {
					tiles[cell] = &Tile{}
				}
				tiles[cell].Edges = append(tiles[cell].Edges, edge)
			}
		}
	}
	// Deterministic content version, independent of source path and map iteration order.
	keys := make([]string, 0, len(tiles))
	for k := range tiles {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	encoded := map[string][]byte{}
	hash := sha256.New()
	for _, k := range keys {
		t := tiles[k]
		ids := map[string]bool{}
		for _, edge := range t.Edges {
			ids[edge.A] = true
			ids[edge.B] = true
		}
		sorted := make([]string, 0, len(ids))
		for id := range ids {
			sorted = append(sorted, id)
		}
		sort.Strings(sorted)
		for _, id := range sorted {
			t.Nodes = append(t.Nodes, all[id])
		}
		sort.Slice(t.Edges, func(i, j int) bool { return t.Edges[i].ID < t.Edges[j].ID })
		b, _ := json.Marshal(t)
		encoded[k] = b
		hash.Write([]byte(k))
		hash.Write(b)
	}
	version := hex.EncodeToString(hash.Sum(nil))[:16]
	dir := filepath.Join(out, version)
	if e = os.MkdirAll(dir, 0755); e != nil {
		return e
	}
	manifestTiles := map[string]string{}
	for _, k := range keys {
		name := strings.ReplaceAll(k, ":", "_") + ".json"
		if e = os.WriteFile(filepath.Join(dir, name), encoded[k], 0644); e != nil {
			return e
		}
		manifestTiles[k] = version + "/" + name
	}
	manifest := map[string]any{"version": version, "projection": "EPSG:32643", "cellSize": 500, "tiles": manifestTiles, "source": "OpenStreetMap contributors via Geofabrik Northern Zone", "license": "ODbL 1.0", "builder": "gte-vi conservative pedestrian graph v1", "sourceDate": "see imported PBF header"}
	b, _ := json.Marshal(manifest)
	if e = os.WriteFile(filepath.Join(out, "manifest.json"), b, 0644); e != nil {
		return e
	}
	log.Printf("built %d edges in %d tiles, version%s", len(edges), len(tiles), version)
	return nil
}
