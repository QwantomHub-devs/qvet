import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkUrlReachable,
  isValidHttpUrl,
  normalizeFullName,
  normalizePhone,
  normalizeUrl,
  validateOnboardingInput,
  type OnboardingInput,
} from "../src/lib/validation/onboarding.ts";

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
    assert.equal(normalizeFullName("  Chinedu   Okafor "), "chinedu okafor");
    assert.equal(normalizePhone("+234 (803) 111-2222"), "+2348031112222");
    assert.equal(
      normalizeUrl("HTTPS://GitHub.com/Chinedu-Okafor/// "),
      "https://github.com/chinedu-okafor"
    );
  });

  it("validates HTTP/HTTPS URLs and rejects malformed links", () => {
    assert.equal(isValidHttpUrl("https://github.com/user"), true);
    assert.equal(isValidHttpUrl("ftp://github.com/user"), false);
    assert.equal(isValidHttpUrl("not-a-url"), false);
  });

  it("accepts valid Stage 0 input and rejects missing consent or invalid fields", () => {
    assert.equal(validateOnboardingInput(validInput), null);
    assert.match(validateOnboardingInput({ ...validInput, consent: false }) ?? "", /consent/i);
    assert.match(validateOnboardingInput({ ...validInput, phone: "123" }) ?? "", /phone/i);
    assert.match(
      validateOnboardingInput({
        ...validInput,
        institutionId: null,
        otherInstitutionName: "",
      }) ?? "",
      /institution/i
    );
  });

  it("verifies GitHub/portfolio URL reachability using HEAD request", async () => {
    const okFetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const notFoundFetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;
    const networkErrFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const resOk = await checkUrlReachable("https://github.com/octocat", okFetch);
    assert.equal(resOk.ok, true);

    const res404 = await checkUrlReachable("https://github.com/nonexistent-404", notFoundFetch);
    assert.equal(res404.ok, false);
    assert.match(res404.error ?? "", /404/);

    const resNet = await checkUrlReachable("https://unreachable.example.com", networkErrFetch);
    assert.equal(resNet.ok, false);
    assert.match(resNet.error ?? "", /Could not reach/);
  });
});

