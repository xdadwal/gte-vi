import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  MapTrifoldIcon,
  HouseIcon,
  ClockCounterClockwiseIcon,
  UsersIcon,
  SignOutIcon,
  PlusIcon,
  ArrowLeftIcon,
  XIcon,
} from "@phosphor-icons/react";
import { api } from "./api";
import { randomId } from "./id";
import { MapView } from "./MapView";
import { refugeEligible, isOpen, type Incident, type Refuge } from "./model";
type Identity = { email: string; role: "owner" | "admin"; csrf: string };
type Contribution = {
  id: string;
  stars: number;
  updatedAt: string;
  expiresAt: string;
};
type AdminIncident = Incident & { reports: Contribution[] };
type AdminRefuge = Refuge & {
  hostContact: string;
  confirmationNote: string;
  confirmedAt: string | null;
  publication: "draft" | "published" | "archived";
};
type TeamMember = { email: string; role: string; enabled: boolean };
type Audit = {
  id: number;
  email: string;
  action: string;
  target: string;
  reason: string;
  before_state: unknown;
  after_state: unknown;
  created_at: string;
};
type View = "incidents" | "refuges" | "activity" | "team";
const emptyRefuge = (): AdminRefuge => ({
  id: randomId(),
  name: "",
  lon: 77.209,
  lat: 28.6139,
  instructions: "",
  hours: {},
  exceptions: {},
  closed: false,
  revision: 0,
  hostContact: "",
  confirmationNote: "",
  confirmedAt: null,
  publication: "draft",
});
export function Admin() {
  const [me, setMe] = useState<Identity | null>(null),
    [checking, setChecking] = useState(true),
    [dev, setDev] = useState(false),
    [devToken, setDevToken] = useState(""),
    [view, setView] = useState<View>(
      ["incidents", "refuges", "activity", "team"].includes(
        new URLSearchParams(location.search).get("view") || "",
      )
        ? (new URLSearchParams(location.search).get("view") as View)
        : "incidents",
    ),
    [items, setItems] = useState<unknown[]>([]),
    [incidents, setIncidents] = useState<AdminIncident[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [fresh, setFresh] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("active"),
    [selection, setSelection] = useState<string | null>(
      new URLSearchParams(location.search).get("target"),
    ),
    [editor, setEditor] = useState<AdminRefuge | null>(null),
    [dirty, setDirty] = useState(false),
    [mapTab, setMapTab] = useState(false);
  const requestGeneration = useRef(0),
    deepLinkOpened = useRef(false);
  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    try {
      const [data, inc] = await Promise.all([
        api<{ items: unknown[] }>(`admin/${view}`),
        api<{ items: AdminIncident[] }>("admin/incidents"),
      ]);
      if (generation !== requestGeneration.current) return;
      setItems(data.items);
      setIncidents(inc.items);
      const target = new URLSearchParams(location.search).get("target");
      if (view === "refuges" && target && !deepLinkOpened.current) {
        deepLinkOpened.current = true;
        const found = (data.items as AdminRefuge[]).find(
          (r) => r.id === target,
        );
        if (found) setEditor(found);
      }
      setFresh(true);
    } catch (e) {
      if (generation !== requestGeneration.current) return;
      setFresh(false);
      setError((e as Error).message);
    }
  }, [view]);
  useEffect(() => {
    api<Identity>("admin/me")
      .then(setMe)
      .catch(() => {})
      .finally(() => setChecking(false));
    api<{ devLogin: boolean }>("health")
      .then((h) => setDev(h.devLogin))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!me) return;
    let active = true;
    const pull = () => {
      if (active && !document.hidden) void refresh();
    };
    pull();
    const t = setInterval(pull, 10000),
      visibility = () => {
        setFresh(false);
        if (!document.hidden) pull();
      };
    document.addEventListener("visibilitychange", visibility);
    const offline = () => setFresh(false);
    window.addEventListener("offline", offline);
    return () => {
      active = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", offline);
    };
  }, [me, refresh]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const navigate = (v: View) => {
    if (dirty && !confirm("Discard unsaved refuge changes?")) return;
    ++requestGeneration.current;
    setView(v);
    setItems([]);
    setSelection(null);
    setEditor(null);
    setDirty(false);
    setQuery("");
    setError("");
    setMessage("");
    setFresh(false);
  };
  if (checking)
    return (
      <main className="admin-signin">
        <p>Checking operator session…</p>
      </main>
    );
  if (!me)
    return (
      <main className="admin-signin">
        <a className="brand" href="/">
          <span>
            GRAND THEFT
            <br />
            ELECTION
          </span>
          <b>VI</b>
        </a>
        <div>
          <p className="eyebrow">OPERATOR CONSOLE</p>
          <h1>
            Keep the map
            <br />
            current.
          </h1>
          <p>Manage community reports and verified refuges.</p>
          <a className="primary" href="/api/v1/auth/login">
            Sign in with your approved account
          </a>
          {dev && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                try {
                  await api("auth/dev", "POST", { token: devToken });
                  setMe(await api<Identity>("admin/me"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <label>
                Local development token
                <input
                  type="password"
                  value={devToken}
                  onChange={(e) => setDevToken(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button type="submit" className="secondary">
                Local sign-in
              </button>
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <a className="text-button" href="/">
            Back to public map
          </a>
        </div>
      </main>
    );
  const selectedIncident = incidents.find((i) => i.id === selection);
  const title = {
    incidents: "Live incidents",
    refuges: "Refuges",
    activity: "Activity history",
    team: "Team access",
  }[view];
  const listIncidents = incidents.filter(
    (i) =>
      (filter === "all" || i.status === filter) &&
      (!query || i.cell.includes(query)),
  );
  const refuges = view === "refuges" ? (items as AdminRefuge[]) : [];
  return (
    <div className="admin-app">
      <a href="#admin-main" className="skip-link">
        Skip to content
      </a>
      <aside className="admin-nav">
        <a className="brand" href="/">
          <span>
            GRAND THEFT
            <br />
            ELECTION
          </span>
          <b>VI</b>
        </a>
        <span className="eyebrow">OPERATOR CONSOLE</span>
        <nav>
          {(
            [
              ["incidents", "Live incidents", MapTrifoldIcon],
              ["refuges", "Refuges", HouseIcon],
              ["activity", "Activity", ClockCounterClockwiseIcon],
              ...(me.role === "owner"
                ? [["team", "Team access", UsersIcon]]
                : []),
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id as string}
              className={view === id ? "current" : ""}
              onClick={() => navigate(id as View)}
            >
              <Icon size={22} />
              {label as string}
            </button>
          ))}
        </nav>
        <footer className="operator-account">
          <small>{me.email}</small>
          <button
            onClick={async () => {
              if (dirty && !confirm("Discard unsaved changes and sign out?"))
                return;
              await api("admin/logout", "POST", {}, me.csrf);
              setMe(null);
            }}
          >
            <SignOutIcon size={20} />
            Sign out
          </button>
        </footer>
      </aside>
      <main id="admin-main" className="admin-main">
        <header className="admin-header">
          <div>
            <p className="eyebrow">DELHI NCT</p>
            <h1>{title}</h1>
          </div>
          <span className={`live-state ${fresh ? "healthy" : ""}`}>
            <i />
            {fresh ? "Current" : "Refresh required"}
          </span>
        </header>
        <div className="admin-notices">
          {error && (
            <p className="error" role="alert">
              {error}
              <button className="text-button" onClick={() => void refresh()}>
                Refresh
              </button>
            </p>
          )}
          {message && (
            <p className="success" role="status">
              {message}
            </p>
          )}
        </div>
        {(view === "incidents" || view === "refuges") && (
          <div className="admin-toolbar">
            <label className="search-label">
              {view === "incidents" ? "Find cell" : "Find refuge"}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  view === "incidents"
                    ? "Cell coordinates"
                    : "Name or access instructions"
                }
              />
            </label>
            {view === "incidents" ? (
              <label>
                Status
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                  <option value="all">All fresh incidents</option>
                </select>
              </label>
            ) : (
              <button
                className="primary"
                disabled={!fresh}
                onClick={() => {
                  if (dirty && !confirm("Discard unsaved changes?")) return;
                  setEditor(emptyRefuge());
                  setDirty(false);
                  setSelection(null);
                }}
              >
                <PlusIcon size={20} />
                Add refuge
              </button>
            )}
            <div className="mobile-view-tabs">
              <button
                className={!mapTab ? "current" : ""}
                onClick={() => setMapTab(false)}
              >
                List
              </button>
              <button
                className={mapTab ? "current" : ""}
                onClick={() => setMapTab(true)}
              >
                Map
              </button>
            </div>
          </div>
        )}
        {view === "incidents" && (
          <div className={`admin-workspace ${mapTab ? "show-map" : ""}`}>
            <section className="admin-list" aria-label="Incidents">
              {listIncidents.length ? (
                listIncidents.map((i) => (
                  <button
                    key={i.id}
                    className={`incident-row ${selection === i.id ? "current" : ""}`}
                    onClick={() => setSelection(i.id)}
                  >
                    <span>
                      <strong>{i.cell}</strong>
                      <small>
                        {i.count} fresh reports · {i.status}
                      </small>
                    </span>
                    <b>
                      {i.status === "active"
                        ? i.average.toFixed(1) + " ★"
                        : "Pending"}
                    </b>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  <MapTrifoldIcon size={32} />
                  <h2>No {filter === "all" ? "fresh" : filter} incidents</h2>
                  <p>Fresh submissions appear here automatically.</p>
                </div>
              )}
            </section>
            <div className="admin-map">
              <MapView
                incidents={incidents}
                refuges={[]}
                selected={selectedIncident}
                onSelect={(is) => setSelection(is[0]?.id || null)}
              />
            </div>
            {selectedIncident && (
              <IncidentEditor
                key={selectedIncident.id}
                incident={selectedIncident}
                fresh={fresh}
                csrf={me.csrf}
                onDone={async (msg) => {
                  setMessage(msg);
                  setError("");
                  await refresh();
                }}
                onError={setError}
              />
            )}
          </div>
        )}
        {view === "refuges" && (
          <div
            className={`admin-workspace refuge-workspace ${mapTab ? "show-map" : ""}`}
          >
            <section className="admin-list">
              {refuges
                .filter((r) =>
                  [r.name, r.instructions]
                    .join(" ")
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((r) => (
                  <button
                    key={r.id}
                    className={`refuge-row ${editor?.id === r.id ? "current" : ""}`}
                    onClick={() => {
                      if (dirty && !confirm("Discard unsaved changes?")) return;
                      setEditor(r);
                      setDirty(false);
                    }}
                  >
                    <HouseIcon size={23} />
                    <span>
                      <strong>{r.name}</strong>
                      <small>{availability(r, incidents)}</small>
                    </span>
                    <small>{r.publication}</small>
                  </button>
                ))}
              {!refuges.length && (
                <div className="empty-state">
                  <HouseIcon size={32} />
                  <h2>No refuges yet</h2>
                  <p>Add a draft, confirm host access, then publish it.</p>
                </div>
              )}
            </section>
            <div className="admin-map">
              <MapView
                incidents={incidents}
                refuges={refuges}
                entrance={editor ? [editor.lon, editor.lat] : null}
                onEntrance={(p) => {
                  if (editor) {
                    setEditor({ ...editor, lon: p[0], lat: p[1] });
                    setDirty(true);
                  }
                }}
                onRefuge={(r) => {
                  if (!dirty || confirm("Discard unsaved changes?")) {
                    setEditor(refuges.find((x) => x.id === r.id)!);
                    setDirty(false);
                  }
                }}
              />
            </div>
            {editor && (
              <RefugeEditor
                key={editor.id}
                value={editor}
                fresh={fresh}
                dirty={dirty}
                onChange={(r) => {
                  setEditor(r);
                  setDirty(true);
                }}
                onCancel={() => {
                  if (!dirty || confirm("Discard unsaved changes?")) {
                    setEditor(null);
                    setDirty(false);
                  }
                }}
                onSave={async (r) => {
                  await api("admin/refuges", "PUT", r, me.csrf);
                  setMessage("Refuge saved");
                  setEditor(null);
                  setDirty(false);
                  await refresh();
                }}
                onError={setError}
              />
            )}
          </div>
        )}
        {view === "activity" && <Activity items={items as Audit[]} />}
        {view === "team" && (
          <Team
            members={items as TeamMember[]}
            fresh={fresh}
            csrf={me.csrf}
            onDone={refresh}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}
function availability(r: AdminRefuge, inc: Incident[]) {
  const reasons = [];
  if (r.publication !== "published")
    reasons.push(r.publication === "draft" ? "Draft" : "Archived");
  if (r.closed) reasons.push("Manually closed");
  if (!isOpen({ ...r, closed: false }, Date.now()))
    reasons.push("Outside opening hours");
  if (
    !refugeEligible(
      {
        ...r,
        closed: false,
        hours: Object.fromEntries(
          [...Array(7)].map((_, d) => [d, [[0, 1440]]]),
        ),
        exceptions: {},
      },
      inc,
      Date.now(),
    )
  )
    reasons.push("Affected by hotzone");
  return reasons.join(" · ") || "Available";
}
function IncidentEditor({
  incident: i,
  fresh,
  csrf,
  onDone,
  onError,
}: {
  incident: AdminIncident;
  fresh: boolean;
  csrf: string;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [action, setAction] = useState<{
      type: "hide" | "remove";
      report?: string;
      revision: number;
    } | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const preview = useMemo(() => {
    if (!action) return null;
    const rs =
      action.type === "hide"
        ? []
        : i.reports.filter((r) => r.id !== action.report);
    const latest = rs.slice(0, 50);
    return {
      count: action.type === "hide" ? 0 : i.count - 1,
      status:
        action.type === "hide" || i.count === 1
          ? "removed"
          : i.count - 1 >= 5
            ? "active"
            : "pending",
      average:
        rs.length >= 5
          ? latest.reduce((a, r) => a + r.stars, 0) / latest.length
          : 0,
    };
  }, [i, action]);
  return (
    <section className="admin-detail">
      <p className="eyebrow">SELECTED CELL</p>
      <h2>
        {i.cell}{" "}
        <span>
          {i.status === "active" ? i.average.toFixed(1) + " ★" : "Pending"}
        </span>
      </h2>
      <p>
        {i.count} fresh reporting sessions · Updated{" "}
        {new Date(i.updatedAt).toLocaleTimeString()}
      </p>
      <button
        className="danger-outline"
        disabled={!fresh || busy}
        onClick={() => {
          setAction({ type: "hide", revision: i.revision });
          setReason("");
        }}
      >
        Hide incident
      </button>
      <h3>
        Fresh contributions {i.count > 100 ? `(latest 100 of ${i.count})` : ""}
      </h3>
      <div className="contributions">
        {i.reports.map((r, n) => (
          <div key={r.id}>
            <span>
              Report {n + 1} · {r.stars} ★
              <small>
                Expires {new Date(r.expiresAt).toLocaleTimeString()}
              </small>
            </span>
            <button
              className="text-button"
              disabled={!fresh || busy}
              onClick={() => {
                setAction({
                  type: "remove",
                  report: r.id,
                  revision: i.revision,
                });
                setReason("");
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {action && preview && (
        <form
          className="moderation-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api(
                "admin/moderate",
                "POST",
                {
                  episode: i.id,
                  revision: action.revision,
                  action: action.type,
                  report: action.report || "",
                  reason,
                },
                csrf,
              );
              setAction(null);
              onDone(
                action.type === "hide"
                  ? "Incident hidden; fresh reporting remains open"
                  : "Contribution removed",
              );
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>
            {action.type === "hide"
              ? "Hide this incident"
              : "Remove contribution"}
          </h3>
          <p>
            {preview.count} reports remain · {preview.status}
            {preview.average ? " · " + preview.average.toFixed(1) + " ★" : ""}
          </p>
          {action.type === "hide" && (
            <p className="small-copy">
              Existing contributions disappear. New submissions can create a
              fresh pending incident.
            </p>
          )}
          {action.revision !== i.revision && (
            <p className="warning">
              This incident changed. Reselect the action to review current
              values.
            </p>
          )}
          <label>
            Reason
            <textarea
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="danger"
              disabled={
                busy ||
                !fresh ||
                action.revision !== i.revision ||
                !reason.trim()
              }
            >
              {busy ? "Applying…" : "Confirm " + action.type}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setAction(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
function delhiDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function toTime(m: number) {
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function minutes(s: string, end = false) {
  const [h, m] = s.split(":").map(Number);
  return end && h === 0 && m === 0 ? 1440 : h * 60 + m;
}
function Hours({
  value,
  onChange,
  exceptions = false,
}: {
  value: Record<string, [number, number][]>;
  onChange: (v: Record<string, [number, number][]>) => void;
  exceptions?: boolean;
}) {
  const [date, setDate] = useState("");
  const keys = exceptions
    ? Object.keys(value).sort()
    : ["0", "1", "2", "3", "4", "5", "6"];
  return (
    <div className="hours-editor">
      {exceptions && (
        <div className="exception-add">
          <label>
            Exception date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!date}
            onClick={() => {
              onChange({ ...value, [date]: [] });
              setDate("");
            }}
          >
            Add date
          </button>
        </div>
      )}
      {keys.map((k) => (
        <div className="hours-row" key={k}>
          <strong>
            {exceptions
              ? k
              : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(k)]}
          </strong>
          <div>
            {!(value[k] || []).length && <small>Closed</small>}
            {(value[k] || []).map(([a, b], index) => (
              <div className="time-window" key={index}>
                <input
                  type="time"
                  aria-label={`${k} opening time ${index + 1}`}
                  value={toTime(a)}
                  onChange={(e) => {
                    const v = [...value[k]];
                    v[index] = [minutes(e.target.value), b];
                    onChange({ ...value, [k]: v });
                  }}
                />
                <span>to</span>
                <input
                  type="time"
                  aria-label={`${k} closing time ${index + 1}`}
                  value={toTime(b)}
                  onChange={(e) => {
                    const v = [...value[k]];
                    v[index] = [a, minutes(e.target.value, true)];
                    onChange({ ...value, [k]: v });
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${k} window ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...value,
                      [k]: value[k].filter((_, j) => j !== index),
                    })
                  }
                >
                  <XIcon size={18} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange({ ...value, [k]: [...(value[k] || []), [540, 1020]] })
              }
            >
              Add hours
            </button>
          </div>
          {exceptions && (
            <button
              type="button"
              className="icon-button"
              aria-label={"Remove exception " + k}
              onClick={() => {
                const v = { ...value };
                delete v[k];
                onChange(v);
              }}
            >
              <XIcon size={18} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
function RefugeEditor({
  value: r,
  onChange,
  onSave,
  onError,
  onCancel,
  fresh,
  dirty,
}: {
  value: AdminRefuge;
  onChange: (r: AdminRefuge) => void;
  onSave: (r: AdminRefuge) => Promise<void>;
  onError: (m: string) => void;
  onCancel: () => void;
  fresh: boolean;
  dirty: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const patch = (p: Partial<AdminRefuge>) => onChange({ ...r, ...p });
  return (
    <form
      className="admin-detail refuge-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (r.publication === "published" && !preview) {
          setPreview(true);
          return;
        }
        setBusy(true);
        try {
          await onSave(r);
        } catch (e) {
          onError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="panel-heading">
        <h2>{r.revision ? "Edit refuge" : "New refuge"}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close refuge editor"
          onClick={onCancel}
        >
          <XIcon size={22} />
        </button>
      </div>
      <h3>Public details</h3>
      <label>
        Name
        <input
          maxLength={200}
          required
          value={r.name}
          onChange={(e) => {
            patch({ name: e.target.value });
            setPreview(false);
          }}
        />
      </label>
      <div className="coordinates">
        <label>
          Entrance longitude
          <input
            type="number"
            step="any"
            required
            value={r.lon}
            onChange={(e) => patch({ lon: Number(e.target.value) })}
          />
        </label>
        <label>
          Entrance latitude
          <input
            type="number"
            step="any"
            required
            value={r.lat}
            onChange={(e) => patch({ lat: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="small-copy">
        Click the map to place the pedestrian entrance.
      </p>
      <label>
        Access instructions
        <textarea
          maxLength={2000}
          value={r.instructions}
          onChange={(e) => {
            patch({ instructions: e.target.value });
            setPreview(false);
          }}
        />
      </label>
      <h3>Opening hours</h3>
      <p className="small-copy">
        Delhi time. An ending time of 00:00 means midnight at the end of that
        day. Split overnight hours across days.
      </p>
      <Hours
        value={r.hours}
        onChange={(hours) => {
          patch({ hours });
          setPreview(false);
        }}
      />
      <details>
        <summary>Date-specific exceptions</summary>
        <Hours
          exceptions
          value={r.exceptions}
          onChange={(exceptions) => {
            patch({ exceptions });
            setPreview(false);
          }}
        />
      </details>
      <h3>Private host confirmation</h3>
      <label>
        Host contact
        <input
          maxLength={500}
          value={r.hostContact}
          onChange={(e) => patch({ hostContact: e.target.value })}
        />
      </label>
      <label>
        Confirmation date
        <input
          type="date"
          max={delhiDate(new Date())}
          value={r.confirmedAt ? delhiDate(new Date(r.confirmedAt)) : ""}
          onChange={(e) =>
            patch({
              confirmedAt: e.target.value
                ? new Date(e.target.value + "T00:00:00+05:30").toISOString()
                : null,
            })
          }
        />
      </label>
      <label>
        Confirmation notes
        <textarea
          maxLength={2000}
          value={r.confirmationNote}
          onChange={(e) => patch({ confirmationNote: e.target.value })}
        />
      </label>
      <h3>Publication and availability</h3>
      <label>
        Publication
        <select
          aria-label="Publication"
          value={r.publication}
          onChange={(e) => {
            patch({
              publication: e.target.value as AdminRefuge["publication"],
            });
            setPreview(false);
          }}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived / host access withdrawn</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={r.closed}
          onChange={(e) => patch({ closed: e.target.checked })}
        />
        Temporarily closed, reopen manually
      </label>
      {preview && (
        <div className="public-preview">
          <p className="eyebrow">PUBLIC PREVIEW</p>
          <h3>{r.name}</h3>
          <p>{r.instructions}</p>
          <small>Host contact and confirmation notes stay private.</small>
        </div>
      )}
      <div className="form-actions">
        <button className="primary" disabled={!fresh || busy || !dirty}>
          {busy
            ? "Saving…"
            : r.publication === "published" && !preview
              ? "Preview publication"
              : "Save refuge"}
        </button>
        <button className="secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function Activity({ items }: { items: Audit[] }) {
  const [q, setQ] = useState("");
  return (
    <section className="activity-view">
      <label>
        Filter activity
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Operator, action, target, or reason"
        />
      </label>
      {items
        .filter((a) =>
          [a.email, a.action, a.target, a.reason]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
        .map((a) => (
          <article key={a.id}>
            <div>
              <strong>{a.action.replaceAll("-", " ")}</strong>
              <time>{new Date(a.created_at).toLocaleString()}</time>
            </div>
            <p>
              {a.email} · {a.reason}
            </p>
            <a
              href={
                "/admin?view=" +
                (a.action === "save-refuge"
                  ? "refuges"
                  : a.action === "team-access"
                    ? "team"
                    : "incidents") +
                "&target=" +
                encodeURIComponent(a.target)
              }
            >
              {a.target}
            </a>
            <details>
              <summary>Before / after</summary>
              <div className="audit-states">
                <pre>{JSON.stringify(a.before_state, null, 2)}</pre>
                <pre>{JSON.stringify(a.after_state, null, 2)}</pre>
              </div>
            </details>
          </article>
        ))}
      {!items.length && (
        <p className="empty-state">Operator changes will appear here.</p>
      )}
    </section>
  );
}
function Team({
  members,
  fresh,
  csrf,
  onDone,
  onError,
}: {
  members: TeamMember[];
  fresh: boolean;
  csrf: string;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false);
  const save = async (m: TeamMember) => {
    setBusy(true);
    try {
      await api("admin/team", "PUT", m, csrf);
      setEmail("");
      await onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="team-view">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ email, role: "admin", enabled: true });
        }}
      >
        <label>
          Approve operator email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button className="primary" disabled={!fresh || busy}>
          Approve access
        </button>
      </form>
      <p className="small-copy">
        Approved operators sign in through the identity provider. Share the
        operator-console URL yourself.
      </p>
      {members.map((m) => (
        <div className="team-row" key={m.email}>
          <span>
            <strong>{m.email}</strong>
            <small>
              {m.role} · {m.enabled ? "Approved" : "Revoked"}
            </small>
          </span>
          <select
            aria-label={"Role for " + m.email}
            value={m.role}
            disabled={!fresh || busy}
            onChange={(e) => void save({ ...m, role: e.target.value })}
          >
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
          <button
            className="secondary"
            disabled={!fresh || busy}
            onClick={() => void save({ ...m, enabled: !m.enabled })}
          >
            {m.enabled ? "Revoke" : "Restore"}
          </button>
        </div>
      ))}
    </section>
  );
}
