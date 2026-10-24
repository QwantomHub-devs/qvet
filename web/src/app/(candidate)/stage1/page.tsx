import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { Stage1RunnerClient } from "@/components/Stage1RunnerClient";
import type {
  Application,
  Stage1Prompt,
  Stage1Response,
  ServedQuestion,
  StageResult,
} from "@/lib/types/database";

export default async function CandidateStage1Page() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: appData } = await supabase
    .from("applications")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const application = (appData as Application | null) ?? null;
  if (!application) {
    redirect("/dashboard");
  }

  // Call start_stage1 to transition approved -> s1_open if needed and load current responses
  await supabase.rpc("start_stage1", { p_application_id: application.id });

  const { data: responsesData } = await supabase
    .from("responses")
    .select("*")
    .eq("application_id", application.id);

  const responses = (responsesData as Stage1Response[] | null) ?? [];
  const textResponse = responses.find((r) => r.kind === "text") ?? null;
  const videoResponse = responses.find((r) => r.kind === "video") ?? null;

  let textPrompt: Stage1Prompt | null = null;
  if (textResponse) {
    const { data: tp } = await supabase
      .from("prompts")
      .select("*")
      .eq("id", textResponse.prompt_id)
      .maybeSingle();
    textPrompt = (tp as Stage1Prompt | null) ?? null;
  }

  let videoPrompt: Stage1Prompt | null = null;
  if (videoResponse) {
    const { data: vp } = await supabase
      .from("prompts")
      .select("*")
      .eq("id", videoResponse.prompt_id)
      .maybeSingle();
    videoPrompt = (vp as Stage1Prompt | null) ?? null;
  }

  const nowMs = Date.now();
  const textRemainingSeconds = textResponse
    ? Math.max(0, Math.floor((new Date(textResponse.deadline_at).getTime() - nowMs) / 1000))
    : 900;

  const videoRemainingSeconds = videoResponse
    ? Math.max(0, Math.floor((new Date(videoResponse.deadline_at).getTime() - nowMs) / 1000))
    : 600;

  const { data: logicAttemptData } = await supabase
    .from("exam_attempts")
    .select("*")
    .eq("application_id", application.id)
    .eq("stage", 1)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let initialLogicAttempt: {
    id: string;
    status: string;
    current_index: number;
    total_questions: number;
    remaining_seconds: number;
    score: number | null;
  } | null = null;
  let initialLogicQuestion: ServedQuestion | null = null;

  if (logicAttemptData) {
    const remSec = Math.max(
      0,
      Math.floor((new Date(logicAttemptData.deadline_at).getTime() - nowMs) / 1000)
    );
    initialLogicAttempt = {
      id: logicAttemptData.id,
      status: logicAttemptData.status,
      current_index: logicAttemptData.current_index,
      total_questions: Array.isArray(logicAttemptData.question_ids)
        ? logicAttemptData.question_ids.length
        : 15,
      remaining_seconds: remSec,
      score: logicAttemptData.score,
    };

    if (logicAttemptData.status === "in_progress") {
      const { data: qData } = await supabase.rpc("get_question", {
        p_attempt_id: logicAttemptData.id,
        p_index: logicAttemptData.current_index,
      });
      if (qData) {
        initialLogicQuestion = qData as ServedQuestion;
      }
    }
  }

  const { data: stage1ResultData } = await supabase
    .from("stage_results")
    .select("*")
    .eq("application_id", application.id)
    .eq("stage", 1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-4xl">
      <Stage1RunnerClient
        applicationId={application.id}
        initialTextResponse={textResponse}
        initialTextPrompt={textPrompt}
        initialTextRemainingSeconds={textRemainingSeconds}
        initialVideoResponse={videoResponse}
        initialVideoPrompt={videoPrompt}
        initialVideoRemainingSeconds={videoRemainingSeconds}
        initialLogicAttempt={initialLogicAttempt}
        initialLogicQuestion={initialLogicQuestion}
        stage1Result={(stage1ResultData as StageResult | null) ?? null}
      />
    </div>
  );
}

