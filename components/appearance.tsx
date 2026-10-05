"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  appearanceKey,
  applyAppearance,
  defaultAppearance,
  normalizeAppearance,
  type Appearance,
} from "@/lib/appearance";

type Context = {
  appearance: Appearance;
  update: (patch: Partial<Appearance>) => void;
  reset: () => void;
};
const AppearanceContext = createContext<Context>({
  appearance: defaultAppearance,
  update: () => {},
  reset: () => {},
});
export function useAppearance() {
  return useContext(AppearanceContext);
}
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  useEffect(() => {
    try {
      setAppearance(
        normalizeAppearance(
          JSON.parse(localStorage.getItem(appearanceKey) ?? "{}"),
        ),
      );
    } catch {
      // Storage can be unavailable (private mode); defaults still apply.
    }
  }, []);
  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((current) => {
      const next = normalizeAppearance({ ...current, ...patch });
      applyAppearance(next, document.documentElement);
      try {
        localStorage.setItem(appearanceKey, JSON.stringify(next));
      } catch {
        // Ignore: preference simply won't persist.
      }
      return next;
    });
  }, []);
  // Reset keeps the display name: it is personal data, not a look.
  const reset = useCallback(
    () =>
      setAppearance((current) => {
        const next = { ...defaultAppearance, name: current.name };
        applyAppearance(next, document.documentElement);
        try {
          localStorage.setItem(appearanceKey, JSON.stringify(next));
        } catch {
          // Ignore: preference simply won't persist.
        }
        return next;
      }),
    [],
  );
  return (
    <AppearanceContext.Provider value={{ appearance, update, reset }}>
      {children}
    </AppearanceContext.Provider>
  );
}
