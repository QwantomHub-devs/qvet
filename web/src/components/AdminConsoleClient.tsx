"use client";

import React, { useState, useTransition } from "react";
import {
  getSignedIdDocumentUrlAction,
  importQuestionsCsvAction,
  setUserRoleAction,
  toggleQuestionActiveAction,
  unlockStage2Action,
  updateRubricCriterionAction,
  upsertInstitutionAction,
  verifyIdDocumentAction,
} from "@/actions/admin";
import {
  DOMAIN_LABELS,
  STATUS_DESCRIPTIONS,
  TRACK_LABELS,
  type Application,
  type AuditLogEntry,
  type IdDocument,
  type Institution,
  type Profile,
  type Question,
  type RubricCriterion,
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
  questions: Question[];
  institutions: Institution[];
  profiles: Profile[];
  auditLogs: AuditLogEntry[];
  settings: SettingRow[];
  rubricCriteria?: RubricCriterion[];
}

const SAMPLE_CSV_TEMPLATE = `track,stage,domain,difficulty,type,stem,code_snippet,option_a,option_b,option_c,option_d,correct,tolerance,explanation
ai,2,python_data,easy,mcq,"[FAKE SAMPLE CSV] Which pandas method removes rows with missing values?",,dropna(),fillna(),isna(),astype(),A,0,dropna removes missing rows
ai,2,eval_debugging,medium,numeric,"[FAKE SAMPLE CSV] If TP=80, FP=20, FN=20, what is the F1 score?",,,,,,0.80,0.02,Precision=0.80 and Recall=0.80 so F1=0.80`;

export function AdminConsoleClient({
  rows,
  questions,
  institutions,
  profiles,
  auditLogs,
  settings,
  rubricCriteria = [],
}: AdminConsoleClientProps) {
  const [activeTab, setActiveTab] = useState<
    "applications" | "questions" | "rubrics" | "institutions" | "users" | "audit" | "settings"
  >("applications");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [csvText, setCsvText] = useState<string>("");
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

  function handleUnlockStage2(applicationId: string) {
    setFeedback(null);
    const formData = new FormData();
    formData.set("applicationId", applicationId);
    startTransition(async () => {
      const res = await unlockStage2Action(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Could not unlock Stage 2." });
        return;
      }
      setFeedback({ type: "ok", text: res.message ?? "Stage 2 unlocked." });
    });
  }

  function handleCsvImportSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await importQuestionsCsvAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "CSV import failed." });
        return;
      }
      setCsvText("");
      setFeedback({ type: "ok", text: res.message ?? "Questions imported." });
    });
  }

  function handleToggleQuestion(questionId: string, nextActive: boolean) {
    setFeedback(null);
    const formData = new FormData();
    formData.set("questionId", questionId);
    formData.set("active", String(nextActive));
    startTransition(async () => {
      const res = await toggleQuestionActiveAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Could not update question." });
        return;
      }
      setFeedback({ type: "ok", text: res.message ?? "Question updated." });
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

  function handleRubricCriterionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await updateRubricCriterionAction(formData);
      if (!res.ok) {
        setFeedback({ type: "err", text: res.error ?? "Could not update rubric criterion." });
        return;
      }
      setFeedback({ type: "ok", text: res.message ?? "Rubric criterion updated." });
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist">
        {(
          [
            { id: "applications", label: `Applications & ID Queue (${rows.length})` },
            { id: "questions", label: `Question Bank & CSV Import (${questions.length})` },
            { id: "rubrics", label: `Rubrics & Anchors (${rubricCriteria.length})` },
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
                <option value="s2_open">s2_open</option>
                <option value="s2_passed">s2_passed</option>
                <option value="s2_failed">s2_failed</option>
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

                      <div className="flex items-center gap-2">
                        {application.status === "approved" && (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleUnlockStage2(application.id)}
                            className="rounded border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                          >
                            Unlock Stage 2 Exam
                          </button>
                        )}
                        <span
                          className={`rounded border px-2.5 py-1 text-xs font-semibold ${statusInfo.badgeClass}`}
                        >
                          {application.status}
                        </span>
                      </div>
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

      {activeTab === "questions" && (
        <section className="space-y-6">
          <form
            onSubmit={handleCsvImportSubmit}
            className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Import Questions from CSV (with Locked Answer Keys)
                </h2>
                <p className="text-xs text-slate-600">
                  Columns: track, stage, domain, difficulty, type, stem, code_snippet, option_a,
                  option_b, option_c, option_d, correct, tolerance, explanation
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_CSV_TEMPLATE)}
                className="rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                Load Sample CSV Template
              </button>
            </div>

            <textarea
              name="csvText"
              rows={5}
              required
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Paste CSV rows here..."
              className="w-full rounded border border-slate-300 p-3 font-mono text-xs text-slate-900"
            />

            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? "Importing..." : "Import CSV into Question Bank"}
            </button>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">Track / Stage</th>
                  <th className="px-3 py-2.5">Domain</th>
                  <th className="px-3 py-2.5">Difficulty</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5">Stem</th>
                  <th className="px-3 py-2.5">Stats (Correct/Used)</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {questions.map((q) => {
                  const hitRate =
                    q.times_used > 0 ? `${Math.round((q.times_correct / q.times_used) * 100)}%` : "—";
                  return (
                    <tr key={q.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold uppercase text-slate-800">
                        {q.track} · S{q.stage}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {DOMAIN_LABELS[q.domain] ?? q.domain}
                      </td>
                      <td className="px-3 py-2 uppercase text-slate-700">{q.difficulty}</td>
                      <td className="px-3 py-2 font-mono text-slate-600">{q.type}</td>
                      <td className="max-w-md truncate px-3 py-2 text-slate-900" title={q.stem}>
                        {q.stem}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-600">
                        {q.times_correct}/{q.times_used} ({hitRate})
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleToggleQuestion(q.id, !q.active)}
                          className={`rounded border px-2 py-0.5 text-xs font-semibold ${
                            q.active
                              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                              : "border-slate-300 bg-slate-100 text-slate-600"
                          }`}
                        >
                          {q.active ? "Active" : "Inactive"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      {activeTab === "rubrics" && (
        <section className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-base font-bold text-slate-900">
              Editable Reviewer Rubrics &amp; Score Anchors (1 to 4)
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Changes made here are saved to the database (`rubric_criteria`) and immediately
              reflected in the Blind Reviewer Console.
            </p>
          </div>

          {rubricCriteria.map((rc) => (
            <form
              key={rc.id}
              onSubmit={handleRubricCriterionSubmit}
              className="rounded-lg border border-slate-200 bg-white p-5 space-y-3"
            >
              <input type="hidden" name="criterionId" value={rc.id} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    Criterion Title ({rc.slug})
                  </label>
                  <input
                    type="text"
                    name="criterion"
                    defaultValue={rc.criterion}
                    required
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-900"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Save Anchors
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[1, 2, 3, 4].map((level) => (
                  <div key={level}>
                    <label className="block text-xs font-semibold text-slate-700">
                      Anchor Description for Score {level}
                    </label>
                    <textarea
                      name={`anchor${level}`}
                      rows={2}
                      defaultValue={rc.anchors[String(level)] ?? ""}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs text-slate-800"
                    />
                  </div>
                ))}
              </div>
            </form>
          ))}
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
