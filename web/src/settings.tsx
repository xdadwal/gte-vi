import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import {
  defaultEnvelope,
  newerSettings,
  pollingDelay,
  type SettingsEnvelope,
} from "./settings-values";
export * from "./settings-values";
const Context = createContext({
  settings: defaultEnvelope,
  applySettings: (_next?: SettingsEnvelope) => {},
});
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultEnvelope);
  const applySettings = useCallback(
    (next?: SettingsEnvelope) => setSettings((old) => newerSettings(old, next)),
    [],
  );
  useEffect(() => {
    let active = true;
    const pull = () => {
      if (!document.hidden)
        void api<SettingsEnvelope>("settings")
          .then((next) => {
            if (active) applySettings(next);
          })
          .catch(() => {});
    };
    pull();
    const timer = setInterval(pull, pollingDelay(settings.values));
    document.addEventListener("visibilitychange", pull);
    window.addEventListener("online", pull);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", pull);
      window.removeEventListener("online", pull);
    };
  }, [
    settings.values.pollingSeconds,
    settings.values.staleSeconds,
    applySettings,
  ]);
  return (
    <Context.Provider value={{ settings, applySettings }}>
      {children}
    </Context.Provider>
  );
}
export const useSettings = () => useContext(Context);
