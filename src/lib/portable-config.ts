import type { FieldMapping, MappingTransform, PDFFieldInfo, UserProfile } from "./types";

export const PORTABLE_CONFIG_SCHEMA_VERSION = "healthpdf-portable-config-v1";

const PROFILE_KEYS: Array<keyof UserProfile> = [
  "patientName",
  "subscriberName",
  "subscriberContact",
  "dateOfBirth",
  "planName",
  "policyNumber",
  "memberId",
  "insuranceGroup",
  "patientAddress",
  "insurerName",
  "insurerEmail",
  "emailSubjectTemplate",
  "emailBodyTemplate",
];

const PDF_FIELD_TYPES = new Set(["text", "checkbox", "dropdown", "radio", "other"]);
const MAPPING_TRANSFORMS = new Set<MappingTransform>([
  "none",
  "date_month",
  "date_day",
  "date_year",
  "checkbox_truthy",
  "checkbox_equals",
]);
const MAPPING_SOURCES = new Set(["manual", "auto", "ai", "preset"]);

export interface HealthPdfPortableConfig {
  schemaVersion: typeof PORTABLE_CONFIG_SCHEMA_VERSION;
  app: "HealthPDF";
  exportedAt: string;
  templateName: string;
  templatePdfBase64: string;
  templateByteLength: number;
  profile: UserProfile;
  pdfFields: PDFFieldInfo[];
  mappings: FieldMapping[];
}

export interface PortableConfigBuildInput {
  profile: UserProfile;
  pdfFields: PDFFieldInfo[];
  mappings: FieldMapping[];
  templateName: string;
  templateBytes: Uint8Array;
  exportedAt?: string;
}

export type PortableConfigParseResult =
  | { ok: true; config: HealthPdfPortableConfig }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasValidIsoDate(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isBase64Text(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeProfile(profile: UserProfile): UserProfile {
  const normalized = {} as UserProfile;
  for (const key of PROFILE_KEYS) {
    normalized[key] = typeof profile[key] === "string" ? profile[key] : "";
  }
  return normalized;
}

function normalizePdfFields(fields: PDFFieldInfo[]): PDFFieldInfo[] {
  return fields
    .filter((field) => field?.name && PDF_FIELD_TYPES.has(field.type))
    .map((field) => ({
      name: field.name,
      type: field.type,
    }));
}

function normalizeMappings(mappings: FieldMapping[]): FieldMapping[] {
  return mappings
    .filter((mapping) => mapping?.pdfFieldName && mapping?.claimDataKey)
    .map((mapping) => {
      const normalized: FieldMapping = {
        pdfFieldName: mapping.pdfFieldName,
        claimDataKey: mapping.claimDataKey,
      };

      if (mapping.transform && MAPPING_TRANSFORMS.has(mapping.transform)) {
        normalized.transform = mapping.transform;
      }
      if (typeof mapping.staticValue === "string") {
        normalized.staticValue = mapping.staticValue;
      }
      if (typeof mapping.confidence === "number" && Number.isFinite(mapping.confidence)) {
        normalized.confidence = mapping.confidence;
      }
      if (mapping.source && MAPPING_SOURCES.has(mapping.source)) {
        normalized.source = mapping.source;
      }
      if (typeof mapping.reason === "string") {
        normalized.reason = mapping.reason;
      }

      return normalized;
    });
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function buildPortableConfig({
  profile,
  pdfFields,
  mappings,
  templateName,
  templateBytes,
  exportedAt = new Date().toISOString(),
}: PortableConfigBuildInput): HealthPdfPortableConfig {
  return {
    schemaVersion: PORTABLE_CONFIG_SCHEMA_VERSION,
    app: "HealthPDF",
    exportedAt,
    templateName: templateName || "claim-form-template.pdf",
    templatePdfBase64: bytesToBase64(templateBytes),
    templateByteLength: templateBytes.byteLength,
    profile: normalizeProfile(profile),
    pdfFields: normalizePdfFields(pdfFields),
    mappings: normalizeMappings(mappings),
  };
}

export function validatePortableConfig(value: unknown): string[] {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return ["Config must be a JSON object."];
  }

  if (value.schemaVersion !== PORTABLE_CONFIG_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(value.schemaVersion || "")}`);
  }
  if (value.app !== "HealthPDF") {
    errors.push("Config app must be HealthPDF.");
  }
  if (!hasValidIsoDate(value.exportedAt)) {
    errors.push("Config exportedAt must be an ISO timestamp.");
  }
  if (typeof value.templateName !== "string" || !value.templateName.trim()) {
    errors.push("Config templateName is required.");
  }
  if (typeof value.templatePdfBase64 !== "string" || !value.templatePdfBase64.trim()) {
    errors.push("Config templatePdfBase64 is required.");
  } else if (!isBase64Text(value.templatePdfBase64)) {
    errors.push("Config templatePdfBase64 is not valid base64.");
  } else {
    try {
      const bytes = base64ToBytes(value.templatePdfBase64);
      if (bytes.byteLength === 0) {
        errors.push("Config templatePdfBase64 decoded to an empty file.");
      }
      if (
        typeof value.templateByteLength === "number" &&
        Number.isFinite(value.templateByteLength) &&
        value.templateByteLength !== bytes.byteLength
      ) {
        errors.push("Config templateByteLength does not match decoded template bytes.");
      }
    } catch {
      errors.push("Config templatePdfBase64 is not valid base64.");
    }
  }
  if (typeof value.templateByteLength !== "number" || value.templateByteLength <= 0) {
    errors.push("Config templateByteLength must be a positive number.");
  }

  if (!isRecord(value.profile)) {
    errors.push("Config profile must be an object.");
  } else {
    for (const key of PROFILE_KEYS) {
      if (typeof value.profile[key] !== "string") {
        errors.push(`Config profile.${key} must be a string.`);
      }
    }
  }

  if (!Array.isArray(value.pdfFields)) {
    errors.push("Config pdfFields must be an array.");
  } else {
    value.pdfFields.forEach((field, index) => {
      if (!isRecord(field)) {
        errors.push(`Config pdfFields[${index}] must be an object.`);
        return;
      }
      if (typeof field.name !== "string" || !field.name.trim()) {
        errors.push(`Config pdfFields[${index}].name is required.`);
      }
      if (typeof field.type !== "string" || !PDF_FIELD_TYPES.has(field.type)) {
        errors.push(`Config pdfFields[${index}].type is invalid.`);
      }
    });
  }

  if (!Array.isArray(value.mappings)) {
    errors.push("Config mappings must be an array.");
  } else {
    value.mappings.forEach((mapping, index) => {
      if (!isRecord(mapping)) {
        errors.push(`Config mappings[${index}] must be an object.`);
        return;
      }
      if (typeof mapping.pdfFieldName !== "string" || !mapping.pdfFieldName.trim()) {
        errors.push(`Config mappings[${index}].pdfFieldName is required.`);
      }
      if (typeof mapping.claimDataKey !== "string" || !mapping.claimDataKey.trim()) {
        errors.push(`Config mappings[${index}].claimDataKey is required.`);
      }
      if (
        typeof mapping.transform === "string" &&
        !MAPPING_TRANSFORMS.has(mapping.transform as MappingTransform)
      ) {
        errors.push(`Config mappings[${index}].transform is invalid.`);
      }
      if (
        typeof mapping.source === "string" &&
        !MAPPING_SOURCES.has(mapping.source)
      ) {
        errors.push(`Config mappings[${index}].source is invalid.`);
      }
      if (
        mapping.confidence !== undefined &&
        (typeof mapping.confidence !== "number" || !Number.isFinite(mapping.confidence))
      ) {
        errors.push(`Config mappings[${index}].confidence must be a number.`);
      }
    });
  }

  return errors;
}

export function parsePortableConfigJson(text: string): PortableConfigParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Config file is not valid JSON."] };
  }

  const errors = validatePortableConfig(parsed);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, config: parsed as HealthPdfPortableConfig };
}
