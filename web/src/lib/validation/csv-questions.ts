import type { QuestionDifficulty, QuestionOption, QuestionType, Track } from "../types/database.ts";

export interface ImportedQuestionItem {
  track: Track;
  stage: number;
  domain: string;
  difficulty: QuestionDifficulty;
  type: QuestionType;
  stem: string;
  code_snippet: string | null;
  options: QuestionOption[] | null;
  tolerance: number;
  correct: string;
  explanation: string | null;
  active: boolean;
}

/**
 * RFC-4180 compliant CSV row splitter supporting quoted cells and escaped quotes.
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Parses and validates CSV question import text.
 * Expected columns:
 * track,stage,domain,difficulty,type,stem,code_snippet,option_a,option_b,option_c,option_d,correct,tolerance,explanation
 */
export function parseQuestionsCsv(csvText: string): {
  ok: boolean;
  items?: ImportedQuestionItem[];
  error?: string;
} {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    return {
      ok: false,
      error: "CSV must include a header row and at least one question row.",
    };
  }

  const headers = parseCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const requiredHeaders = ["track", "domain", "difficulty", "type", "stem", "correct"];
  for (const req of requiredHeaders) {
    if (!headers.includes(req)) {
      return {
        ok: false,
        error: `Missing required CSV column header: "${req}".`,
      };
    }
  }

  const colIndex = (name: string): number => headers.indexOf(name);
  const items: ImportedQuestionItem[] = [];

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cells = parseCsvLine(lines[rowIdx]!);
    const getCell = (name: string): string => {
      const idx = colIndex(name);
      return idx >= 0 && idx < cells.length ? (cells[idx] ?? "").trim() : "";
    };

    const track = getCell("track").toLowerCase() as Track;
    if (!["ai", "iot", "robotics"].includes(track)) {
      return { ok: false, error: `Row ${rowIdx + 1}: Invalid track "${track}".` };
    }

    const stageRaw = getCell("stage");
    const stage = stageRaw ? Number(stageRaw) : 2;
    if (stage !== 1 && stage !== 2) {
      return { ok: false, error: `Row ${rowIdx + 1}: Stage must be 1 or 2.` };
    }

    const domain = getCell("domain");
    if (!domain) {
      return { ok: false, error: `Row ${rowIdx + 1}: Domain is required.` };
    }

    const difficulty = getCell("difficulty").toLowerCase() as QuestionDifficulty;
    if (!["easy", "medium", "hard"].includes(difficulty)) {
      return {
        ok: false,
        error: `Row ${rowIdx + 1}: Difficulty must be easy, medium, or hard.`,
      };
    }

    const type = getCell("type").toLowerCase() as QuestionType;
    if (!["mcq", "numeric", "code_reading"].includes(type)) {
      return {
        ok: false,
        error: `Row ${rowIdx + 1}: Type must be mcq, numeric, or code_reading.`,
      };
    }

    const stem = getCell("stem");
    if (!stem) {
      return { ok: false, error: `Row ${rowIdx + 1}: Question stem is required.` };
    }

    const correct = getCell("correct");
    if (!correct) {
      return { ok: false, error: `Row ${rowIdx + 1}: Correct answer key is required.` };
    }

    const codeSnippet = getCell("code_snippet") || null;
    const explanation = getCell("explanation") || null;
    const toleranceRaw = getCell("tolerance");
    const tolerance = toleranceRaw ? Number(toleranceRaw) : 0;

    if (Number.isNaN(tolerance) || tolerance < 0) {
      return { ok: false, error: `Row ${rowIdx + 1}: Tolerance must be a non-negative number.` };
    }

    let options: QuestionOption[] | null = null;
    if (type === "mcq" || type === "code_reading") {
      const optA = getCell("option_a");
      const optB = getCell("option_b");
      const optC = getCell("option_c");
      const optD = getCell("option_d");
      if (!optA || !optB) {
        return {
          ok: false,
          error: `Row ${rowIdx + 1}: MCQ and code_reading questions require at least option_a and option_b.`,
        };
      }
      options = [
        { id: "A", text: optA },
        { id: "B", text: optB },
      ];
      if (optC) options.push({ id: "C", text: optC });
      if (optD) options.push({ id: "D", text: optD });
    }

    items.push({
      track,
      stage,
      domain,
      difficulty,
      type,
      stem,
      code_snippet: codeSnippet,
      options,
      tolerance,
      correct,
      explanation,
      active: true,
    });
  }

  return { ok: true, items };
}

