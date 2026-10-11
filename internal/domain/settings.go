package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
)

type Settings struct {
	ReportExpiryMinutes      int       `json:"reportExpiryMinutes"`
	ActivationReports        int       `json:"activationReports"`
	RatingWindow             int       `json:"ratingWindow"`
	BufferPerStarMeters      int       `json:"bufferPerStarMeters"`
	PendingBufferMeters      int       `json:"pendingBufferMeters"`
	ReportCooldownSeconds    int       `json:"reportCooldownSeconds"`
	SessionReportsPerHour    int       `json:"sessionReportsPerHour"`
	NetworkRequestsPerMinute int       `json:"networkRequestsPerMinute"`
	AlertRadiusMinMeters     int       `json:"alertRadiusMinMeters"`
	AlertRadiusMaxMeters     int       `json:"alertRadiusMaxMeters"`
	AlertRadiusStepMeters    int       `json:"alertRadiusStepMeters"`
	AlertRadiusDefaultMeters int       `json:"alertRadiusDefaultMeters"`
	AlertCooldownSeconds     int       `json:"alertCooldownSeconds"`
	AlertEscalationStars     float64   `json:"alertEscalationStars"`
	AlertReentrySeconds      int       `json:"alertReentrySeconds"`
	WalkingMaxMeters         int       `json:"walkingMaxMeters"`
	WalkingSpeedKmh          float64   `json:"walkingSpeedKmh"`
	OffRouteMeters           int       `json:"offRouteMeters"`
	OffRouteSeconds          int       `json:"offRouteSeconds"`
	LocationAccuracyMeters   int       `json:"locationAccuracyMeters"`
	LocationMaxAgeSeconds    int       `json:"locationMaxAgeSeconds"`
	ReportHoldSeconds        int       `json:"reportHoldSeconds"`
	PollingSeconds           int       `json:"pollingSeconds"`
	OverviewRefreshSeconds   int       `json:"overviewRefreshSeconds"`
	StaleSeconds             int       `json:"staleSeconds"`
	SseHeartbeatSeconds      int       `json:"sseHeartbeatSeconds"`
	ReconnectMinSeconds      int       `json:"reconnectMinSeconds"`
	ReconnectMaxSeconds      int       `json:"reconnectMaxSeconds"`
	AdminRefreshSeconds      int       `json:"adminRefreshSeconds"`
	SnapshotCacheMillis      int       `json:"snapshotCacheMillis"`
	MapLon                   float64   `json:"mapLon"`
	MapLat                   float64   `json:"mapLat"`
	MapZoom                  float64   `json:"mapZoom"`
	HotspotActiveOpacity     float64   `json:"hotspotActiveOpacity"`
	HotspotPendingOpacity    float64   `json:"hotspotPendingOpacity"`
	StarColors               [5]string `json:"starColors"`
}
type SettingsEnvelope struct {
	Revision int64    `json:"revision"`
	Values   Settings `json:"values"`
}

func DefaultSettings() Settings {
	return Settings{
		ReportExpiryMinutes:      30,
		ActivationReports:        5,
		RatingWindow:             50,
		BufferPerStarMeters:      100,
		PendingBufferMeters:      100,
		ReportCooldownSeconds:    30,
		SessionReportsPerHour:    30,
		NetworkRequestsPerMinute: 300,
		AlertRadiusMinMeters:     500,
		AlertRadiusMaxMeters:     3000,
		AlertRadiusStepMeters:    500,
		AlertRadiusDefaultMeters: 1000,
		AlertCooldownSeconds:     300,
		AlertEscalationStars:     1,
		AlertReentrySeconds:      60,
		WalkingMaxMeters:         3000,
		WalkingSpeedKmh:          4,
		OffRouteMeters:           50,
		OffRouteSeconds:          10,
		LocationAccuracyMeters:   100,
		LocationMaxAgeSeconds:    30,
		ReportHoldSeconds:        3,
		PollingSeconds:           10,
		OverviewRefreshSeconds:   30,
		StaleSeconds:             45,
		SseHeartbeatSeconds:      15,
		ReconnectMinSeconds:      1,
		ReconnectMaxSeconds:      30,
		AdminRefreshSeconds:      10,
		SnapshotCacheMillis:      500,
		MapLon:                   77.209,
		MapLat:                   28.6139,
		MapZoom:                  11.5,
		HotspotActiveOpacity:     0.045,
		HotspotPendingOpacity:    0.023,
		StarColors:               [5]string{"#b18a16", "#d89718", "#e16c25", "#d74435", "#a92d4c"},
	}
}
func (s Settings) Validate() error {
	if math.IsNaN(float64(s.ReportExpiryMinutes)) || math.IsInf(float64(s.ReportExpiryMinutes), 0) || s.ReportExpiryMinutes < 1 || s.ReportExpiryMinutes > 1440 {
		return fmt.Errorf("reportExpiryMinutes must be between 1 and 1440")
	}
	if math.IsNaN(float64(s.ActivationReports)) || math.IsInf(float64(s.ActivationReports), 0) || s.ActivationReports < 1 || s.ActivationReports > 100 {
		return fmt.Errorf("activationReports must be between 1 and 100")
	}
	if math.IsNaN(float64(s.RatingWindow)) || math.IsInf(float64(s.RatingWindow), 0) || s.RatingWindow < 1 || s.RatingWindow > 100 {
		return fmt.Errorf("ratingWindow must be between 1 and 100")
	}
	if math.IsNaN(float64(s.BufferPerStarMeters)) || math.IsInf(float64(s.BufferPerStarMeters), 0) || s.BufferPerStarMeters < 1 || s.BufferPerStarMeters > 500 {
		return fmt.Errorf("bufferPerStarMeters must be between 1 and 500")
	}
	if math.IsNaN(float64(s.PendingBufferMeters)) || math.IsInf(float64(s.PendingBufferMeters), 0) || s.PendingBufferMeters < 1 || s.PendingBufferMeters > 500 {
		return fmt.Errorf("pendingBufferMeters must be between 1 and 500")
	}
	if math.IsNaN(float64(s.ReportCooldownSeconds)) || math.IsInf(float64(s.ReportCooldownSeconds), 0) || s.ReportCooldownSeconds < 1 || s.ReportCooldownSeconds > 3600 {
		return fmt.Errorf("reportCooldownSeconds must be between 1 and 3600")
	}
	if math.IsNaN(float64(s.SessionReportsPerHour)) || math.IsInf(float64(s.SessionReportsPerHour), 0) || s.SessionReportsPerHour < 1 || s.SessionReportsPerHour > 1000 {
		return fmt.Errorf("sessionReportsPerHour must be between 1 and 1000")
	}
	if math.IsNaN(float64(s.NetworkRequestsPerMinute)) || math.IsInf(float64(s.NetworkRequestsPerMinute), 0) || s.NetworkRequestsPerMinute < 1 || s.NetworkRequestsPerMinute > 100000 {
		return fmt.Errorf("networkRequestsPerMinute must be between 1 and 100000")
	}
	if math.IsNaN(float64(s.AlertRadiusMinMeters)) || math.IsInf(float64(s.AlertRadiusMinMeters), 0) || s.AlertRadiusMinMeters < 100 || s.AlertRadiusMinMeters > 5000 {
		return fmt.Errorf("alertRadiusMinMeters must be between 100 and 5000")
	}
	if math.IsNaN(float64(s.AlertRadiusMaxMeters)) || math.IsInf(float64(s.AlertRadiusMaxMeters), 0) || s.AlertRadiusMaxMeters < 100 || s.AlertRadiusMaxMeters > 5000 {
		return fmt.Errorf("alertRadiusMaxMeters must be between 100 and 5000")
	}
	if math.IsNaN(float64(s.AlertRadiusStepMeters)) || math.IsInf(float64(s.AlertRadiusStepMeters), 0) || s.AlertRadiusStepMeters < 100 || s.AlertRadiusStepMeters > 5000 {
		return fmt.Errorf("alertRadiusStepMeters must be between 100 and 5000")
	}
	if math.IsNaN(float64(s.AlertRadiusDefaultMeters)) || math.IsInf(float64(s.AlertRadiusDefaultMeters), 0) || s.AlertRadiusDefaultMeters < 100 || s.AlertRadiusDefaultMeters > 5000 {
		return fmt.Errorf("alertRadiusDefaultMeters must be between 100 and 5000")
	}
	if math.IsNaN(float64(s.AlertCooldownSeconds)) || math.IsInf(float64(s.AlertCooldownSeconds), 0) || s.AlertCooldownSeconds < 1 || s.AlertCooldownSeconds > 3600 {
		return fmt.Errorf("alertCooldownSeconds must be between 1 and 3600")
	}
	if math.IsNaN(float64(s.AlertEscalationStars)) || math.IsInf(float64(s.AlertEscalationStars), 0) || s.AlertEscalationStars < 0.1 || s.AlertEscalationStars > 5 {
		return fmt.Errorf("alertEscalationStars must be between 0.1 and 5")
	}
	if math.IsNaN(float64(s.AlertReentrySeconds)) || math.IsInf(float64(s.AlertReentrySeconds), 0) || s.AlertReentrySeconds < 1 || s.AlertReentrySeconds > 3600 {
		return fmt.Errorf("alertReentrySeconds must be between 1 and 3600")
	}
	if math.IsNaN(float64(s.WalkingMaxMeters)) || math.IsInf(float64(s.WalkingMaxMeters), 0) || s.WalkingMaxMeters < 100 || s.WalkingMaxMeters > 5000 {
		return fmt.Errorf("walkingMaxMeters must be between 100 and 5000")
	}
	if math.IsNaN(float64(s.WalkingSpeedKmh)) || math.IsInf(float64(s.WalkingSpeedKmh), 0) || s.WalkingSpeedKmh < 1 || s.WalkingSpeedKmh > 10 {
		return fmt.Errorf("walkingSpeedKmh must be between 1 and 10")
	}
	if math.IsNaN(float64(s.OffRouteMeters)) || math.IsInf(float64(s.OffRouteMeters), 0) || s.OffRouteMeters < 1 || s.OffRouteMeters > 500 {
		return fmt.Errorf("offRouteMeters must be between 1 and 500")
	}
	if math.IsNaN(float64(s.OffRouteSeconds)) || math.IsInf(float64(s.OffRouteSeconds), 0) || s.OffRouteSeconds < 1 || s.OffRouteSeconds > 300 {
		return fmt.Errorf("offRouteSeconds must be between 1 and 300")
	}
	if math.IsNaN(float64(s.LocationAccuracyMeters)) || math.IsInf(float64(s.LocationAccuracyMeters), 0) || s.LocationAccuracyMeters < 1 || s.LocationAccuracyMeters > 1000 {
		return fmt.Errorf("locationAccuracyMeters must be between 1 and 1000")
	}
	if math.IsNaN(float64(s.LocationMaxAgeSeconds)) || math.IsInf(float64(s.LocationMaxAgeSeconds), 0) || s.LocationMaxAgeSeconds < 1 || s.LocationMaxAgeSeconds > 300 {
		return fmt.Errorf("locationMaxAgeSeconds must be between 1 and 300")
	}
	if math.IsNaN(float64(s.ReportHoldSeconds)) || math.IsInf(float64(s.ReportHoldSeconds), 0) || s.ReportHoldSeconds < 1 || s.ReportHoldSeconds > 10 {
		return fmt.Errorf("reportHoldSeconds must be between 1 and 10")
	}
	if math.IsNaN(float64(s.PollingSeconds)) || math.IsInf(float64(s.PollingSeconds), 0) || s.PollingSeconds < 1 || s.PollingSeconds > 120 {
		return fmt.Errorf("pollingSeconds must be between 1 and 120")
	}
	if math.IsNaN(float64(s.OverviewRefreshSeconds)) || math.IsInf(float64(s.OverviewRefreshSeconds), 0) || s.OverviewRefreshSeconds < 1 || s.OverviewRefreshSeconds > 300 {
		return fmt.Errorf("overviewRefreshSeconds must be between 1 and 300")
	}
	if math.IsNaN(float64(s.StaleSeconds)) || math.IsInf(float64(s.StaleSeconds), 0) || s.StaleSeconds < 2 || s.StaleSeconds > 600 {
		return fmt.Errorf("staleSeconds must be between 2 and 600")
	}
	if math.IsNaN(float64(s.SseHeartbeatSeconds)) || math.IsInf(float64(s.SseHeartbeatSeconds), 0) || s.SseHeartbeatSeconds < 1 || s.SseHeartbeatSeconds > 120 {
		return fmt.Errorf("sseHeartbeatSeconds must be between 1 and 120")
	}
	if math.IsNaN(float64(s.ReconnectMinSeconds)) || math.IsInf(float64(s.ReconnectMinSeconds), 0) || s.ReconnectMinSeconds < 1 || s.ReconnectMinSeconds > 60 {
		return fmt.Errorf("reconnectMinSeconds must be between 1 and 60")
	}
	if math.IsNaN(float64(s.ReconnectMaxSeconds)) || math.IsInf(float64(s.ReconnectMaxSeconds), 0) || s.ReconnectMaxSeconds < 1 || s.ReconnectMaxSeconds > 300 {
		return fmt.Errorf("reconnectMaxSeconds must be between 1 and 300")
	}
	if math.IsNaN(float64(s.AdminRefreshSeconds)) || math.IsInf(float64(s.AdminRefreshSeconds), 0) || s.AdminRefreshSeconds < 1 || s.AdminRefreshSeconds > 300 {
		return fmt.Errorf("adminRefreshSeconds must be between 1 and 300")
	}
	if math.IsNaN(float64(s.SnapshotCacheMillis)) || math.IsInf(float64(s.SnapshotCacheMillis), 0) || s.SnapshotCacheMillis < 0 || s.SnapshotCacheMillis > 10000 {
		return fmt.Errorf("snapshotCacheMillis must be between 0 and 10000")
	}
	if math.IsNaN(float64(s.MapLon)) || math.IsInf(float64(s.MapLon), 0) || s.MapLon < -180 || s.MapLon > 180 {
		return fmt.Errorf("mapLon must be between -180 and 180")
	}
	if math.IsNaN(float64(s.MapLat)) || math.IsInf(float64(s.MapLat), 0) || s.MapLat < -85 || s.MapLat > 85 {
		return fmt.Errorf("mapLat must be between -85 and 85")
	}
	if math.IsNaN(float64(s.MapZoom)) || math.IsInf(float64(s.MapZoom), 0) || s.MapZoom < 1 || s.MapZoom > 18 {
		return fmt.Errorf("mapZoom must be between 1 and 18")
	}
	if math.IsNaN(float64(s.HotspotActiveOpacity)) || math.IsInf(float64(s.HotspotActiveOpacity), 0) || s.HotspotActiveOpacity < 0 || s.HotspotActiveOpacity > 1 {
		return fmt.Errorf("hotspotActiveOpacity must be between 0 and 1")
	}
	if math.IsNaN(float64(s.HotspotPendingOpacity)) || math.IsInf(float64(s.HotspotPendingOpacity), 0) || s.HotspotPendingOpacity < 0 || s.HotspotPendingOpacity > 1 {
		return fmt.Errorf("hotspotPendingOpacity must be between 0 and 1")
	}
	if s.ActivationReports > s.RatingWindow {
		return fmt.Errorf("activationReports must not exceed ratingWindow")
	}
	if s.AlertRadiusMinMeters > s.AlertRadiusMaxMeters || s.AlertRadiusDefaultMeters < s.AlertRadiusMinMeters || s.AlertRadiusDefaultMeters > s.AlertRadiusMaxMeters || (s.AlertRadiusMaxMeters-s.AlertRadiusMinMeters)%s.AlertRadiusStepMeters != 0 || (s.AlertRadiusDefaultMeters-s.AlertRadiusMinMeters)%s.AlertRadiusStepMeters != 0 {
		return fmt.Errorf("alert radius range and default must align with step")
	}
	if s.StaleSeconds <= s.PollingSeconds || s.StaleSeconds <= s.SseHeartbeatSeconds {
		return fmt.Errorf("staleSeconds must exceed pollingSeconds and sseHeartbeatSeconds")
	}
	if s.ReconnectMinSeconds > s.ReconnectMaxSeconds {
		return fmt.Errorf("reconnectMinSeconds must not exceed reconnectMaxSeconds")
	}
	for _, c := range s.StarColors {
		if !regexp.MustCompile(`^#[0-9a-fA-F]{6}$`).MatchString(c) {
			return fmt.Errorf("starColors requires five hex colors")
		}
	}
	return nil
}

// A settings write is a complete replacement, never a patch with implicit zeroes.
func (s *Settings) UnmarshalJSON(b []byte) error {
	type plain Settings
	var keys map[string]json.RawMessage
	if e := json.Unmarshal(b, &keys); e != nil {
		return e
	}
	expectedBytes, _ := json.Marshal(DefaultSettings())
	var expected map[string]json.RawMessage
	json.Unmarshal(expectedBytes, &expected)
	if len(keys) != len(expected) {
		return fmt.Errorf("all settings fields are required")
	}
	for k := range expected {
		v, ok := keys[k]
		if !ok || string(v) == "null" {
			return fmt.Errorf("%s is required", k)
		}
	}
	var colors []string
	if e := json.Unmarshal(keys["starColors"], &colors); e != nil || len(colors) != 5 {
		return fmt.Errorf("starColors requires five colors")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	var p plain
	if e := d.Decode(&p); e != nil {
		return e
	}
	*s = Settings(p)
	return nil
}
