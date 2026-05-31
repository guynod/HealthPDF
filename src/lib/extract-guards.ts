import type { ValidationWarning } from "./types";

export const DEFAULT_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export interface UploadMeta {
  type?: string;
  size: number;
}

export interface UploadValidationResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function maxUploadBytesFromEnv(env: Record<string, string | undefined>): number {
  const configured = Number(env.HEALTHPDF_MAX_UPLOAD_MB || "");
  return Number.isFinite(configured) && configured > 0
    ? configured * 1024 * 1024
    : DEFAULT_MAX_UPLOAD_BYTES;
}

export function providerLookupEnabledFromEnv(
  env: Record<string, string | undefined>
): boolean {
  return env.HEALTHPDF_ENABLE_PROVIDER_LOOKUP === "true";
}

export function safeParsePdfFields(value: FormDataEntryValue | null): unknown[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (field) =>
          field &&
          typeof field === "object" &&
          typeof field.name === "string" &&
          typeof field.type === "string"
      )
      .slice(0, 300);
  } catch {
    return [];
  }
}

export function validateUpload(
  file: UploadMeta,
  env: Record<string, string | undefined>
): UploadValidationResult {
  const mimeType = file.type || "application/octet-stream";
  if (!ALLOWED_UPLOAD_TYPES.has(mimeType)) {
    return {
      ok: false,
      status: 400,
      error: "Unsupported receipt type. Upload a PDF, JPG, PNG, WebP, or HEIC image.",
    };
  }

  const uploadLimit = maxUploadBytesFromEnv(env);
  if (file.size > uploadLimit) {
    return {
      ok: false,
      status: 413,
      error: `Receipt is too large. Maximum upload size is ${Math.round(
        uploadLimit / 1024 / 1024
      )} MB.`,
    };
  }

  return { ok: true };
}

export function inferForeignProvider(
  existing: string,
  serviceCountry: string,
  currency: string
): string {
  if (existing) return existing;

  const normalizedCurrency = currency.toUpperCase();
  const hint = `${serviceCountry} ${currency}`.toLowerCase();
  return Boolean(normalizedCurrency && normalizedCurrency !== "USD") ||
    /(thailand|israel|japan|europe|france|spain|germany|uk|united kingdom|mexico|canada|australia)/i.test(
      hint
    )
    ? "yes"
    : "no";
}

export function normalizeValidationWarnings(parsed: unknown): ValidationWarning[] {
  const candidate =
    parsed && typeof parsed === "object"
      ? (parsed as { validationWarnings?: unknown }).validationWarnings
      : undefined;

  if (!Array.isArray(candidate)) return [];

  return candidate.filter(
    (warning): warning is ValidationWarning =>
      warning &&
      typeof warning === "object" &&
      typeof (warning as ValidationWarning).code === "string" &&
      typeof (warning as ValidationWarning).message === "string"
  );
}
