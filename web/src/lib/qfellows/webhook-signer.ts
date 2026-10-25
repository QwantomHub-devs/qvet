import crypto from "node:crypto";

/**
 * Computes an HMAC-SHA256 signature for a raw UTF-8 string or buffer.
 * Returns a lowercase hex string.
 */
export function computeHmacSignature(
  rawBody: string | Buffer,
  secret: string
): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * Performs timing-safe comparison of an incoming HMAC-SHA256 signature against the raw body.
 * Supports signatures prefixed with "sha256=" or raw hex string.
 */
export function verifyHmacSignature(
  rawBody: string | Buffer,
  secret: string,
  signatureHeader?: string | null
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  // Normalize header: strip optional "sha256=" prefix and trim
  const cleanSig = signatureHeader.replace(/^sha256=/i, "").trim().toLowerCase();
  const expectedSig = computeHmacSignature(rawBody, secret).toLowerCase();

  const cleanBuf = Buffer.from(cleanSig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");

  if (cleanBuf.length === 0 || cleanBuf.length !== expectedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(cleanBuf, expectedBuf);
}

export interface InviteTokenPayload {
  applicationId: string;
  email: string;
  track: string;
  expiresAt: number;
}

/**
 * Generates a signed, stateless invite token for candidate onboarding handoff.
 */
export function createSignedInviteToken(
  payload: Omit<InviteTokenPayload, "expiresAt"> & { expiresInSeconds?: number },
  secret: string
): string {
  const expiresInSeconds = payload.expiresInSeconds ?? 60 * 60 * 24 * 30; // 30 days default
  const tokenPayload: InviteTokenPayload = {
    applicationId: payload.applicationId,
    email: payload.email.toLowerCase().trim(),
    track: payload.track,
    expiresAt: Math.floor(Date.now() / 1000) + expiresInSeconds,
  };

  const payloadB64 = Buffer.from(JSON.stringify(tokenPayload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Validates a signed invite token and returns the parsed payload if valid and unexpired.
 */
export function verifySignedInviteToken(
  token: string,
  secret: string
): { valid: boolean; data?: InviteTokenPayload; error?: string } {
  if (!token || !secret) {
    return { valid: false, error: "Missing token or secret" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, error: "Malformed token" };
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return { valid: false, error: "Invalid token structure" };
  }

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length === 0 || sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: "Invalid signature" };
  }

  try {
    const rawJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload = JSON.parse(rawJson) as InviteTokenPayload;

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.expiresAt && payload.expiresAt < nowSeconds) {
      return { valid: false, error: "Invite token has expired" };
    }

    return { valid: true, data: payload };
  } catch {
    return { valid: false, error: "Corrupted token payload" };
  }
}
