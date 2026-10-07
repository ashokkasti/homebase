"use client";
import { useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  WebAuthnAbortService,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "@/lib/api";
import { passkeyError } from "./passkeys";
import { z } from "zod";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
const okResult = z.object({ ok: z.boolean() });
const requestOptions = z.custom<PublicKeyCredentialRequestOptionsJSON>(
  (v) => typeof v === "object" && v !== null && "challenge" in v,
);
async function passkeySignIn(autofill: boolean) {
  const optionsJSON = await api("auth/passkey/options", requestOptions, {});
  const response = await startAuthentication({
    optionsJSON,
    useBrowserAutofill: autofill,
  });
  await api("auth/passkey/login", okResult, { response });
  window.location.assign("/");
}

export function Login({
  email = "",
  passkeys = false,
}: {
  email?: string;
  passkeys?: boolean;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (!passkeys || !browserSupportsWebAuthn()) return;
    setSupported(true);
    // Offer the passkey in the email field's autofill as well.
    let active = true;
    void browserSupportsWebAuthnAutofill().then((autofill) => {
      if (autofill && active) passkeySignIn(true).catch(() => undefined);
    });
    return () => {
      active = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [passkeys]);
  async function biometric() {
    setPending(true);
    setError("");
    try {
      await passkeySignIn(false);
    } catch (err) {
      const message = passkeyError(err, "Passkey sign-in failed.");
      if (message !== "Cancelled.") setError(message);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="auth">
      <div className="auth-glow" aria-hidden />
      <div className="auth-card">
        <span className="brand-mark brand-mark-lg">
          <Icon name="home" size={28} />
        </span>
        <h1>Welcome home.</h1>
        <p>Sign in to take care of your server.</p>
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError("");
            const data = new FormData(event.currentTarget);
            try {
              await api("auth/login", okResult, {
                email: data.get("email"),
                password: data.get("password"),
              });
              window.location.assign("/");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign in failed.");
            } finally {
              setPending(false);
            }
          }}
        >
          <label className="field">
            <span>Email</span>
            <span className="input-icon">
              <Icon name="user" size={16} />
              <input
                type="email"
                name="email"
                required
                autoComplete={passkeys ? "username webauthn" : "username"}
                defaultValue={email}
                placeholder="you@example.com"
              />
            </span>
          </label>
          <label className="field">
            <span>Password</span>
            <span className="input-icon">
              <Icon name="lock" size={16} />
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
              />
            </span>
          </label>
          {error && (
            <div className="banner banner-red" role="alert">
              <Icon name="danger" size={18} />
              <span>{error}</span>
            </div>
          )}
          <Button disabled={pending} type="submit">
            {pending ? "Signing in…" : "Sign in"}
            <Icon name="arrowRight" size={16} />
          </Button>
          {supported && (
            <>
              <span className="auth-or" aria-hidden>
                or
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void biometric()}
              >
                <Icon name="faceId" size={17} />
                Sign in with Face ID or fingerprint
              </Button>
            </>
          )}
        </form>
        <p className="auth-foot">
          <Icon name="shield" size={14} />
          Everything running on your server. All here.
        </p>
      </div>
    </main>
  );
}
