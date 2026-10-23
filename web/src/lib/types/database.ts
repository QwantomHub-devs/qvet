export type UserRole = "candidate" | "reviewer" | "admin";

export type Track = "ai" | "iot" | "robotics";

export type ApplicationStatus =
  | "registered"
  | "id_pending"
  | "approved"
  | "rejected"
  | "s1_open"
  | "s1_passed"
  | "s1_failed"
  | "s2_open"
  | "s2_passed"
  | "s2_failed"
  | "s3_open"
  | "s3_grading"
  | "s3_review"
  | "s3_passed"
  | "s3_failed"
  | "s4_scheduled"
  | "s4_done"
  | "s4_passed"
  | "s4_failed"
  | "certified"
  | "expired"
  | "retake_wait";

export interface IoTTrackMetadata {
  boards_used?: string[];
  sensors_used?: string[];
  protocols_used?: string[];
  has_hardware_or_lab_access?: boolean;
  past_hardware_project_url?: string;
}

export interface RoboticsTrackMetadata {
  tools_used?: string[];
  python_comfort?: number;
  cpp_comfort?: number;
  robot_project_url?: string;
  has_physical_robot_or_lab_access?: boolean;
}

export type TrackMetadata = IoTTrackMetadata & RoboticsTrackMetadata & Record<string, unknown>;

export interface Profile {
  id: string;
  user_id: string;
  role: UserRole;
  full_name: string;
  country: string | null;
  institution_id: string | null;
  other_institution_name: string | null;
  phone: string | null;
  github_url: string | null;
  years_experience: number | null;
  self_declared_strengths: string | null;
  time_zone: string | null;
  weekly_availability_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface Institution {
  id: string;
  name: string;
  country: string;
  partner_code: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Cohort {
  id: string;
  name: string;
  institution_id: string | null;
  track: Track;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Application {
  id: string;
  user_id: string;
  track: Track;
  cohort_id: string | null;
  status: ApplicationStatus;
  current_stage: number;
  score: number | null;
  track_metadata: TrackMetadata;
  consent_at: string;
  consent_version: string;
  created_at: string;
  updated_at: string;
}

export interface IdDocument {
  id: string;
  application_id: string;
  storage_path: string;
  document_number_hash: string;
  name_on_id: string;
  file_size_bytes: number;
  mime_type: string;
  is_current: boolean;
  verified_by: string | null;
  verified_at: string | null;
  decision: "approved" | "rejected" | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  id: string;
  key: string;
  value: Record<string, unknown>;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const TRACK_LABELS: Record<Track, string> = {
  ai: "Artificial Intelligence (AI)",
  iot: "Internet of Things (IoT)",
  robotics: "Robotics",
};

export const STATUS_DESCRIPTIONS: Record<
  ApplicationStatus,
  { label: string; summary: string; badgeClass: string }
> = {
  registered: {
    label: "Step 1 of 2: Upload Government ID",
    summary: "Your profile is saved. Please upload a clear photo or PDF of your government ID to complete Stage 0.",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
  },
  id_pending: {
    label: "Identity Verification Pending",
    summary: "Your government ID has been uploaded and is waiting for an administrator to review it.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  approved: {
    label: "Identity Approved — Stage 1 Unlocked",
    summary: "Your identity has been verified. You are approved to begin Stage 1 (Foundation Screen).",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  rejected: {
    label: "Identity Verification Needs Attention",
    summary: "Your ID document could not be verified. Please review the reason below and upload a clearer ID.",
    badgeClass: "bg-red-100 text-red-900 border-red-300",
  },
  s1_open: {
    label: "Stage 1 In Progress",
    summary: "Foundation screen is currently open.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s1_passed: {
    label: "Stage 1 Passed",
    summary: "You passed the Foundation screen. Stage 2 (Technical Exam) is unlocked.",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  s1_failed: {
    label: "Stage 1 Not Passed",
    summary: "You did not reach the minimum score for Stage 1.",
    badgeClass: "bg-red-100 text-red-900 border-red-300",
  },
  s2_open: {
    label: "Stage 2 In Progress",
    summary: "Technical exam is currently open.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s2_passed: {
    label: "Stage 2 Passed",
    summary: "You passed the Technical exam. Stage 3 (Practical Project) is unlocked.",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  s2_failed: {
    label: "Stage 2 Not Passed",
    summary: "You did not reach the minimum score for Stage 2.",
    badgeClass: "bg-red-100 text-red-900 border-red-300",
  },
  s3_open: {
    label: "Stage 3 In Progress",
    summary: "Practical project is currently open.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s3_grading: {
    label: "Stage 3 Automated Grading",
    summary: "Your project submission is in the grading queue.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s3_review: {
    label: "Stage 3 Under Review",
    summary: "Your project is being scored by reviewers.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s3_passed: {
    label: "Stage 3 Passed",
    summary: "You passed the Practical project. Stage 4 (Live Defence) is unlocked.",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  s3_failed: {
    label: "Stage 3 Not Passed",
    summary: "You did not reach the minimum score for Stage 3.",
    badgeClass: "bg-red-100 text-red-900 border-red-300",
  },
  s4_scheduled: {
    label: "Stage 4 Scheduled",
    summary: "Your live technical defence is scheduled.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s4_done: {
    label: "Stage 4 Completed",
    summary: "Your live technical defence is complete and awaiting final scoring.",
    badgeClass: "bg-blue-100 text-blue-900 border-blue-300",
  },
  s4_passed: {
    label: "Stage 4 Passed",
    summary: "You passed the live technical defence. Awaiting final credential approval.",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  s4_failed: {
    label: "Stage 4 Not Passed",
    summary: "You did not reach the minimum score for Stage 4.",
    badgeClass: "bg-red-100 text-red-900 border-red-300",
  },
  certified: {
    label: "Certified",
    summary: "Congratulations! Your credential has been issued and is publicly verifiable.",
    badgeClass: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  expired: {
    label: "Credential Expired",
    summary: "Your 24-month certification period has ended.",
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
  },
  retake_wait: {
    label: "Retake Waiting Period",
    summary: "You may retake the failed stage after the 60-day waiting period.",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
  },
};

