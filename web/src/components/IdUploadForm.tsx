"use client";

import React, { useState, useTransition } from "react";
import { uploadIdDocumentAction } from "@/actions/candidate";

interface IdUploadFormProps {
  applicationId: string;
  registeredFullName: string;
  isRejected: boolean;
  rejectionReason: string | null;
}

export function IdUploadForm({
  applicationId,
  registeredFullName,
  isRejected,
  rejectionReason,
}: IdUploadFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nameOnId, setNameOnId] = useState(registeredFullName);
  const [documentNumber, setDocumentNumber] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await uploadIdDocumentAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Could not upload ID document.");
        return;
      }
      setSuccess(result.message ?? "ID document uploaded.");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-xs"
    >
      <input type="hidden" name="applicationId" value={applicationId} />

      <div>
        <h3 className="text-lg font-bold text-slate-900">
          {isRejected ? "Upload Replacement Government ID" : "Upload Government ID Document"}
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Upload a clear photo (JPEG, PNG, WebP) or PDF of your government-issued ID (National ID,
          International Passport, Voter Card, or Driver&apos;s Licence). Maximum file size is 5 MB.
        </p>
      </div>

      {isRejected && rejectionReason && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <strong>Reason previous ID was not approved:</strong> {rejectionReason}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900"
        >
          {error}
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900"
        >
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nameOnId" className="block text-sm font-medium text-slate-800">
            Full name printed on ID (must match registered name) *
          </label>
          <input
            id="nameOnId"
            name="nameOnId"
            type="text"
            required
            value={nameOnId}
            onChange={(e) => setNameOnId(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div>
          <label htmlFor="documentNumber" className="block text-sm font-medium text-slate-800">
            Government ID Number *
          </label>
          <input
            id="documentNumber"
            name="documentNumber"
            type="text"
            required
            placeholder="Enter ID / Passport number"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </div>
      </div>

      <div>
        <label htmlFor="idFile" className="block text-sm font-medium text-slate-800">
          Select ID file (JPEG, PNG, WebP, or PDF, max 5 MB) *
        </label>
        <input
          id="idFile"
          name="idFile"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="mt-1 block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-800"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? "Uploading securely..." : "Submit ID for Verification"}
      </button>
    </form>
  );
}

