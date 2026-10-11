// loadtest measures foreground SSE or polling without generating real reports.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

func main() {
	base := flag.String("url", "http://127.0.0.1:8080", "target")
	clients := flag.Int("clients", 1000, "concurrent clients")
	duration := flag.Duration("duration", time.Minute, "steady-state duration after ramp")
	ramp := flag.Duration("ramp", time.Minute, "ramp duration")
	mode := flag.String("mode", "sse", "sse, poll, churn or write")
	cells := flag.String("cells", "1431:6334", "comma separated zones")
	allowed := flag.Bool("allow-synthetic-reports", false, "allow development-only synthetic writes")
	flag.Parse()
	if *clients < 1 || *duration < 0 || *ramp < 0 {
		panic("positive clients and nonnegative durations required")
	}
	if *mode == "write" {
		writes(*base, *clients, *duration, *ramp, *allowed)
		return
	}
	if *mode != "sse" && *mode != "poll" && *mode != "churn" {
		panic("invalid mode")
	}
	var connected, failures, events, requests atomic.Int64
	var latmu sync.Mutex
	latencies := []time.Duration{}
	transport := &http.Transport{MaxIdleConns: *clients + 100, MaxIdleConnsPerHost: *clients + 100, MaxConnsPerHost: *clients + 100}
	client := &http.Client{Transport: transport}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	start := time.Now()
	var wg sync.WaitGroup
	for i := 0; i < *clients; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if *mode == "poll" {
				connected.Add(1)
				defer connected.Add(-1)
				for ctx.Err() == nil {
					begin := time.Now()
					req, _ := http.NewRequestWithContext(ctx, "GET", *base+"/api/v1/snapshot?cells="+*cells, nil)
					r, e := client.Do(req)
					requests.Add(1)
					if e != nil {
						if ctx.Err() == nil {
							failures.Add(1)
						}
					} else {
						io.Copy(io.Discard, r.Body)
						r.Body.Close()
						if r.StatusCode != 200 {
							failures.Add(1)
						}
						latmu.Lock()
						latencies = append(latencies, time.Since(begin))
						latmu.Unlock()
					}
					select {
					case <-ctx.Done():
						return
					case <-time.After(10 * time.Second):
					}
				}
				return
			}
			begin := time.Now()
			req, _ := http.NewRequestWithContext(ctx, "GET", *base+"/api/v1/events?cells="+*cells, nil)
			r, e := client.Do(req)
			requests.Add(1)
			if e != nil {
				failures.Add(1)
				return
			}
			defer r.Body.Close()
			if r.StatusCode != 200 {
				failures.Add(1)
				return
			}
			connected.Add(1)
			defer connected.Add(-1)
			scanner := bufio.NewScanner(r.Body)
			scanner.Buffer(make([]byte, 64<<10), 10<<20)
			for scanner.Scan() {
				if len(scanner.Text()) > 6 && scanner.Text()[:6] == "event:" {
					events.Add(1)
					if *mode == "churn" {
						latmu.Lock()
						latencies = append(latencies, time.Since(begin))
						latmu.Unlock()
						return
					}
				}
			}
			if ctx.Err() == nil {
				failures.Add(1)
			}
		}()
		if *ramp > 0 {
			delay := start.Add(*ramp * time.Duration(i+1) / time.Duration(*clients)).Sub(time.Now())
			if delay > 0 {
				time.Sleep(delay)
			}
		}
	}
	if *mode == "churn" {
		go func() {
			select {
			case <-ctx.Done():
			case <-time.After(30 * time.Second):
				cancel()
			}
		}()
		wg.Wait()
	}
	ticker := time.NewTicker(10 * time.Second)
	timer := time.NewTimer(*duration)
	peak := connected.Load()
	done := false
	for !done {
		select {
		case <-ticker.C:
			n := connected.Load()
			if n > peak {
				peak = n
			}
			fmt.Fprintf(os.Stderr, "connected=%d failures=%d events=%d\n", n, failures.Load(), events.Load())
		case <-timer.C:
			done = true
		}
	}
	cancel()
	wg.Wait()
	ticker.Stop()
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	p95 := 0.
	if len(latencies) > 0 {
		p95 = float64(latencies[(len(latencies)-1)*95/100]) / float64(time.Millisecond)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"p95SnapshotMs": p95, "mode": *mode, "requestedClients": *clients, "peakConnected": peak, "failures": failures.Load(), "events": events.Load(), "requests": requests.Load(), "elapsedSeconds": time.Since(start).Seconds()})
	if failures.Load() > 0 {
		os.Exit(1)
	}
}
