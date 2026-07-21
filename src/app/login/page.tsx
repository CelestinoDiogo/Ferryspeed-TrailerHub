"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
const UNEXPECTED_SIGN_IN_MESSAGE = "Unable to sign in. Please try again.";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const canSubmit = useMemo(() => {
    return !isCheckingSession && !isSubmitting && email.trim().length > 0 && password.length > 0;
  }, [email, isCheckingSession, isSubmitting, password]);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) {
        return;
      }

      if (sessionError) {
        setIsCheckingSession(false);
        return;
      }

      if (data.session?.access_token) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      setIsCheckingSession(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return;
      }

      if (event === "SIGNED_IN" && session?.access_token) {
        router.replace("/dashboard");
        router.refresh();
      }
    });

    void checkSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting || isCheckingSession) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        const normalized = signInError.message.toLowerCase();
        if (normalized.includes("invalid") || normalized.includes("credentials") || normalized.includes("password") || normalized.includes("email")) {
          setError(INVALID_CREDENTIALS_MESSAGE);
          return;
        }

        setError(UNEXPECTED_SIGN_IN_MESSAGE);
        return;
      }

      if (!data.session?.access_token) {
        setError(UNEXPECTED_SIGN_IN_MESSAGE);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(UNEXPECTED_SIGN_IN_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Ferryspeed TrailerHub</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Sign In Required</h1>
        <p className="mt-3 text-sm text-slate-600">
          Sign in with your Ferryspeed account to continue to the operational dashboard.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-slate-700">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSubmitting || isCheckingSession}
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-600"
              placeholder="you@ferryspeed.com"
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-slate-700">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting || isCheckingSession}
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-600"
              placeholder="Enter your password"
              required
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCheckingSession ? "Checking session..." : isSubmitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
