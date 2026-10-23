"use client";

import React, { useState, useTransition } from "react";
import {
  getSignedIdDocumentUrlAction,
  setUserRoleAction,
  upsertInstitutionAction,
  verifyIdDocumentAction,
} from "@/actions/admin";
import {
  STATUS_DESCRIPTIONS,
  TRACK_LABELS,
  type Application,
  type AuditLogEntry,
  type IdDocument,
  type Institution,
  type Profile,
  type SettingRow,
} from "@/lib/types/database";

export interface AdminApplicationRow {
  application: Application;
  profile: Profile | null;
  currentIdDoc: IdDocument | null;
  institutionName: string;
}

interface AdminConsoleClientProps {
  rows: AdminApplicationRow[];
  institutions: Institution[];
  profiles: Profile[];
  auditLogs: AuditLogEntry[];
  settings: SettingRow[];
}

export function AdminConsoleClient({
  rows,
  institutions,
  profiles,
  auditLogs,
  settings,
}: AdminConsoleClientProps) {
  const [activeTab, setActiveTab] = useState<
    "applications" | "institutions" | "users" | "audit" | "settings"
  >("applications");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [signedPreview, setSignedPreview] = useState<{ docId: string; url: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredRows = rows.filter((r) =>
    statusFilter === "all" ? true : r.application.status === statusFilter
  );

  function handleViewId(docId: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await getSignedIdDocumentUrlAction(docId);
      if (!res.ok || !res.signedUrl) {
        setFeedback({ type: "err", text: res.error ?? "Failed to open ID document." });
        return;
      }
      setSignedPreview({ docId, url: res.signedUrl });
      setFeedback({
        type: "ok",
        text: "ID access recorded in audit_log. Generated a 60-second signed link.",
      });
    });
  }

  function handleVerifySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await verifyIdDocumentAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Verification failed." });
        return;
      }
      setFeedback({ type: "ok", text: res.message ?? "Updated." });
    });
  }

  function handleInstitutionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const res = await upsertInstitutionAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Could not save institution." });
        return;
      }
      form.reset();
      setFeedback({ type: "ok", text: res.message ?? "Institution saved." });
    });
  }

  function handleRoleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await setUserRoleAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Could not update role." });
        return;
      }
      setFeedback({ type: "ok", text: res.message ?? "Role updated." });
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist">
        {(
          [
            { id: "applications", label: `Applications & ID Queue (${rows.length})` },
            { id: "institutions", label: `Partner Institutions (${institutions.length})` },
            { id: "users", label: `Users & Roles (${profiles.length})` },
            { id: "audit", label: `Audit Log (${auditLogs.length})` },
            { id: "settings", label: `Runtime Settings (${settings.length})` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded px-3.5 py-2 text-sm font-semibold ${
              activeTab === tab.id
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded border p-3 text-sm font-medium ${
            feedback.type === "ok"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-red-300 bg-red-50 text-red-900"
          }`}
        >
          {feedback.text}
        </div>
      )}

      {signedPreview && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm text-blue-950">
          <div className="flex items-center justify-between">
            <strong>Short-Lived Signed ID Document URL (expires in 60 seconds):</strong>
            <button
              type="button"
              onClick={() => setSignedPreview(null)}
              className="text-xs font-semibold underline"
            >
              Close
            </button>
          </div>
          <p className="mt-1">
            <a
              href={signedPreview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-blue-800 underline"
            >
              Open Verified Signed Document in New Tab
            </a>
          </p>
        </div>
      )}

      {activeTab === "applications" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Candidate Applications &amp; ID Check</h2>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="statusFilter" className="font-medium text-slate-700">
                Filter status:
              </label>
              <select
                id="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="all">All ({rows.length})</option>
                <option value="id_pending">id_pending</option>
                <option value="registered">registered</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <p className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600">
              No applications match the selected filter.
            </p>
          ) : (
            <div className="space-y-4">
              {filteredRows.map(({ application, profile, currentIdDoc, institutionName }) => {
                const statusInfo = STATUS_DESCRIPTIONS[application.status];
                return (
                  <div
                    key={application.id}
                    className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          {profile?.full_name || "Unnamed Candidate"}
                        </h3>
                        <p className="text-xs text-slate-600">
                          Track: <strong>{TRACK_LABELS[application.track]}</strong> · Stage:{" "}
                          <strong>{application.current_stage}</strong> · Institution:{" "}
                          <strong>{institutionName}</strong>
                        </p>
                        {profile && (
                          <p className="mt-1 text-xs text-slate-600">
                            Phone: {profile.phone || "—"} · Country: {profile.country || "—"} · Exp:{" "}
                            {profile.years_experience ?? 0} yrs · Availability:{" "}
                            {profile.weekly_availability_hours ?? 0} hrs/wk
                          </p>
                        )}
                        {profile?.github_url && (
                          <p className="mt-1 text-xs">
                            GitHub/Portfolio:{" "}
                            <a
                              href={profile.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-blue-700 underline"
                            >
                              {profile.github_url}
                            </a>
                          </p>
                        )}
                      </div>

                      <span
                        className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusInfo.badgeClass}`}
                      >
                        {application.status}
                      </span>
                    </div>

                    {currentIdDoc ? (
                      <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-slate-900">
                              ID Document: Name on ID &ldquo;{currentIdDoc.name_on_id}&rdquo; (
                              {Math.round(currentIdDoc.file_size_bytes / 1024)} KB,{" "}
                              {currentIdDoc.mime_type})
                            </p>
                            <p className="text-xs text-slate-600">
                              Uploaded: {new Date(currentIdDoc.created_at).toLocaleString()}
                              {currentIdDoc.decision &&
                                ` · Last decision: ${currentIdDoc.decision}`}
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleViewId(currentIdDoc.id)}
                            className="rounded border border-slate-400 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100"
                          >
                            View ID Document (Logged)
                          </button>
                        </div>

                        {application.status === "id_pending" && (
                          <form
                            onSubmit={handleVerifySubmit}
                            className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-200 pt-3"
                          >
                            <input type="hidden" name="applicationId" value={application.id} />
                            <div>
                              <label className="block text-xs font-medium text-slate-700">
                                Decision
                              </label>
                              <select
                                name="decision"
                                defaultValue="approved"
                                className="mt-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                              >
                                <option value="approved">Approve ID (Unlock Stage 1)</option>
                                <option value="rejected">Reject ID (Request Re-upload)</option>
                              </select>
                            </div>
                            <div className="min-w-[240px] flex-1">
                              <label className="block text-xs font-medium text-slate-700">
                                Note / Rejection reason (required if rejecting)
                              </label>
                              <input
                                type="text"
                                name="reason"
                                placeholder="e.g. Verified clear government ID / Photo blurry"
                                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                              />
                            </div>
                            <button
                              type="submit"
                              disabled={isPending}
                              className="rounded bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                              Submit Decision
                            </button>
                          </form>
                        )}
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-slate-500">
                        Candidate has not uploaded a government ID document yet.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === "institutions" && (
        <section className="space-y-6">
          <form
            onSubmit={handleInstitutionSubmit}
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
          >
            <h2 className="text-base font-bold text-slate-900">Add Partner Institution</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Institution Name *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="e.g. Obafemi Awolowo University (OAU)"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Country *</label>
                <input
                  type="text"
                  name="country"
                  required
                  defaultValue="Nigeria"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Partner Code</label>
                <input
                  type="text"
                  name="partnerCode"
                  placeholder="OAU-NG"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <input type="hidden" name="active" value="true" />
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Add Institution
            </button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Country</th>
                  <th className="px-4 py-3">Partner Code</th>
                  <th className="px-4 py-3">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {institutions.map((inst) => (
                  <tr key={inst.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{inst.name}</td>
                    <td className="px-4 py-3 text-slate-600">{inst.country}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {inst.partner_code || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{inst.active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "users" && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Full Name</th>
                <th className="px-4 py-3">User ID</th>
                <th className="px-4 py-3">Current Role</th>
                <th className="px-4 py-3">Change Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {p.full_name || "(No name yet)"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.user_id}</td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase">
                      {p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <form onSubmit={handleRoleSubmit} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={p.user_id} />
                      <select
                        name="role"
                        defaultValue={p.role}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="candidate">candidate</option>
                        <option value="reviewer">reviewer</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        type="submit"
                        disabled={isPending}
                        className="rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "audit" && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2.5">Timestamp</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-3 py-2.5">Entity</th>
                <th className="px-3 py-2.5">Actor</th>
                <th className="px-3 py-2.5">Before</th>
                <th className="px-3 py-2.5">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {auditLogs.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {new Date(entry.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{entry.action}</td>
                  <td className="px-3 py-2 text-slate-700">{entry.entity}</td>
                  <td className="font-mono px-3 py-2 text-slate-500">
                    {entry.actor ? entry.actor.slice(0, 8) + "…" : "system"}
                  </td>
                  <td className="font-mono px-3 py-2 text-slate-600">
                    {entry.before ? JSON.stringify(entry.before) : "—"}
                  </td>
                  <td className="font-mono px-3 py-2 text-slate-600">
                    {entry.after ? JSON.stringify(entry.after) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeTab === "settings" && (
        <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Runtime Value (JSON)</th>
                <th className="px-4 py-3">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {settings.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                    {s.key}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {JSON.stringify(s.value)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
