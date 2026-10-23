"use client";

import Link from "next/link";
import React, { useState, useTransition } from "react";
import { signInAction } from "@/actions/auth";
import { Navbar } from "@/components/Navbar";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await signInAction(formData);
      if (result && !result.ok) {
        setError(result.error ?? "Sign in failed.");
      }
    });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs space-y-5">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Sign in to your account</h1>
            <p className="mt-1 text-sm text-slate-600">
              Enter your registered email and password to continue.
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

          <form onSubmit={handleSubmit} className="space-y-4">
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
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Do not have an account yet?{" "}
            <Link href="/register" className="font-semibold text-slate-900 underline">
              Create candidate account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
