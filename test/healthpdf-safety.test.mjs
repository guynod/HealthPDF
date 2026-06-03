import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import ts from "typescript";

async function importTsModule(relativePath) {
  const sourcePath = new URL(`../${relativePath}`, import.meta.url);
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: relativePath,
  });
  const pdfLibUrl = await import.meta.resolve("pdf-lib");
  const outputText = transpiled.outputText.replace(
    /from\s+["']pdf-lib["']/g,
    `from ${JSON.stringify(pdfLibUrl)}`
  );
  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString(
    "base64"
  )}`;
  return import(dataUrl);
}

const guards = await importTsModule("src/lib/extract-guards.ts");
const email = await importTsModule("src/lib/email.ts");
const pdfUtils = await importTsModule("src/lib/pdf-utils.ts");

async function createDummyClaimTemplate() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const form = pdfDoc.getForm();

  const patientName = form.createTextField("patientName");
  patientName.addToPage(page, { x: 72, y: 700, width: 240, height: 20 });

  const dateOfService = form.createTextField("dateOfService");
  dateOfService.addToPage(page, { x: 72, y: 660, width: 120, height: 20 });

  const amountUsd = form.createTextField("amountUSD");
  amountUsd.addToPage(page, { x: 72, y: 620, width: 120, height: 20 });

  const foreignProvider = form.createCheckBox("foreignProvider");
  foreignProvider.addToPage(page, { x: 72, y: 580, width: 14, height: 14 });

  return new Uint8Array(await pdfDoc.save());
}

test("validateUpload allows supported receipt types within the configured size", () => {
  assert.deepEqual(
    guards.validateUpload(
      { type: "application/pdf", size: 2 * 1024 * 1024 },
      { HEALTHPDF_MAX_UPLOAD_MB: "5" }
    ),
    { ok: true }
  );
});

test("validateUpload rejects unsupported file types", () => {
  const result = guards.validateUpload(
    { type: "text/plain", size: 100 },
    { HEALTHPDF_MAX_UPLOAD_MB: "5" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.error, /Unsupported receipt type/);
});

test("validateUpload rejects files larger than the configured limit", () => {
  const result = guards.validateUpload(
    { type: "image/png", size: 6 * 1024 * 1024 },
    { HEALTHPDF_MAX_UPLOAD_MB: "5" }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 413);
  assert.match(result.error, /Maximum upload size is 5 MB/);
});

test("safeParsePdfFields tolerates bad input and filters unexpected shapes", () => {
  assert.deepEqual(guards.safeParsePdfFields("not json"), []);
  assert.deepEqual(
    guards.safeParsePdfFields(
      JSON.stringify([
        { name: "Patient Name", type: "text" },
        { name: "Foreign", type: "checkbox", extra: "ignored" },
        { name: "Bad" },
        "also bad",
      ])
    ),
    [
      { name: "Patient Name", type: "text" },
      { name: "Foreign", type: "checkbox", extra: "ignored" },
    ]
  );
});

test("provider lookup remains opt-in", () => {
  assert.equal(guards.providerLookupEnabledFromEnv({}), false);
  assert.equal(
    guards.providerLookupEnabledFromEnv({
      HEALTHPDF_ENABLE_PROVIDER_LOOKUP: "false",
    }),
    false
  );
  assert.equal(
    guards.providerLookupEnabledFromEnv({
      HEALTHPDF_ENABLE_PROVIDER_LOOKUP: "true",
    }),
    true
  );
});

test("inferForeignProvider does not mark missing currency as foreign", () => {
  assert.equal(guards.inferForeignProvider("", "", ""), "no");
  assert.equal(guards.inferForeignProvider("", "United States", "USD"), "no");
  assert.equal(guards.inferForeignProvider("", "Thailand", ""), "yes");
  assert.equal(guards.inferForeignProvider("", "", "THB"), "yes");
  assert.equal(guards.inferForeignProvider("manual", "", ""), "manual");
});

test("normalizeValidationWarnings preserves valid mapping warnings only", () => {
  assert.deepEqual(
    guards.normalizeValidationWarnings({
      validationWarnings: [
        { code: "a", message: "A", severity: "warning" },
        { code: "missing_message", severity: "warning" },
        { code: "b", message: "B" },
      ],
    }),
    [
      { code: "a", message: "A", severity: "warning" },
      { code: "b", message: "B" },
    ]
  );
});

test("email preview interpolates claim and profile placeholders", () => {
  const profile = {
    patientName: "Profile Patient",
    subscriberName: "",
    subscriberContact: "",
    dateOfBirth: "",
    planName: "",
    policyNumber: "P-123",
    memberId: "",
    insuranceGroup: "",
    patientAddress: "",
    insurerName: "PlanCo",
    insurerEmail: "claims@example.com",
    emailSubjectTemplate: "Claim {patientName} {dateOfService}",
    emailBodyTemplate: "Provider {providerName}; Policy {policyNumber}",
  };
  const claimData = {
    patientName: "Claim Patient",
    dateOfService: "2026-05-31",
    providerName: "Clinic",
    policyNumber: "ignored",
  };

  assert.deepEqual(email.generateEmailPreview(profile, claimData), {
    to: "claims@example.com",
    subject: "Claim Profile Patient 2026-05-31",
    body: "Provider Clinic; Policy P-123",
  });
});

test("dummy claim template can be discovered, filled, and finalized locally", async () => {
  const templateBytes = await createDummyClaimTemplate();
  const fields = await pdfUtils.discoverFields(templateBytes);
  assert.deepEqual(
    fields
      .map((field) => [field.name, field.type])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ["amountUSD", "text"],
      ["dateOfService", "text"],
      ["foreignProvider", "checkbox"],
      ["patientName", "text"],
    ]
  );

  const claimData = {
    patientName: "Example Patient",
    subscriberName: "",
    subscriberContact: "",
    dateOfBirth: "",
    planName: "",
    insurerName: "",
    policyNumber: "",
    memberId: "",
    insuranceGroup: "",
    patientAddress: "",
    gender: "",
    foreignProvider: "yes",
    serviceCountry: "Thailand",
    claimType: "doctor_visit",
    providerName: "Example Clinic",
    providerAddress: "",
    dateOfService: "2026-05-31",
    description: "Example consultation",
    diagnosis: "Example diagnosis",
    diagnosisCode: "Z00.00",
    amountCharged: "1000",
    amountUSD: "27.20",
    currency: "THB",
    receiptNumber: "R-1",
    additionalNotes: "",
  };
  const mappings = [
    { pdfFieldName: "patientName", claimDataKey: "patientName" },
    { pdfFieldName: "dateOfService", claimDataKey: "dateOfService" },
    { pdfFieldName: "amountUSD", claimDataKey: "amountUSD" },
    {
      pdfFieldName: "foreignProvider",
      claimDataKey: "foreignProvider",
      transform: "checkbox_truthy",
    },
  ];

  const editableBytes = await pdfUtils.fillFormEditable(templateBytes, claimData, mappings);
  const editableDoc = await PDFDocument.load(editableBytes);
  const editableForm = editableDoc.getForm();
  assert.equal(editableForm.getTextField("patientName").getText(), "Example Patient");
  assert.equal(editableForm.getTextField("dateOfService").getText(), "2026-05-31");
  assert.equal(editableForm.getTextField("amountUSD").getText(), "27.20");
  assert.equal(editableForm.getCheckBox("foreignProvider").isChecked(), true);

  const finalizedBytes = await pdfUtils.fillFormFinalized(templateBytes, claimData, mappings);
  const finalizedDoc = await PDFDocument.load(finalizedBytes);
  assert.equal(finalizedDoc.getPageCount(), 1);
  assert.equal(finalizedDoc.getForm().getFields().length, 0);
});

test("finalized renderer strips fields when default appearances cannot encode a value", async () => {
  const templateBytes = await createDummyClaimTemplate();
  const claimData = {
    patientName: "Example ผู้ป่วย",
    dateOfService: "2026-05-31",
    amountUSD: "27.20",
    foreignProvider: "yes",
  };
  const mappings = [
    { pdfFieldName: "patientName", claimDataKey: "patientName" },
    { pdfFieldName: "dateOfService", claimDataKey: "dateOfService" },
    { pdfFieldName: "amountUSD", claimDataKey: "amountUSD" },
    {
      pdfFieldName: "foreignProvider",
      claimDataKey: "foreignProvider",
      transform: "checkbox_truthy",
    },
  ];

  const finalizedBytes = await pdfUtils.fillFormFinalized(templateBytes, claimData, mappings);
  const finalizedDoc = await PDFDocument.load(finalizedBytes);

  assert.equal(finalizedDoc.getPageCount(), 1);
  assert.equal(finalizedDoc.getForm().getFields().length, 0);
});
