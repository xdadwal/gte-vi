import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { PublicMap } from "./PublicMap";
const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));
import "./styles.css";
import { SettingsProvider } from "./settings";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <Suspense
        fallback={<main className="admin-signin">Loading application…</main>}
      >
        {location.pathname.startsWith("/admin") ? <Admin /> : <PublicMap />}
      </Suspense>
    </SettingsProvider>
  </React.StrictMode>,
);
