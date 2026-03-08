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
  const rawName = field.name.toLowerCase();
  if (!hasAny(name, baseNeedles)) return null;

  const hasCompactDatePattern =
    name.includes("mmddyyyy") || name.includes("mmddyy");
  const suffixMatch = rawName.match(/_(\d+)\s*$/);
  const suffix = suffixMatch ? Number(suffixMatch[1]) : -1;
  if (hasCompactDatePattern) {
    const transform =
      suffix === 2 ? "date_year" : suffix === 1 ? "date_day" : "date_month";
    return {
      pdfFieldName: field.name,
      claimDataKey: "dateOfBirth",
      transform,
      confidence: 0.99,
      source: "preset",
      reason: "Preset matched split date by mm/dd/yyyy suffix pattern",
    };
  }

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

    const claimTypeCheckboxes: Array<{
      needles: string[];
      claimType: "lab" | "doctor_visit" | "hospital" | "imaging" | "pharmacy";
      reason: string;
    }> = [
      { needles: ["lab", "laboratory", "pathology"], claimType: "lab", reason: "Preset matched lab checkbox" },
      { needles: ["doctor", "physician", "officevisit", "clinicvisit"], claimType: "doctor_visit", reason: "Preset matched doctor visit checkbox" },
      { needles: ["hospital", "inpatient", "outpatient", "emergency"], claimType: "hospital", reason: "Preset matched hospital checkbox" },
      { needles: ["imaging", "xray", "mri", "ct", "ultrasound", "radiology"], claimType: "imaging", reason: "Preset matched imaging checkbox" },
      { needles: ["pharmacy", "drug", "medication", "rx"], claimType: "pharmacy", reason: "Preset matched pharmacy checkbox" },
    ];
    for (const item of claimTypeCheckboxes) {
      if (hasAny(name, item.needles.map(normalize))) {
        return {
          pdfFieldName: field.name,
          claimDataKey: "claimType",
          transform: "checkbox_equals",
          staticValue: item.claimType,
          confidence: 0.97,
          source: "preset",
          reason: item.reason,
        };
      }
    }

    if (hasAny(name, ["foreign", "overseas", "outsideus", "outofcountry", "abroad"])) {
      return {
        pdfFieldName: field.name,
        claimDataKey: "foreignProvider",
        transform: "checkbox_truthy",
        confidence: 0.97,
        source: "preset",
        reason: "Preset matched foreign provider checkbox",
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

  if (hasAny(name, ["subscribername", "nameofsubscriber"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "subscriberName",
      transform: "none",
      confidence: 0.96,
      source: "preset",
      reason: "Preset matched subscriber name",
    };
  }

  if (hasAny(name, ["subscriberphone", "subscriberemail", "phoneoremail"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "subscriberContact",
      transform: "none",
      confidence: 0.95,
      source: "preset",
      reason: "Preset matched subscriber contact",
    };
  }

  if (hasAny(name, ["planname", "gehaplanname", "insuranceplan"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "planName",
      transform: "none",
      confidence: 0.95,
      source: "preset",
      reason: "Preset matched plan name",
    };
  }

  if (hasAny(name, ["country", "countryofservice", "servicecountry"])) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "serviceCountry",
      transform: "none",
      confidence: 0.9,
      source: "preset",
      reason: "Preset matched service country",
    };
  }

  if (
    hasAny(name, [
      "ifcheckedother",
      "additionalinfo",
      "additionalinformation",
      "comments",
      "remarks",
      "explanation",
      "brieflydescribeservicesrendered",
    ])
  ) {
    return {
      pdfFieldName: field.name,
      claimDataKey: "additionalNotes",
      transform: "none",
      confidence: 0.92,
      source: "preset",
      reason: "Preset matched additional notes area",
    };
  }

  return null;
}

