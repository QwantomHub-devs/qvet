import { describe, expect, it } from "vitest";
import {
  checkUrlReachable,
  isValidHttpUrl,
  normalizeFullName,
  normalizePhone,
  normalizeUrl,
  validateOnboardingInput,
  type OnboardingInput,
} from "../src/lib/validation/onboarding";

const validInput: OnboardingInput = {
  fullName: "Chinedu Okafor",
  country: "Nigeria",
  phone: "+234 803 111 2222",
  githubUrl: "https://github.com/chinedu-okafor",
  yearsExperience: 2,
  selfDeclaredStrengths: "Python data cleaning, scikit-learn, RAG pipelines",
  timeZone: "Africa/Lagos",
  weeklyAvailabilityHours: 25,
  institutionId: "11111111-1111-1111-1111-111111111101",
  otherInstitutionName: null,
  track: "ai",
  cohortId: null,
  trackMetadata: {},
  consent: true,
};

describe("M1 Stage 0 Onboarding Validation & Reachability Checks", () => {
  it("normalizes names, phone numbers, and URLs consistently for duplicate detection", () => {
    expect(normalizeFullName("  Chinedu   Okafor ")).toBe("chinedu okafor");
    expect(normalizePhone("+234 (803) 111-2222")).toBe("+2348031112222");
    expect(normalizeUrl("HTTPS://GitHub.com/Chinedu-Okafor/// ")).toBe(
      "https://github.com/chinedu-okafor"
    );
  });

  it("validates HTTP/HTTPS URLs and rejects malformed links", () => {
    expect(isValidHttpUrl("https://github.com/user")).toBe(true);
    expect(isValidHttpUrl("ftp://github.com/user")).toBe(false);
    expect(isValidHttpUrl("not-a-url")).toBe(false);
  });

  it("accepts valid Stage 0 input and rejects missing consent or invalid fields", () => {
    expect(validateOnboardingInput(validInput)).toBeNull();
    expect(validateOnboardingInput({ ...validInput, consent: false })).toMatch(/consent/i);
    expect(validateOnboardingInput({ ...validInput, phone: "123" })).toMatch(/phone/i);
    expect(
      validateOnboardingInput({
        ...validInput,
        institutionId: null,
        otherInstitutionName: "",
      })
    ).toMatch(/institution/i);
  });

  it("verifies GitHub/portfolio URL reachability using HEAD request", async () => {
    const okFetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const notFoundFetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;
    const networkErrFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const resOk = await checkUrlReachable("https://github.com/octocat", okFetch);
    expect(resOk.ok).toBe(true);

    const res404 = await checkUrlReachable("https://github.com/nonexistent-404", notFoundFetch);
    expect(res404.ok).toBe(false);
    expect(res404.error).toMatch(/404/);

    const resNet = await checkUrlReachable("https://unreachable.example.com", networkErrFetch);
    expect(resNet.ok).toBe(false);
    expect(resNet.error).toMatch(/Could not reach/);
  });
});
