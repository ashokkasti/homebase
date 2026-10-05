"use client";
// Promise-based confirmation dialog: `const ok = await confirm({...})`.
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Tile, type Hue } from "./kit";
import type { IconName } from "./ui/icon";

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  icon?: IconName;
  tone?: "danger" | "default";
  typeToConfirm?: string;
  option?: { label: string; description?: string };
};
export type ConfirmResult = { option: boolean };
type Confirm = (options: ConfirmOptions) => Promise<ConfirmResult | null>;
const ConfirmContext = createContext<Confirm>(async () => null);
export function useConfirm() {
  return useContext(ConfirmContext);
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [text, setText] = useState("");
  const [option, setOption] = useState(false);
  const resolver = useRef<((value: ConfirmResult | null) => void) | null>(null);
  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(null);
    setText("");
    setOption(false);
    setOptions(next);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  function close(result: ConfirmResult | null) {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }
  const danger = options?.tone !== "default";
  const blocked = !!options?.typeToConfirm && text !== options.typeToConfirm;
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!options}
        onOpenChange={(open) => {
          if (!open) close(null);
        }}
        icon={
          <Tile
            icon={options?.icon ?? (danger ? "danger" : "info")}
            hue={(danger ? "red" : "amber") as Hue}
          />
        }
        title={options?.title ?? ""}
        description={options?.description}
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) close({ option });
          }}
        >
          {options?.option && (
            <label className="check-card">
              <input
                type="checkbox"
                checked={option}
                onChange={(e) => setOption(e.target.checked)}
              />
              <span>
                <strong>{options.option.label}</strong>
                {options.option.description && (
                  <small>{options.option.description}</small>
                )}
              </span>
            </label>
          )}
          {options?.typeToConfirm && (
            <label className="field">
              <span>
                Type <strong className="mono">{options.typeToConfirm}</strong>{" "}
                to confirm
              </span>
              <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="dialog-actions">
            <Button type="button" variant="ghost" onClick={() => close(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              autoFocus={!options?.typeToConfirm}
              variant={danger ? "danger" : "default"}
              disabled={blocked}
            >
              {options?.confirmLabel}
            </Button>
          </div>
        </form>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
