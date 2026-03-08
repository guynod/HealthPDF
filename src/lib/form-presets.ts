import { PDFFieldInfo, FieldMapping } from "./types";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function mapDatePart(
  field: PDFFieldInfo,
  baseNeedles: string[],
  monthNeedles: string[],
  dayNeedles: string[],
  yearNeedles: string[]
): FieldMapping | null {
  const name = normalize(field.name);
  if (!hasAny(name, baseNeedles)) return null;

  if (hasAny(name, monthNeedles)) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "dateOfBirth",
      transform: "date_month",
      confidence: 0.99,
      source: "preset",
      reason: "Preset matched date month field",
    };
  }
  if (hasAny(name, dayNeedles)) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "dateOfBirth",
      transform: "date_day",
      confidence: 0.99,
      source: "preset",
      reason: "Preset matched date day field",
    };
  }
  if (hasAny(name, yearNeedles)) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "dateOfBirth",
      transform: "date_year",
      confidence: 0.99,
      source: "preset",
      reason: "Preset matched date year field",
    };
  }

  return null;
}

export function getPresetMappingForField(field: PDFFieldInfo): FieldMapping | null {
  const name = normalize(field.name);

  const dobPart = mapDatePart(
    field,
    ["dob", "dateofbirth", "birthdate", "birthday"],
    ["month", "mm", "mo"],
    ["day", "dd"],
    ["year", "yyyy", "yy"]
  );
  if (dobPart) return dobPart;

  const serviceDatePart = mapDatePart(
    field,
    ["dateofservice", "service", "treatmentdate", "visitdate"],
    ["month", "mm", "mo"],
    ["day", "dd"],
    ["year", "yyyy", "yy"]
  );
  if (serviceDatePart) {
    return { ...serviceDatePart, claimDataKey: "dateOfService" };
  }

  if (field.type === "checkbox") {
    if (name.includes("male")) {
      return {
        pdfFieldName: field.name,
        claimDataKey: "gender",
        transform: "checkbox_equals",
        staticValue: "male",
        confidence: 0.99,
        source: "preset",
        reason: "Preset matched gender male checkbox",
      };
    }
    if (name.includes("female")) {
      return {
        pdfFieldName: field.name,
        claimDataKey: "gender",
        transform: "checkbox_equals",
        staticValue: "female",
        confidence: 0.99,
        source: "preset",
        reason: "Preset matched gender female checkbox",
      };
    }
  }

  if (hasAny(name, ["groupnumber", "groupid", "groupno", "grp"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "insuranceGroup",
      transform: "none",
      confidence: 0.97,
      source: "preset",
      reason: "Preset matched insurance group field",
    };
  }

  if (hasAny(name, ["memberid", "subscriberid", "insuredid", "memberno"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "memberId",
      transform: "none",
      confidence: 0.97,
      source: "preset",
      reason: "Preset matched member ID field",
    };
  }

  if (hasAny(name, ["policynumber", "policyno", "policyid"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "policyNumber",
      transform: "none",
      confidence: 0.97,
      source: "preset",
      reason: "Preset matched policy number field",
    };
  }

  if (hasAny(name, ["insuredname", "patientname", "membername"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "patientName",
      transform: "none",
      confidence: 0.93,
      source: "preset",
      reason: "Preset matched patient/insured name",
    };
  }

  return null;
}

