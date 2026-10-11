package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/xdadwal/gte-vi/internal/platform"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Synthetic writes are deliberately restricted to a development server.
func writes(base string, clients int, duration, ramp time.Duration, allowed bool) {
	client := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{MaxIdleConns: clients * 2, MaxIdleConnsPerHost: clients * 2}}
	res, err := client.Get(base + "/api/v1/health")
	if err != nil {
		panic(err)
	}
	var health struct {
		Dev bool `json:"devLogin"`
	}
	json.NewDecoder(res.Body).Decode(&health)
	res.Body.Close()
	if !allowed || !health.Dev {
		panic("write load requires -allow-synthetic-reports and a development server")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	var latencies, lag []float64
	var failures, success atomic.Int64
	start := time.Now()
	go func() {
		req, _ := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/events?cells=1431:6334", nil)
		streamClient := &http.Client{Transport: client.Transport}
		r, e := streamClient.Do(req)
		if e != nil {
			return
		}
		defer r.Body.Close()
		scanner := bufio.NewScanner(r.Body)
		scanner.Buffer(make([]byte, 64<<10), 10<<20)
		for scanner.Scan() {
			line := scanner.Bytes()
			if !bytes.HasPrefix(line, []byte("data: ")) {
				continue
			}
			var event struct {
				Incident struct {
					Updated time.Time `json:"updatedAt"`
				} `json:"incident"`
			}
			if json.Unmarshal(line[6:], &event) == nil && !event.Incident.Updated.IsZero() {
				mu.Lock()
				lag = append(lag, float64(time.Since(event.Incident.Updated))/float64(time.Millisecond))
				mu.Unlock()
			}
		}
	}()
	var wg sync.WaitGroup
	for i := 0; i < clients; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			timer := time.NewTicker(time.Second)
			defer timer.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-timer.C:
				}
				address := fmt.Sprintf("10.%d.%d.%d", 1+(index/65536)%250, (index/256)%256, index%256)
				req, _ := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/session", bytes.NewBufferString("{}"))
				req.Header.Set("X-Real-IP", address)
				r, e := client.Do(req)
				if e != nil {
					if ctx.Err() == nil {
						failures.Add(1)
					}
					continue
				}
				var session struct {
					CSRF string `json:"csrf"`
				}
				json.NewDecoder(r.Body).Decode(&session)
				cookies := r.Cookies()
				status := r.StatusCode
				r.Body.Close()
				if status != 200 {
					failures.Add(1)
					continue
				}
				payload, _ := json.Marshal(map[string]any{"lon": 77.209, "lat": 28.6139, "accuracy": 10, "timestamp": time.Now().UnixMilli(), "stars": 1 + index%5})
				req, _ = http.NewRequestWithContext(ctx, "PUT", base+"/api/v1/report", bytes.NewReader(payload))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("X-Real-IP", address)
				req.Header.Set("X-CSRF-Token", session.CSRF)
				req.Header.Set("Idempotency-Key", platform.ID())
				for _, cookie := range cookies {
					req.AddCookie(cookie)
				}
				begin := time.Now()
				r, e = client.Do(req)
				if e != nil {
					if ctx.Err() == nil {
						failures.Add(1)
					}
					continue
				}
				io.Copy(io.Discard, r.Body)
				r.Body.Close()
				if r.StatusCode != 200 {
					failures.Add(1)
					continue
				}
				success.Add(1)
				mu.Lock()
				latencies = append(latencies, float64(time.Since(begin))/float64(time.Millisecond))
				mu.Unlock()
			}
		}(i)
		if ramp > 0 {
			time.Sleep(ramp / time.Duration(clients))
		}
	}
	time.Sleep(duration)
	cancel()
	wg.Wait()
	mu.Lock()
	defer mu.Unlock()
	percentile := func(v []float64) float64 {
		if len(v) == 0 {
			return 0
		}
		sort.Float64s(v)
		return v[(len(v)-1)*95/100]
	}
	elapsed := time.Since(start).Seconds()
	json.NewEncoder(os.Stdout).Encode(map[string]any{"mode": "write", "elapsedSeconds": elapsed, "successfulWrites": success.Load(), "failures": failures.Load(), "writesPerSecond": float64(success.Load()) / elapsed, "p95WriteMs": percentile(latencies), "p95EventLagMs": percentile(lag), "observedUpdates": len(lag)})
	if failures.Load() > 0 {
		os.Exit(1)
	}
}
