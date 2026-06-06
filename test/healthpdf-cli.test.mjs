import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const cliPath = path.join(repoRoot, "scripts/healthpdf-cli.mjs");

async function createTemplatePdf() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const form = pdfDoc.getForm();

  const patientName = form.createTextField("patientName");
  patientName.addToPage(page, { x: 72, y: 700, width: 240, height: 20 });

  const providerName = form.createTextField("providerName");
  providerName.addToPage(page, { x: 72, y: 660, width: 240, height: 20 });

  const dateOfService = form.createTextField("dateOfService");
  dateOfService.addToPage(page, { x: 72, y: 620, width: 120, height: 20 });

  const amountUsd = form.createTextField("amountUSD");
  amountUsd.addToPage(page, { x: 72, y: 580, width: 120, height: 20 });

  return new Uint8Array(await pdfDoc.save());
}

async function createInvoicePdf() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([612, 792]);
  return new Uint8Array(await pdfDoc.save());
}

function profile() {
  return {
    patientName: "Example Patient",
    subscriberName: "Example Subscriber",
    subscriberContact: "example@example.com",
    dateOfBirth: "2000-01-01",
    planName: "GEHA",
    policyNumber: "POLICY",
    memberId: "MEMBER",
    insuranceGroup: "GROUP",
    patientAddress: "Example Address",
    insurerName: "GEHA",
    insurerEmail: "claims@example.com",
    emailSubjectTemplate: "Claim {patientName}",
    emailBodyTemplate: "Attached claim.",
  };
}

async function writeFixtureFiles(tmpDir, { complete = true } = {}) {
  const templateBytes = await createTemplatePdf();
  const invoiceBytes = await createInvoicePdf();
  const configPath = path.join(tmpDir, "config.json");
  const inputPath = path.join(tmpDir, "invoice.pdf");
  const claimDataPath = path.join(tmpDir, "claim-data.json");
  const outDir = path.join(tmpDir, "out");

  fs.writeFileSync(inputPath, invoiceBytes);
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        schemaVersion: "healthpdf-portable-config-v1",
        app: "HealthPDF",
        exportedAt: "2026-06-02T00:00:00.000Z",
        templateName: "geha.pdf",
        templatePdfBase64: Buffer.from(templateBytes).toString("base64"),
        templateByteLength: templateBytes.byteLength,
        profile: profile(),
        pdfFields: [
          { name: "patientName", type: "text" },
          { name: "providerName", type: "text" },
          { name: "dateOfService", type: "text" },
          { name: "amountUSD", type: "text" },
        ],
        mappings: [
          { pdfFieldName: "patientName", claimDataKey: "patientName" },
          { pdfFieldName: "providerName", claimDataKey: "providerName" },
          { pdfFieldName: "dateOfService", claimDataKey: "dateOfService" },
          { pdfFieldName: "amountUSD", claimDataKey: "amountUSD" },
        ],
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    claimDataPath,
    `${JSON.stringify(
      {
        providerName: "Example Clinic",
        dateOfService: "2026-06-02",
        amountCharged: "1000",
        amountUSD: "27.20",
        currency: "THB",
        diagnosisCode: complete ? "Z00.00" : "",
        description: "Example consultation",
      },
      null,
      2
    )}\n`
  );

  return { configPath, inputPath, claimDataPath, outDir };
}

test("healthpdf CLI writes editable, finalized, and manifest for complete data", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "healthpdf-cli-"));
  const { configPath, inputPath, claimDataPath, outDir } = await writeFixtureFiles(tmpDir);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--config",
      configPath,
      "--input-pdf",
      inputPath,
      "--claim-data",
      claimDataPath,
      "--out-dir",
      outDir,
      "--claim-id",
      "claim-001",
      "--json",
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.claimSummary.patientName, "Example Patient");
  assert.equal(manifest.claimSummary.providerName, "Example Clinic");
  assert.ok(fs.existsSync(manifest.outputs.editablePdf));
  assert.ok(fs.existsSync(manifest.outputs.finalizedPdf));
  assert.ok(fs.existsSync(manifest.outputs.manifest));

  const finalizedDoc = await PDFDocument.load(fs.readFileSync(manifest.outputs.finalizedPdf));
  assert.equal(finalizedDoc.getPageCount(), 2);
  assert.equal(finalizedDoc.getForm().getFields().length, 0);
});

test("healthpdf CLI writes editable only and exits nonzero for incomplete finalized data", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "healthpdf-cli-"));
  const { configPath, inputPath, claimDataPath, outDir } = await writeFixtureFiles(tmpDir, {
    complete: false,
  });

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--config",
      configPath,
      "--input-pdf",
      inputPath,
      "--claim-data",
      claimDataPath,
      "--out-dir",
      outDir,
      "--claim-id",
      "claim-002",
      "--json",
    ],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 2, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.status, "needs_review");
  assert.ok(fs.existsSync(manifest.outputs.editablePdf));
  assert.equal(manifest.outputs.finalizedPdf, null);
  assert.match(
    manifest.warnings.map((warning) => warning.code).join(" "),
    /missing_diagnosisCode/
  );
});
