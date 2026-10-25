"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { bookStage4DefenceAction } from "@/actions/stage4";
import type { Application, Stage4Booking, StageResult } from "@/lib/types/database";

interface Stage4BookingClientProps {
  application: Application;
  booking: Stage4Booking | null;
  stage4Result: StageResult | null;
}

export function Stage4BookingClient({
  application,
  booking: initialBooking,
  stage4Result,
}: Stage4BookingClientProps) {
  const [booking, setBooking] = useState<Stage4Booking | null>(initialBooking);
  const [scheduledAt, setScheduledAt] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("https://meet.google.com/new");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function handleBook(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!scheduledAt) {
      setErrorMessage("Please select a date and time for your defence interview.");
      return;
    }

    const selectedTime = new Date(scheduledAt).getTime();
    if (isNaN(selectedTime) || selectedTime <= Date.now()) {
      setErrorMessage("The defence interview must be scheduled for a future date and time.");
      return;
    }

    if (!meetingUrl || !meetingUrl.startsWith("http")) {
      setErrorMessage("Please enter a valid video meeting URL (e.g. Google Meet or Jitsi).");
      return;
    }

    startTransition(async () => {
      const res = await bookStage4DefenceAction(
        application.id,
        new Date(scheduledAt).toISOString(),
        meetingUrl.trim(),
        notes.trim() || undefined
      );

      if (!res.ok || !res.booking) {
        setErrorMessage(res.error ?? "Failed to book defence interview.");
        return;
      }

      setBooking(res.booking);
      setSuccessMessage("Live technical defence scheduled successfully!");
    });
  }

  const isCompleted = booking?.status === "completed" || stage4Result !== null;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header Banner */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-800 uppercase tracking-wide">
                Stage 4 · Final Evaluation
              </span>
              <span className="text-xs text-slate-500 font-medium">Weight: 25% of Total</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Live Technical Defence</h1>
            <p className="mt-1 text-sm text-slate-600 max-w-2xl">
              A 40-minute one-on-one video call with a senior engineer. You will walk through your
              Stage 3 practical project, answer probing technical questions, and execute a live
              problem modification.
            </p>
          </div>

          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Unable to proceed</p>
          <p className="mt-1">{errorMessage}</p>
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Success</p>
          <p className="mt-1">{successMessage}</p>
        </div>
      )}

      {/* Completed Result Card */}
      {stage4Result && (
        <div
          className={`rounded-xl border p-6 ${
            stage4Result.passed
              ? "border-emerald-300 bg-emerald-50/70"
              : "border-red-300 bg-red-50/70"
          }`}
        >
          <div className="flex items-center justify-between">
            <h2
              className={`text-lg font-bold ${
                stage4Result.passed ? "text-emerald-950" : "text-red-950"
              }`}
            >
              {stage4Result.passed
                ? "Stage 4 Defence Passed"
                : "Stage 4 Defence Not Passed"}
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                stage4Result.passed
                  ? "bg-emerald-600 text-white"
                  : "bg-red-600 text-white"
              }`}
            >
              {stage4Result.raw_score} / 4.00 Avg ({stage4Result.percent}%)
            </span>
          </div>

          <p className="mt-2 text-sm text-slate-700">
            {stage4Result.passed
              ? "Congratulations! Your live technical defence was approved by the reviewer. Your application has been submitted for final credential issuance."
              : "You did not meet the required average score (minimum 2.50 / 4.00) or received a fail flag in understanding of submitted work. You will be eligible for a retake after the 60-day cooldown period."}
          </p>

          {stage4Result.passed && (
            <div className="mt-4">
              <Link
                href="/dashboard"
                className="inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800"
              >
                View Dashboard & Credential Status →
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Scheduled Defence Card */}
      {booking && !isCompleted && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="rounded bg-blue-200 px-2 py-0.5 text-xs font-bold text-blue-900 uppercase tracking-wide">
                Confirmed Appointment
              </span>
              <h2 className="mt-2 text-xl font-bold text-slate-900">
                Your Interview is Scheduled
              </h2>
              <p className="mt-1 text-sm text-slate-700">
                Date & Time:{" "}
                <span className="font-semibold text-slate-900">
                  {new Date(booking.scheduled_at).toLocaleString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </p>
            </div>

            <a
              href={booking.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
            >
              Join Video Call Room →
            </a>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Meeting Video Link
            </p>
            <p className="mt-1 font-mono text-xs text-slate-900 truncate">
              {booking.meeting_url}
            </p>
          </div>
        </div>
      )}

      {/* Booking Form if not yet scheduled or rescheduling */}
      {!booking && !isCompleted && (
        <form
          onSubmit={handleBook}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-6"
        >
          <div>
            <h2 className="text-lg font-bold text-slate-900">Schedule Your Live Defence</h2>
            <p className="mt-1 text-xs text-slate-600">
              Pick a date and time when you will have a stable internet connection and power.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Date and Time *
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
                className="mt-1.5 w-full rounded-md border border-slate-300 p-2.5 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Meeting URL (Google Meet / Jitsi) *
              </label>
              <input
                type="url"
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                required
                placeholder="https://meet.google.com/xyz-abcd-efg"
                className="mt-1.5 w-full rounded-md border border-slate-300 p-2.5 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Candidate Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any scheduling constraints or notes for the reviewer"
              className="mt-1.5 w-full rounded-md border border-slate-300 p-2.5 text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-slate-900 px-6 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? "Booking Defence..." : "Confirm Stage 4 Defence Booking"}
            </button>
          </div>
        </form>
      )}

      {/* Structure & Preparation Guidance */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">
          Interview Structure (40 Minutes)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-xs font-bold text-indigo-700">10 Minutes</div>
            <div className="mt-1 font-bold text-slate-900 text-sm">Walkthrough</div>
            <p className="mt-1 text-xs text-slate-600">
              Share your screen and walk through your Stage 3 code and architectural choices.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-xs font-bold text-indigo-700">10 Minutes</div>
            <div className="mt-1 font-bold text-slate-900 text-sm">Probing</div>
            <p className="mt-1 text-xs text-slate-600">
              The reviewer asks "why" on specific parameters, metrics, chunk sizes, and prompt designs.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-xs font-bold text-indigo-700">15 Minutes</div>
            <div className="mt-1 font-bold text-slate-900 text-sm">Live Change</div>
            <p className="mt-1 text-xs text-slate-600">
              The reviewer requests a constraint modification and watches you reason and edit live.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-xs font-bold text-indigo-700">5 Minutes</div>
            <div className="mt-1 font-bold text-slate-900 text-sm">Close</div>
            <p className="mt-1 text-xs text-slate-600">
              Wrap up, candidate questions, and professionalism notes.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
          <p className="font-bold">Important Passing Criteria (AI Track Blueprint §7.1):</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Minimum average score of 2.50 / 4.00 across all 5 rubric criteria.</li>
            <li>
              You must score above 1 on "Understanding of own work". A score of 1 is an automatic
              fail signal for borrowed or AI-generated work you cannot explain.
            </li>
            <li>Government ID must be presented on camera at the start of the call.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
