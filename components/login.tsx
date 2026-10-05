"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { z } from "zod";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
export function Login({ email = "" }: { email?: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
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
              await api("auth/login", z.object({ ok: z.boolean() }), {
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
                autoComplete="username"
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
        </form>
        <p className="auth-foot">
          <Icon name="shield" size={14} />
          Everything running on your server. All here.
        </p>
      </div>
    </main>
  );
}
