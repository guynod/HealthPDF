import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
} from "pdf-lib";
import {
  PDFFieldInfo,
  FieldMapping,
  ClaimData,
  MappingTransform,
  UserProfile,
} from "./types";

export async function discoverFields(
  pdfBytes: Uint8Array
): Promise<PDFFieldInfo[]> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  return fields.map((field) => {
    let type: PDFFieldInfo["type"] = "other";
    if (field instanceof PDFTextField) type = "text";
    else if (field instanceof PDFCheckBox) type = "checkbox";
    else if (field instanceof PDFDropdown) type = "dropdown";
    else if (field instanceof PDFRadioGroup) type = "radio";

    return {
      name: field.getName(),
      type,
    };
  });
}

export async function extractProfileDefaultsFromTemplate(
  pdfBytes: Uint8Array
): Promise<{ profile: Partial<UserProfile>; notes: string[] }> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  const profile: Partial<UserProfile> = {};
  const notes: string[] = [];

  const aliases: Record<
    keyof Pick<
      UserProfile,
      | "patientName"
      | "subscriberName"
      | "subscriberContact"
      | "dateOfBirth"
      | "planName"
      | "policyNumber"
      | "memberId"
      | "insuranceGroup"
      | "patientAddress"
      | "insurerName"
    >,
    string[]
  > = {
    patientName: ["patient", "insuredname", "subscribername", "membername", "fullname"],
    subscriberName: ["subscribername", "nameofsubscriber", "insuredname"],
    subscriberContact: ["subscriberphone", "subscriberemail", "phoneoremail", "contact"],
    dateOfBirth: ["dob", "birthdate", "dateofbirth", "birthday"],
    planName: ["planname", "plannumber", "gehaplanname"],
    policyNumber: ["policy", "policyno", "policynumber"],
    memberId: ["memberid", "subscriberid", "insuredid", "memberno"],
    insuranceGroup: ["group", "groupnumber", "groupno", "grp"],
    patientAddress: ["address", "street", "citystatezip"],
    insurerName: ["insurancecompany", "insurer", "planname", "carrier"],
  };

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  for (const field of fields) {
    if (!(field instanceof PDFTextField)) continue;
    const value = (field.getText() || "").trim();
    if (!value) continue;
    const name = normalize(field.getName());

    for (const key of Object.keys(aliases) as Array<keyof typeof aliases>) {
      if (profile[key]) continue;
      if (aliases[key].some((needle) => name.includes(normalize(needle)))) {
        profile[key] = value;
        notes.push(`Detected ${key} from template field "${field.getName()}".`);
      }
    }
  }

  return { profile, notes };
}

interface InvoiceAttachment {
  bytes: Uint8Array;
  mimeType: string;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function inferClaimType(value: string): string {
  const raw = (value || "").trim().toLowerCase();
  if (raw.includes("hospital") || raw.includes("outpatient") || raw.includes("inpatient")) {
    return "hospital";
  }
  if (raw.includes("lab") || raw.includes("laboratory") || raw.includes("pathology")) {
    return "lab";
  }
  if (raw.includes("xray") || raw.includes("x-ray") || raw.includes("imaging")) {
    return "imaging";
  }
  if (raw.includes("pharmacy") || raw.includes("rx") || raw.includes("prescription")) {
    return "pharmacy";
  }
  if (raw.includes("doctor") || raw.includes("clinic") || raw.includes("physician")) {
    return "doctor_visit";
  }
  if (
    raw === "lab" ||
    raw === "doctor_visit" ||
    raw === "hospital" ||
    raw === "imaging" ||
    raw === "pharmacy" ||
    raw === "other"
  ) {
    return raw;
  }
  return "";
}

function splitDateParts(value: string): { month: string; day: string; year: string } {
  const raw = value.trim();
  if (!raw) return { month: "", day: "", year: "" };

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return { month, day, year };
  }

  const digits = raw.replace(/[^\d]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (digits.length >= 3) {
    if (digits[0].length === 4) {
      return {
        year: digits[0].padStart(4, "0"),
        month: digits[1].padStart(2, "0").slice(-2),
        day: digits[2].padStart(2, "0").slice(-2),
      };
    }
    return {
      month: digits[0].padStart(2, "0").slice(-2),
      day: digits[1].padStart(2, "0").slice(-2),
      year: digits[2].padStart(4, "0").slice(-4),
    };
  }

  return { month: "", day: "", year: "" };
}

function transformValue(mapping: FieldMapping, claimData: ClaimData): string {
  const rawCandidate =
    mapping.staticValue !== undefined
      ? mapping.staticValue
      : claimData[mapping.claimDataKey] || "";
  const rawValue =
    typeof rawCandidate === "string"
      ? rawCandidate
      : rawCandidate === null || rawCandidate === undefined
        ? ""
        : String(rawCandidate);

  const transform: MappingTransform = mapping.transform || "none";

  if (transform === "date_month" || transform === "date_day" || transform === "date_year") {
    const parts = splitDateParts(claimData[mapping.claimDataKey] || rawValue);
    if (transform === "date_month") return parts.month;
    if (transform === "date_day") return parts.day;
    return parts.year;
  }

  return rawValue;
}

function shouldCheck(mapping: FieldMapping, value: string): boolean {
  const transform: MappingTransform = mapping.transform || "checkbox_truthy";
  const normalized = (value ?? "").toString().trim().toLowerCase();

  if (transform === "checkbox_equals") {
    return normalized === (mapping.staticValue || "").trim().toLowerCase();
  }

  if (!normalized) return false;
  if (
    normalized === "false" ||
    normalized === "no" ||
    normalized === "0" ||
    normalized === "unchecked" ||
    normalized === "none"
  ) {
    return false;
  }
  return true;
}

function normalizeDateMappings(mappings: FieldMapping[]): FieldMapping[] {
  const next = mappings.map((mapping) => ({ ...mapping }));
  const dateKeys: Array<"dateOfBirth" | "dateOfService"> = [
    "dateOfBirth",
    "dateOfService",
  ];

  const nameScore = (fieldName: string): { month: number; day: number; year: number } => {
    const name = fieldName.toLowerCase();
    return {
      month: Number(
        name.includes("month") ||
          name.includes("mm") ||
          name.includes("mo")
      ),
      day: Number(name.includes("day") || name.includes("dd")),
      year: Number(
        name.includes("year") || name.includes("yyyy") || name.includes("yy")
      ),
    };
  };

  for (const key of dateKeys) {
    const indexes = next
      .map((mapping, index) => ({ mapping, index }))
      .filter(
        ({ mapping }) =>
          mapping.claimDataKey === key &&
          (!mapping.transform || mapping.transform === "none") &&
          !mapping.staticValue
      );

    if (indexes.length < 3) continue;

    const sorted = [...indexes].sort((a, b) =>
      a.mapping.pdfFieldName.localeCompare(b.mapping.pdfFieldName)
    );
    const monthCandidate =
      sorted.find(({ mapping }) => nameScore(mapping.pdfFieldName).month > 0) || sorted[0];
    const dayCandidate =
      sorted.find(({ mapping }) => nameScore(mapping.pdfFieldName).day > 0 && mapping !== monthCandidate.mapping) ||
      sorted.find(({ mapping }) => mapping !== monthCandidate.mapping) ||
      sorted[1];
    const yearCandidate =
      sorted.find(
        ({ mapping }) =>
          nameScore(mapping.pdfFieldName).year > 0 &&
          mapping !== monthCandidate.mapping &&
          mapping !== dayCandidate.mapping
      ) ||
      sorted.find(
        ({ mapping }) =>
          mapping !== monthCandidate.mapping && mapping !== dayCandidate.mapping
      ) ||
      sorted[2];

    next[monthCandidate.index].transform = "date_month";
    next[dayCandidate.index].transform = "date_day";
    next[yearCandidate.index].transform = "date_year";
  }

  return next;
}

async function appendInvoicePages(
  pdfDoc: PDFDocument,
  attachment?: InvoiceAttachment
): Promise<void> {
  if (!attachment) return;

  if (attachment.mimeType === "application/pdf") {
    const invoiceDoc = await PDFDocument.load(attachment.bytes);
    const copiedPages = await pdfDoc.copyPages(invoiceDoc, invoiceDoc.getPageIndices());
    for (const page of copiedPages) pdfDoc.addPage(page);
    return;
  }

  if (
    attachment.mimeType === "image/jpeg" ||
    attachment.mimeType === "image/jpg" ||
    attachment.mimeType === "image/png"
  ) {
    const page = pdfDoc.addPage([595.28, 841.89]); // A4 portrait
    const image =
      attachment.mimeType === "image/png"
        ? await pdfDoc.embedPng(attachment.bytes)
        : await pdfDoc.embedJpg(attachment.bytes);

    const { width, height } = image.scale(1);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const scale = Math.min(pageWidth / width, pageHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
    return;
  }

  throw new Error(
    `Unsupported invoice attachment type for PDF append: ${attachment.mimeType}`
  );
}

async function fillFormBase(
  templateBytes: Uint8Array,
  claimData: ClaimData,
  mappings: FieldMapping[],
  flatten: boolean,
  invoiceAttachment?: InvoiceAttachment
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const normalizedMappings = normalizeDateMappings(mappings);
  const claimDataForFill: ClaimData = { ...claimData };
  const valueOverrides = new Map<string, string>();

  const overflowLines: string[] = [];
  for (const mapping of normalizedMappings) {
    const raw = transformValue(mapping, claimDataForFill).trim();
    if (!raw || mapping.transform !== "none") continue;
    const fieldNameNorm = mapping.pdfFieldName.toLowerCase();
    const key = mapping.claimDataKey;
    if (key !== "diagnosis" && key !== "description") continue;

    const isSmallField =
      fieldNameNorm.includes("diagnos") ||
      fieldNameNorm.includes("other") ||
      fieldNameNorm.includes("brief");
    if (!isSmallField) continue;

    const maxLen = key === "diagnosis" ? 24 : 40;
    if (raw.length > maxLen) {
      valueOverrides.set(mapping.pdfFieldName, raw.slice(0, maxLen).trim());
      overflowLines.push(
        `${key === "diagnosis" ? "Diagnosis" : "Service details"}: ${raw.slice(maxLen).trim()}`
      );
    }
  }
  if (overflowLines.length > 0) {
    claimDataForFill.additionalNotes = `${claimDataForFill.additionalNotes} ${overflowLines.join(" ")}`
      .trim()
      .slice(0, 700);
  }

  for (const mapping of normalizedMappings) {
    const value = valueOverrides.get(mapping.pdfFieldName) || transformValue(mapping, claimDataForFill);
    if (!value) continue;

    try {
      const field = form.getField(mapping.pdfFieldName);

      if (field instanceof PDFTextField) {
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        if (shouldCheck(mapping, claimDataForFill[mapping.claimDataKey] || value)) {
          field.check();
        } else {
          field.uncheck();
        }
      } else if (field instanceof PDFDropdown) {
        try {
          field.select(value);
        } catch {
          /* value not in dropdown options */
        }
      }
    } catch {
      console.warn(`Could not set field "${mapping.pdfFieldName}"`);
    }
  }

  // Enforce critical fallback fields by semantic field-name matching.
  const inferredClaimType =
    inferClaimType(claimDataForFill.claimType) ||
    inferClaimType(`${claimDataForFill.description} ${claimDataForFill.providerName}`) ||
    "other";
  const normalizedForeignRaw = (claimDataForFill.foreignProvider || "").trim().toLowerCase();
  const isForeign =
    normalizedForeignRaw === "yes" ||
    normalizedForeignRaw === "true" ||
    normalizedForeignRaw === "1" ||
    normalizedForeignRaw === "checked" ||
    ((claimDataForFill.currency || "").toUpperCase() &&
      (claimDataForFill.currency || "").toUpperCase() !== "USD");
  for (const field of form.getFields()) {
    const rawName = field.getName();
    const name = normalizeName(rawName);
    try {
      if (field instanceof PDFTextField) {
        if (!field.getText()?.trim()) {
          if (name.includes("gehaplanname") || name.includes("planname")) {
            const plan =
              claimDataForFill.planName ||
              claimDataForFill.insurerName ||
              claimDataForFill.insuranceGroup ||
              "";
            if (plan) field.setText(plan);
          } else if (name.includes("plangroupnumber") || name.includes("groupnumber")) {
            if (claimDataForFill.insuranceGroup) field.setText(claimDataForFill.insuranceGroup);
          } else if (name.includes("subscribername") || name.includes("nameofsubscriber")) {
            if (claimDataForFill.subscriberName) field.setText(claimDataForFill.subscriberName);
          }
        }
        continue;
      }

      if (field instanceof PDFCheckBox) {
        if (
          name.includes("serviceprovidedinforeigncountry") ||
          name.includes("foreigncountry") ||
          name.includes("foreignprovider") ||
          name.includes("outsideus") ||
          name.includes("outofcountry")
        ) {
          if (isForeign) field.check();
          else field.uncheck();
          continue;
        }

        const isServiceTypeArea =
          name.includes("service") ||
          name.includes("visit") ||
          name.includes("hospital") ||
          name.includes("lab") ||
          name.includes("xray") ||
          name.includes("other");
        if (!isServiceTypeArea || !inferredClaimType) continue;

        const wantsCheck =
          (inferredClaimType === "hospital" &&
            (name.includes("hospital") ||
              name.includes("inpatient") ||
              name.includes("outpatient") ||
              name.includes("emergency"))) ||
          (inferredClaimType === "lab" &&
            (name.includes("lab") || name.includes("laboratory") || name.includes("pathology"))) ||
          (inferredClaimType === "imaging" &&
            (name.includes("xray") ||
              name.includes("mri") ||
              name.includes("ct") ||
              name.includes("ultrasound") ||
              name.includes("radiology") ||
              name.includes("imaging"))) ||
          (inferredClaimType === "doctor_visit" &&
            (name.includes("officevisit") ||
              name.includes("doctor") ||
              name.includes("physician") ||
              name.includes("clinicvisit"))) ||
          (inferredClaimType === "other" && name.includes("other"));

        if (wantsCheck) field.check();
      }
    } catch {
      /* ignore fallback field set errors */
    }
  }

  if (flatten) {
    try {
      form.flatten();
    } catch {
      for (const field of form.getFields()) {
        try {
          field.enableReadOnly();
        } catch {
          /* ignore readonly failures */
        }
      }
    }
  }
  await appendInvoicePages(pdfDoc, invoiceAttachment);
  return pdfDoc.save();
}

export async function fillFormEditable(
  templateBytes: Uint8Array,
  claimData: ClaimData,
  mappings: FieldMapping[],
  invoiceAttachment?: InvoiceAttachment
): Promise<Uint8Array> {
  return fillFormBase(templateBytes, claimData, mappings, false, invoiceAttachment);
}

export async function fillFormFinalized(
  templateBytes: Uint8Array,
  claimData: ClaimData,
  mappings: FieldMapping[],
  invoiceAttachment?: InvoiceAttachment
): Promise<Uint8Array> {
  return fillFormBase(templateBytes, claimData, mappings, true, invoiceAttachment);
}
