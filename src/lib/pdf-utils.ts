import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFRadioGroup,
} from "pdf-lib";
import { PDFFieldInfo, FieldMapping, ClaimData, MappingTransform } from "./types";

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

interface InvoiceAttachment {
  bytes: Uint8Array;
  mimeType: string;
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
  const rawValue =
    mapping.staticValue !== undefined
      ? mapping.staticValue
      : claimData[mapping.claimDataKey] || "";

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
  const normalized = value.trim().toLowerCase();

  if (transform === "checkbox_equals") {
    return normalized === (mapping.staticValue || "").trim().toLowerCase();
  }

  return (
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "1" ||
    normalized === "checked" ||
    normalized === "x"
  );
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

  for (const mapping of mappings) {
    const value = transformValue(mapping, claimData);
    if (!value) continue;

    try {
      const field = form.getField(mapping.pdfFieldName);

      if (field instanceof PDFTextField) {
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        if (shouldCheck(mapping, claimData[mapping.claimDataKey] || value)) {
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

  if (flatten) form.flatten();
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
