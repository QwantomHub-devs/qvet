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

export type QuestionDifficulty = "easy" | "medium" | "hard";
export type QuestionType = "mcq" | "numeric" | "code_reading";

export interface QuestionOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  track: Track;
  stage: number;
  domain: string;
  difficulty: QuestionDifficulty;
  type: QuestionType;
  stem: string;
  code_snippet: string | null;
  options: QuestionOption[] | null;
  tolerance: number;
  active: boolean;
  times_used: number;
  times_correct: number;
  created_at: string;
  updated_at: string;
}

export interface ServedQuestion {
  attempt_id: string;
  question_index: number;
  total_questions: number;
  question_id: string;
  domain: string;
  type: QuestionType;
  stem: string;
  code_snippet: string | null;
  options: QuestionOption[] | null;
  deadline_at: string;
  remaining_seconds: number;
}

export interface ExamBlueprint {
  id: string;
  track: Track;
  stage: number;
  domain: string;
  count: number;
  easy_pct: number;
  medium_pct: number;
  hard_pct: number;
  created_at: string;
  updated_at: string;
}

export interface DomainScoreBreakdown {
  correct: number;
  total: number;
  percent: number;
}

export interface ExamAttempt {
  id: string;
  application_id: string;
  stage: number;
  started_at: string;
  deadline_at: string;
  finished_at: string | null;
  question_ids: string[];
  current_index: number;
  score: number | null;
  domain_scores: Record<string, DomainScoreBreakdown>;
  status: "in_progress" | "submitted" | "timed_out" | "reset_by_admin";
  created_at: string;
  updated_at: string;
}

export interface StageResult {
  id: string;
  application_id: string;
  stage: number;
  raw_score: number;
  percent: number;
  passed: boolean;
  details: {
    attempt_id?: string;
    total_questions?: number;
    correct_count?: number;
    attempt_status?: string;
    domain_scores?: Record<string, DomainScoreBreakdown>;
    part_a_rubric_avg?: number;
    part_a_percent?: number;
    part_b_rubric_avg?: number;
    part_b_percent?: number;
    part_c_percent?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface IntegrityEvent {
  id: string;
  attempt_ref: string;
  application_id: string;
  type: "tab_hidden" | "fullscreen_exit" | "flagged_similarity" | "late_paste";
  at: string;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Stage1Prompt {
  id: string;
  track: Track;
  stage: number;
  kind: "text" | "video";
  title: string;
  prompt_text: string;
  target_words: number;
  max_duration_seconds: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Stage1Response {
  id: string;
  application_id: string;
  prompt_id: string;
  kind: "text" | "video";
  text: string | null;
  word_count: number;
  storage_path: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  duration_seconds: number | null;
  started_at: string;
  deadline_at: string;
  last_saved_at: string;
  submitted_at: string | null;
  locked: boolean;
  final_rubric_avg: number | null;
  final_percent: number | null;
  created_at: string;
  updated_at: string;
}

export interface RubricCriterion {
  id: string;
  rubric_id?: string;
  slug: string;
  criterion: string;
  weight: number;
  scale_min: number;
  scale_max: number;
  anchors: Record<string, string>;
  sort_order: number;
}

export interface Rubric {
  id: string;
  stage?: number;
  track?: string;
  part?: string;
  title: string;
  description: string | null;
  criteria: RubricCriterion[];
}

export interface ReviewerQueueItem {
  assignment_id: string;
  stage: number;
  part: "s1_text" | "s1_video" | "s3_project" | "s4_defence";
  review_round: 1 | 2 | 3;
  is_second_review: boolean;
  is_third_review: boolean;
  status: "assigned" | "submitted" | "cancelled";
  avg_score: number | null;
  due_at: string;
  submitted_at: string | null;
  anonymous_candidate_ref: string;
  track: Track;
  response_id: string;
  response_kind: "text" | "video";
  response_text: string | null;
  word_count: number;
  storage_path: string | null;
  mime_type: string | null;
  duration_seconds: number | null;
  response_submitted_at: string | null;
  prompt_title: string;
  prompt_text: string;
  rubric: Rubric | null;
  my_scores: Array<{
    criterion_id: string;
    score: number;
    comment: string | null;
  }>;
  peer_reviews: Array<{
    assignment_id: string;
    review_round: number;
    avg_score: number;
    submitted_at: string;
  }>;
}

export const DOMAIN_LABELS: Record<string, string> = {
  python_data: "Python & Data Handling",
  stats_ml: "Statistics & ML Fundamentals",
  eval_debugging: "Evaluation & Debugging",
  dl_nlp: "Deep Learning & NLP Basics",
  llm_apps: "LLM Applications",
  eng_practice: "Engineering Practice",
  logic_patterns: "Logic & Patterns",
  probability_numeracy: "Probability & Numeracy",
  charts_data: "Reading Charts & Data",
};

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

