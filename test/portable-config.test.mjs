import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
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
  const dataUrl = `data:text/javascript;base64,${Buffer.from(
    transpiled.outputText
  ).toString("base64")}`;
  return import(dataUrl);
}

const portable = await importTsModule("src/lib/portable-config.ts");

const profile = {
  patientName: "Example Patient",
  subscriberName: "Example Subscriber",
  subscriberContact: "example@example.com",
  dateOfBirth: "2000-01-01",
  planName: "Example Plan",
  policyNumber: "POLICY",
  memberId: "MEMBER",
  insuranceGroup: "GROUP",
  patientAddress: "Example Address",
  insurerName: "GEHA",
  insurerEmail: "claims@example.com",
  emailSubjectTemplate: "Claim {patientName}",
  emailBodyTemplate: "Attached claim.",
};

test("buildPortableConfig creates a portable bundle with template bytes", () => {
  const templateBytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  const config = portable.buildPortableConfig({
    profile,
    pdfFields: [{ name: "patientName", type: "text" }],
    mappings: [
      {
        pdfFieldName: "patientName",
        claimDataKey: "patientName",
        transform: "none",
        source: "manual",
        confidence: 1,
      },
    ],
    templateName: "geha.pdf",
    templateBytes,
    exportedAt: "2026-06-02T00:00:00.000Z",
  });

  assert.equal(config.schemaVersion, "healthpdf-portable-config-v1");
  assert.equal(config.app, "HealthPDF");
  assert.equal(config.templateName, "geha.pdf");
  assert.equal(config.templateByteLength, templateBytes.byteLength);
  assert.deepEqual(Array.from(portable.base64ToBytes(config.templatePdfBase64)), [
    37,
    80,
    68,
    70,
    45,
    49,
  ]);
  assert.equal(config.profile.patientName, "Example Patient");
  assert.equal(config.pdfFields.length, 1);
  assert.equal(config.mappings.length, 1);
});

test("parsePortableConfigJson accepts a valid generated bundle", () => {
  const config = portable.buildPortableConfig({
    profile,
    pdfFields: [{ name: "amountUSD", type: "text" }],
    mappings: [{ pdfFieldName: "amountUSD", claimDataKey: "amountUSD" }],
    templateName: "geha.pdf",
    templateBytes: new Uint8Array([1, 2, 3]),
    exportedAt: "2026-06-02T00:00:00.000Z",
  });

  const result = portable.parsePortableConfigJson(JSON.stringify(config));
  assert.equal(result.ok, true);
  assert.equal(result.config.templateName, "geha.pdf");
  assert.deepEqual(Array.from(portable.base64ToBytes(result.config.templatePdfBase64)), [
    1,
    2,
    3,
  ]);
});

test("parsePortableConfigJson rejects unsupported schema and bad template bytes", () => {
  const result = portable.parsePortableConfigJson(
    JSON.stringify({
      schemaVersion: "old",
      app: "HealthPDF",
      exportedAt: "2026-06-02T00:00:00.000Z",
      templateName: "geha.pdf",
      templatePdfBase64: "",
      templateByteLength: 0,
      profile,
      pdfFields: [],
      mappings: [],
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /Unsupported schemaVersion/);
  assert.match(result.errors.join("\n"), /templatePdfBase64 is required/);
  assert.match(result.errors.join("\n"), /templateByteLength/);
});

test("parsePortableConfigJson rejects malformed base64 text before decoding", () => {
  const config = portable.buildPortableConfig({
    profile,
    pdfFields: [],
    mappings: [],
    templateName: "geha.pdf",
    templateBytes: new Uint8Array([1]),
    exportedAt: "2026-06-02T00:00:00.000Z",
  });

  const result = portable.parsePortableConfigJson(
    JSON.stringify({
      ...config,
      templatePdfBase64: "not valid%%",
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /not valid base64/);
});

test("validatePortableConfig rejects malformed fields and mappings", () => {
  const config = portable.buildPortableConfig({
    profile,
    pdfFields: [{ name: "patientName", type: "text" }],
    mappings: [{ pdfFieldName: "patientName", claimDataKey: "patientName" }],
    templateName: "geha.pdf",
    templateBytes: new Uint8Array([1]),
    exportedAt: "2026-06-02T00:00:00.000Z",
  });

  const errors = portable.validatePortableConfig({
    ...config,
    pdfFields: [{ name: "", type: "bad" }],
    mappings: [
      {
        pdfFieldName: "",
        claimDataKey: "",
        transform: "surprise",
        source: "unknown",
        confidence: "high",
      },
    ],
  });

  assert.match(errors.join("\n"), /pdfFields\[0\]\.name/);
  assert.match(errors.join("\n"), /pdfFields\[0\]\.type/);
  assert.match(errors.join("\n"), /mappings\[0\]\.pdfFieldName/);
  assert.match(errors.join("\n"), /mappings\[0\]\.claimDataKey/);
  assert.match(errors.join("\n"), /mappings\[0\]\.transform/);
  assert.match(errors.join("\n"), /mappings\[0\]\.source/);
  assert.match(errors.join("\n"), /mappings\[0\]\.confidence/);
});
