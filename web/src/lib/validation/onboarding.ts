import type { Track, TrackMetadata } from "../types/database.ts";

export interface OnboardingInput {
  fullName: string;
  country: string;
  phone: string;
  githubUrl: string;
  yearsExperience: number;
  selfDeclaredStrengths: string;
  timeZone: string;
  weeklyAvailabilityHours: number;
  institutionId: string | null;
  otherInstitutionName: string | null;
  track: Track;
  cohortId: string | null;
  trackMetadata: TrackMetadata;
  consent: boolean;
}

export function normalizeFullName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Verifies that a candidate's GitHub or portfolio link resolves over HTTP/HTTPS (Stage 0 automatic check).
 */
export async function checkUrlReachable(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidHttpUrl(url)) {
    return {
      ok: false,
      error: "Please enter a valid link starting with https:// or http://.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetchImpl(url.trim(), {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "TalentVettingPlatform-LinkChecker/1.0",
      },
    });

    if (response.ok || (response.status >= 300 && response.status < 400) || response.status === 405) {
      return { ok: true };
    }

    if (response.status === 404) {
      return {
        ok: false,
        error: `The link (${url}) returned 404 Not Found. Please check that your profile or repository is public.`,
      };
    }

    return {
      ok: false,
      error: `The link (${url}) could not be verified (HTTP ${response.status}).`,
    };
  } catch {
    return {
      ok: false,
      error: `Could not reach ${url}. Please check the address and make sure it is publicly accessible.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function validateOnboardingInput(input: OnboardingInput): string | null {
  if (!input.consent) {
    return "You must agree to the data processing and employer profile sharing consent.";
  }
  if (!input.fullName || input.fullName.trim().length < 2) {
    return "Please enter your full legal name as shown on your government ID.";
  }
  if (!input.country || input.country.trim().length < 2) {
    return "Please enter your country.";
  }
  if (normalizePhone(input.phone).length < 7) {
    return "Please enter a valid phone number.";
  }
  if (!isValidHttpUrl(input.githubUrl)) {
    return "Please enter a valid GitHub or portfolio link starting with https://.";
  }
  if (Number.isNaN(input.yearsExperience) || input.yearsExperience < 0 || input.yearsExperience > 60) {
    return "Years of experience must be between 0 and 60.";
  }
  if (!input.selfDeclaredStrengths || input.selfDeclaredStrengths.trim().length < 10) {
    return "Please describe your technical strengths (at least 10 characters).";
  }
  if (!input.timeZone || input.timeZone.trim().length < 2) {
    return "Please select or enter your time zone.";
  }
  if (
    Number.isNaN(input.weeklyAvailabilityHours) ||
    input.weeklyAvailabilityHours < 1 ||
    input.weeklyAvailabilityHours > 168
  ) {
    return "Weekly availability must be between 1 and 168 hours.";
  }
  if (!input.institutionId && (!input.otherInstitutionName || input.otherInstitutionName.trim().length < 2)) {
    return "Please select your institution from the list, or choose Other / Independent and enter the name.";
  }
  if (!["ai", "iot", "robotics"].includes(input.track)) {
    return "Please choose a valid track (AI, IoT, or Robotics).";
  }
  return null;
}

