export const DEFAULT_SETTINGS = {
  reportExpiryMinutes: 30,
  activationReports: 5,
  ratingWindow: 50,
  bufferPerStarMeters: 100,
  pendingBufferMeters: 100,
  reportCooldownSeconds: 30,
  sessionReportsPerHour: 30,
  networkRequestsPerMinute: 300,
  alertRadiusMinMeters: 500,
  alertRadiusMaxMeters: 3000,
  alertRadiusStepMeters: 500,
  alertRadiusDefaultMeters: 1000,
  alertCooldownSeconds: 300,
  alertEscalationStars: 1,
  alertReentrySeconds: 60,
  walkingMaxMeters: 3000,
  walkingSpeedKmh: 4,
  offRouteMeters: 50,
  offRouteSeconds: 10,
  locationAccuracyMeters: 100,
  locationMaxAgeSeconds: 30,
  reportHoldSeconds: 3,
  pollingSeconds: 10,
  overviewRefreshSeconds: 30,
  staleSeconds: 45,
  sseHeartbeatSeconds: 15,
  reconnectMinSeconds: 1,
  reconnectMaxSeconds: 30,
  adminRefreshSeconds: 10,
  snapshotCacheMillis: 500,
  mapLon: 77.209,
  mapLat: 28.6139,
  mapZoom: 11.5,
  starColors: ["#b18a16", "#d89718", "#e16c25", "#d74435", "#a92d4c"],
  hotspotActiveOpacity: 0.045,
  hotspotPendingOpacity: 0.023,
};
export type RuntimeSettings = typeof DEFAULT_SETTINGS;
export type SettingsEnvelope = { revision: number; values: RuntimeSettings };
export const defaultEnvelope: SettingsEnvelope = {
  revision: 0,
  values: DEFAULT_SETTINGS,
};
export function newerSettings(
  current: SettingsEnvelope,
  next?: SettingsEnvelope,
): SettingsEnvelope {
  return next && next.revision > current.revision ? next : current;
}
export function pollingDelay(settings: RuntimeSettings): number {
  const jittered = settings.pollingSeconds * (0.9 + Math.random() * 0.2);
  return (
    Math.min(jittered, (settings.pollingSeconds + settings.staleSeconds) / 2) *
    1000
  );
}
export function radiusChoices(s: RuntimeSettings) {
  const result: number[] = [];
  for (
    let r = s.alertRadiusMinMeters;
    r <= s.alertRadiusMaxMeters;
    r += s.alertRadiusStepMeters
  )
    result.push(r);
  return result;
}
export function clampRadius(radius: number, s: RuntimeSettings) {
  return radiusChoices(s).reduce(
    (best, r) => (Math.abs(r - radius) < Math.abs(best - radius) ? r : best),
    s.alertRadiusMinMeters,
  );
}
