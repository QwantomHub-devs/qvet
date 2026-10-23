"use client";

import Link from "next/link";
import React, { useState, useTransition } from "react";
import { signUpAction } from "@/actions/auth";
import { Navbar } from "@/components/Navbar";

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await signUpAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Registration failed.");
        return;
      }
      setMessage(result.message ?? "Check your email to confirm your account.");
    });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Create candidate account</h1>
            <p className="mt-1 text-sm text-slate-600">
              Use your full legal name as printed on your government ID. Email confirmation is
              required.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900"
            >
              {error}
            </div>
          )}

          {message && (
            <div
              role="status"
              className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900"
            >
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-slate-800">
                Full legal name (as shown on ID)
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-800">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-800">
                Password (at least 8 characters)
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Already confirmed your email?{" "}
            <Link href="/login" className="font-semibold text-slate-900 underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

