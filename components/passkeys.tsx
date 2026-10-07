"use client";
// Passkey management (Face ID, Touch ID, fingerprint) and app install prompt.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  browserSupportsWebAuthn,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { formatDate } from "./kit";
import { useConfirm } from "./confirm";
import { okSchema } from "./workspace";

const listSchema = z.object({
  passkeys: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
    }),
  ),
});
const optionsSchema = z.custom<PublicKeyCredentialCreationOptionsJSON>(
  (v) => typeof v === "object" && v !== null && "challenge" in v,
);

// A friendly default name for the passkey, e.g. "iPhone" or "Mac".
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}

export function passkeyError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError" || error.name === "AbortError")
      return "Cancelled.";
    if (error.name === "InvalidStateError")
      return "This device already has a Homebase passkey.";
    return error.message || fallback;
  }
  return fallback;
}

export function PasskeySettings() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  const query = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api("auth/passkeys", listSchema),
  });
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["passkeys"] });
  const add = useMutation({
    mutationFn: async () => {
      const optionsJSON = await api("auth/passkeys/options", optionsSchema, {});
      const response = await startRegistration({ optionsJSON });
      return api("auth/passkeys/register", okSchema, {
        response,
        name: deviceName(),
      });
    },
    onSuccess: () => {
      toast.success("Passkey added. Use it next time you sign in.");
      refresh();
    },
    onError: (error) => {
      const message = passkeyError(error, "Could not add a passkey.");
      if (message !== "Cancelled.") toast.error(message);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api("auth/passkeys/delete", okSchema, { id }),
    onSuccess: () => {
      toast.success("Passkey removed");
      refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const passkeys = query.data?.passkeys ?? [];
  return (
    <>
      <div className="setting-row">
        <span className="row-text">
          <span>Face ID, Touch ID and fingerprint</span>
          <span className="row-sub wrap">
            {supported
              ? "Add a passkey on each phone or computer you sign in from."
              : "This browser does not support passkeys."}
          </span>
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!supported || add.isPending}
          onClick={() => add.mutate()}
        >
          <Icon name="faceId" size={15} />
          {add.isPending ? "Waiting…" : "Add passkey"}
        </Button>
      </div>
      {query.isError && (
        <div className="banner banner-red">
          <Icon name="danger" size={18} />
          <span>{query.error.message}</span>
        </div>
      )}
      {passkeys.map((p) => (
        <div className="setting-row passkey-row" key={p.id}>
          <span className="row-text">
            <span className="passkey-name">
              <Icon name="key" size={14} />
              {p.name}
            </span>
            <span className="row-sub">
              Added {formatDate(p.createdAt)}
              {p.lastUsedAt
                ? ` · last used ${formatDate(p.lastUsedAt)}`
                : " · not used yet"}
            </span>
          </span>
          <button
            className="icon-button danger-hover"
            aria-label={`Remove passkey ${p.name}`}
            title="Remove"
            disabled={remove.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: `Remove ${p.name}?`,
                description:
                  "That device can no longer sign in with biometrics. You can add it again later.",
                confirmLabel: "Remove passkey",
                icon: "trash",
              });
              if (ok) remove.mutate(p.id);
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
    </>
  );
}

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && navigator.standalone === true),
    );
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return (
    <div className="setting-row">
      <span className="row-text">
        <span>Install the app</span>
        <span className="row-sub wrap">
          {installed
            ? "Homebase is installed on this device."
            : event
              ? "Add Homebase to your home screen or dock."
              : ios
                ? "In Safari, tap Share, then Add to Home Screen."
                : "Use your browser’s Install option to add Homebase."}
        </span>
      </span>
      {installed ? (
        <span className="pill s-running">
          <span className="dot" />
          Installed
        </span>
      ) : (
        event && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await event.prompt();
              const choice = await event.userChoice;
              if (choice.outcome === "accepted") setInstalled(true);
              setEvent(null);
            }}
          >
            <Icon name="phone" size={15} />
            Install
          </Button>
        )
      )}
    </div>
  );
}
