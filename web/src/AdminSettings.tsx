import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  DEFAULT_SETTINGS,
  useSettings,
  type RuntimeSettings,
  type SettingsEnvelope,
} from "./settings";
type NumericKey = Exclude<keyof RuntimeSettings, "starColors">;
type Field = [NumericKey, string, string, number, number, number?];
const groups: {
  title: string;
  description: string;
  fields: Field[];
  advanced?: boolean;
}[] = [
  {
    title: "Reports & reported areas",
    description:
      "Freshness and activation apply to community reports. Shorter expiry caps live reports; longer expiry applies to future reports.",
    fields: [
      [
        "reportExpiryMinutes",
        "Report expiry (minutes)",
        "Time a report remains fresh without an update.",
        1,
        1440,
      ],
      [
        "activationReports",
        "Activation reports",
        "Distinct sessions required before alerts start; cannot exceed the rating window.",
        1,
        100,
      ],
      [
        "ratingWindow",
        "Rating window (reports)",
        "Most recent fresh reports included in the rating.",
        1,
        100,
      ],
      [
        "bufferPerStarMeters",
        "Buffer per star (m)",
        "Distance added around an active area for each star.",
        1,
        500,
      ],
      [
        "pendingBufferMeters",
        "Pending buffer (m)",
        "Distance around an area awaiting activation.",
        1,
        500,
      ],
      [
        "reportHoldSeconds",
        "Report hold duration (seconds)",
        "Continuous hold required to submit a report.",
        1,
        10,
      ],
    ],
  },
  {
    title: "Nearby alerts",
    description:
      "Personal alert distances are retained when valid. Defaults apply to new visitors.",
    fields: [
      [
        "alertRadiusMinMeters",
        "Minimum alert radius (m)",
        "Smallest personal alert distance.",
        100,
        5000,
      ],
      [
        "alertRadiusMaxMeters",
        "Maximum alert radius (m)",
        "Largest personal alert distance.",
        100,
        5000,
      ],
      [
        "alertRadiusStepMeters",
        "Alert radius step (m)",
        "Spacing between selectable distances.",
        100,
        5000,
      ],
      [
        "alertRadiusDefaultMeters",
        "Default alert radius (m)",
        "Initial distance for visitors without a saved preference.",
        100,
        5000,
      ],
      [
        "alertCooldownSeconds",
        "Alert cooldown (seconds)",
        "Minimum time between alerts for the same area.",
        1,
        3600,
      ],
      [
        "alertEscalationStars",
        "Alert escalation (stars)",
        "Rating increase required to alert again while nearby.",
        0.1,
        5,
        0.1,
      ],
      [
        "alertReentrySeconds",
        "Alert reentry (seconds)",
        "Time outside the radius before a later entry can alert.",
        1,
        3600,
      ],
    ],
  },
  {
    title: "Walking & location",
    description:
      "Walking estimates use these rules. Existing routes need review when routing rules change.",
    fields: [
      [
        "walkingMaxMeters",
        "Maximum walking distance (m)",
        "Longest eligible walking route.",
        100,
        5000,
      ],
      [
        "walkingSpeedKmh",
        "Walking speed (km/h)",
        "Speed used for arrival time and refuge availability.",
        1,
        10,
        0.1,
      ],
      [
        "offRouteMeters",
        "Off-route distance (m)",
        "Deviation that starts the off-route timer.",
        1,
        500,
      ],
      [
        "offRouteSeconds",
        "Off-route delay (seconds)",
        "Continuous deviation before a route needs review.",
        1,
        300,
      ],
      [
        "locationAccuracyMeters",
        "Location accuracy (m)",
        "Largest accepted location uncertainty.",
        1,
        1000,
      ],
      [
        "locationMaxAgeSeconds",
        "Location maximum age (seconds)",
        "Oldest accepted location fix.",
        1,
        300,
      ],
    ],
  },
  {
    title: "Map appearance",
    description: "Initial map view and the five-star severity palette.",
    fields: [
      [
        "mapLon",
        "Map longitude",
        "Initial map centre longitude.",
        -180,
        180,
        0.0001,
      ],
      [
        "mapLat",
        "Map latitude",
        "Initial map centre latitude.",
        -85,
        85,
        0.0001,
      ],
      ["mapZoom", "Map zoom", "Initial map zoom level.", 1, 18, 0.1],
      [
        "hotspotActiveOpacity",
        "Active hotspot opacity",
        "Transparency of each active hotspot contour.",
        0,
        1,
        0.001,
      ],
      [
        "hotspotPendingOpacity",
        "Pending hotspot opacity",
        "Transparency of each pending hotspot contour.",
        0,
        1,
        0.001,
      ],
    ],
  },
  {
    title: "Advanced",
    description:
      "Rate limits and update timing. Stale timeout must exceed polling and heartbeat intervals.",
    advanced: true,
    fields: [
      [
        "reportCooldownSeconds",
        "Report cooldown (seconds)",
        "Minimum interval between report updates.",
        1,
        3600,
      ],
      [
        "sessionReportsPerHour",
        "Session reports per hour",
        "Report allowance for one browser session.",
        1,
        1000,
      ],
      [
        "networkRequestsPerMinute",
        "Network requests per minute",
        "Request allowance for one network address.",
        1,
        100000,
      ],
      [
        "pollingSeconds",
        "Polling interval (seconds)",
        "Fallback map and public settings refresh interval.",
        1,
        120,
      ],
      [
        "overviewRefreshSeconds",
        "Overview refresh (seconds)",
        "Refresh interval for the city overview.",
        1,
        300,
      ],
      [
        "staleSeconds",
        "Stale timeout (seconds)",
        "Silence before map data requires refresh.",
        2,
        600,
      ],
      [
        "sseHeartbeatSeconds",
        "Stream heartbeat (seconds)",
        "Server heartbeat interval for connected maps.",
        1,
        120,
      ],
      [
        "reconnectMinSeconds",
        "Minimum reconnect delay (seconds)",
        "First delay after losing the update stream.",
        1,
        60,
      ],
      [
        "reconnectMaxSeconds",
        "Maximum reconnect delay (seconds)",
        "Maximum delay between reconnection attempts.",
        1,
        300,
      ],
      [
        "adminRefreshSeconds",
        "Admin refresh (seconds)",
        "Refresh interval for operator data.",
        1,
        300,
      ],
      [
        "snapshotCacheMillis",
        "Snapshot cache (milliseconds)",
        "Lifetime of cached map snapshots.",
        0,
        10000,
      ],
    ],
  },
];
export function AdminSettings({
  owner,
  csrf,
  onDirty,
}: {
  owner: boolean;
  csrf: string;
  onDirty: (dirty: boolean) => void;
}) {
  const { settings, applySettings } = useSettings();
  const [base, setBase] = useState<SettingsEnvelope | null>(null),
    [draft, setDraft] = useState<RuntimeSettings>(DEFAULT_SETTINGS),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  const dirty =
    !!base &&
    (JSON.stringify(draft) !== JSON.stringify(base.values) || !!reason.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const baseRef = useRef(base);
  baseRef.current = base;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    const pull = () => {
      if (document.hidden) return;
      void api<SettingsEnvelope>("admin/settings")
        .then((next) => {
          if (!active) return;
          applySettings(next);
          if (
            !dirtyRef.current &&
            (!baseRef.current || next.revision > baseRef.current.revision)
          ) {
            setBase(next);
            setDraft(next.values);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    };
    pull();
    const t = setInterval(pull, settings.values.adminRefreshSeconds * 1000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      active = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [settings.values.adminRefreshSeconds, applySettings]);
  const conflict = !!base && settings.revision > base.revision;
  const discard = () => {
    const current =
      settings.revision >= (base?.revision ?? 0) ? settings : base!;
    setBase(current);
    setDraft(current.values);
    setReason("");
    setError("");
    setMessage("");
  };
  const field = ([key, label, description, min, max, step = 1]: Field) => (
    <label className="runtime-field" key={key}>
      <span>{label}</span>
      <input
        type="number"
        value={draft[key]}
        min={min}
        max={max}
        step={step}
        disabled={!owner || saving}
        required
        onChange={(e) =>
          setDraft((old) => ({
            ...old,
            [key]: e.target.value === "" ? NaN : Number(e.target.value),
          }))
        }
      />
      <small>
        {description} Range: {min}–{max}.
      </small>
    </label>
  );
  if (!base) return <p role="status">{error || "Loading settings…"}</p>;
  return (
    <form
      className="runtime-settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!owner || !dirty || !reason.trim() || conflict) return;
        setSaving(true);
        setError("");
        try {
          const next = await api<SettingsEnvelope>(
            "admin/settings",
            "PUT",
            { revision: base.revision, values: draft, reason: reason.trim() },
            csrf,
          );
          applySettings(next);
          setBase(next);
          setDraft(next.values);
          setReason("");
          setMessage("Settings saved");
        } catch (e) {
          setError((e as Error).message);
          try {
            applySettings(await api<SettingsEnvelope>("admin/settings"));
          } catch {}
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="settings-status">
        <p>
          Revision {base.revision} ·{" "}
          {owner ? "Owner access" : "Read-only operator access"}
        </p>
        <p className="small-copy">
          Changes apply without deployment. Save a reason for the activity
          history.
        </p>
      </div>
      {conflict && (
        <div className="warning" role="alert">
          A newer revision is available. Your draft is preserved. Discard
          changes to load the latest settings before editing again.
        </div>
      )}
      {groups.map((group) => {
        const contents = (
          <>
            <p className="small-copy">{group.description}</p>
            <div className="runtime-fields">{group.fields.map(field)}</div>
            {group.title === "Map appearance" && (
              <div className="runtime-palette">
                {draft.starColors.map((color, index) => (
                  <label key={index}>
                    {index + 1} star colour
                    <input
                      type="color"
                      value={color}
                      disabled={!owner || saving}
                      onChange={(e) =>
                        setDraft((old) => ({
                          ...old,
                          starColors: old.starColors.map((c, n) =>
                            n === index ? e.target.value : c,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        );
        return group.advanced ? (
          <details key={group.title} className="settings-group">
            <summary>Advanced</summary>
            {contents}
          </details>
        ) : (
          <section key={group.title} className="settings-group">
            <h2>{group.title}</h2>
            {contents}
          </section>
        );
      })}
      {owner && (
        <div className="settings-actions">
          <label>
            Change reason
            <textarea
              required
              maxLength={500}
              value={reason}
              disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are these settings changing?"
            />
          </label>
          <div className="settings-buttons">
            <button
              type="submit"
              className="primary"
              disabled={!dirty || saving || conflict || !reason.trim()}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            <button type="button" disabled={!dirty || saving} onClick={discard}>
              Discard changes
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft({
                  ...DEFAULT_SETTINGS,
                  starColors: [...DEFAULT_SETTINGS.starColors],
                });
                setMessage(
                  "Defaults loaded into the draft. Add a reason and save to apply.",
                );
              }}
            >
              Restore defaults
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
