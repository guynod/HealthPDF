#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function importTsModule(relativePath) {
  const sourcePath = path.join(REPO_ROOT, relativePath);
  const source = await fs.readFile(sourcePath, "utf8");
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

  const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  return import(dataUrl);
}

function usage() {
  return `Usage:
  node scripts/healthpdf-cli.mjs --config FILE --input-pdf FILE --claim-data FILE --out-dir DIR [--claim-id ID] [--allow-incomplete] [--json]

Generates editable and finalized GEHA claim packets from a portable HealthPDF config bundle.

Notes:
  - No extraction, network, email, Telegram, or Notion actions are performed.
  - Finalized output is blocked when required claim fields are missing unless --allow-incomplete is set.
`;
}

function parseArgs(argv) {
  const options = {
    allowIncomplete: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--allow-incomplete") {
      options.allowIncomplete = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (
      arg === "--config" ||
      arg === "--input-pdf" ||
      arg === "--claim-data" ||
      arg === "--out-dir" ||
      arg === "--claim-id"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function readJsonFile(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function slugify(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildClaimId(claimData) {
  const base = [
    claimData.dateOfService || new Date().toISOString().slice(0, 10),
    claimData.patientName,
    claimData.providerName,
  ]
    .map(slugify)
    .filter(Boolean)
    .join("-");
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        patientName: claimData.patientName || "",
        providerName: claimData.providerName || "",
        dateOfService: claimData.dateOfService || "",
        amountCharged: claimData.amountCharged || "",
        amountUSD: claimData.amountUSD || "",
        currency: claimData.currency || "",
      })
    )
    .digest("hex")
    .slice(0, 8);
  return `${base || "healthpdf-claim"}-${hash}`;
}

function buildWarnings(claimData, mappings) {
  const warnings = [];
  const required = [
    ["patientName", "Patient Name"],
    ["subscriberName", "Subscriber Name"],
    ["planName", "Plan Name"],
    ["dateOfBirth", "Date of Birth"],
    ["policyNumber", "Policy Number"],
    ["providerName", "Provider Name"],
    ["dateOfService", "Date of Service"],
    ["amountCharged", "Amount Charged"],
    ["amountUSD", "Amount USD"],
    ["diagnosisCode", "Diagnosis Code"],
  ];

  for (const [key, label] of required) {
    if (!String(claimData[key] || "").trim()) {
      warnings.push({
        code: `missing_${key}`,
        severity: "error",
        message: `${label} is missing.`,
      });
    }
  }

  if (
    claimData.dateOfBirth &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(claimData.dateOfBirth).trim())
  ) {
    warnings.push({
      code: "date_of_birth_format",
      severity: "warning",
      message: "Date of Birth should be in YYYY-MM-DD format.",
    });
  }

  if (
    claimData.dateOfService &&
    !/^\d{4}-\d{2}-\d{2}$/.test(String(claimData.dateOfService).trim())
  ) {
    warnings.push({
      code: "date_of_service_format",
      severity: "warning",
      message: "Date of Service should be in YYYY-MM-DD format.",
    });
  }

  if (!Array.isArray(mappings) || mappings.length === 0) {
    warnings.push({
      code: "missing_mappings",
      severity: "error",
      message: "No PDF field mappings are configured.",
    });
  }

  return warnings;
}

async function writeBytes(filePath, bytes) {
  await fs.writeFile(filePath, Buffer.from(bytes));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  for (const key of ["config", "inputPdf", "claimData", "outDir"]) {
    if (!options[key]) {
      throw new Error(`Missing required --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}.`);
    }
  }

  const portable = await importTsModule("src/lib/portable-config.ts");
  const pdfUtils = await importTsModule("src/lib/pdf-utils.ts");
  const claimDataUtils = await importTsModule("src/lib/claim-data.ts");

  const configText = await fs.readFile(options.config, "utf8");
  const parsedConfig = portable.parsePortableConfigJson(configText);
  if (!parsedConfig.ok) {
    throw new Error(`Invalid portable config: ${parsedConfig.errors.join(" ")}`);
  }

  const rawClaimData = await readJsonFile(options.claimData, "claim data");
  if (!rawClaimData || typeof rawClaimData !== "object" || Array.isArray(rawClaimData)) {
    throw new Error("Claim data must be a JSON object.");
  }

  const inputPdfBytes = new Uint8Array(await fs.readFile(options.inputPdf));
  const templateBytes = portable.base64ToBytes(parsedConfig.config.templatePdfBase64);
  const effectiveClaimData = claimDataUtils.mergeProfileIntoClaimData(
    rawClaimData,
    parsedConfig.config.profile
  );
  const warnings = buildWarnings(effectiveClaimData, parsedConfig.config.mappings);
  const blockingWarnings = warnings.filter((warning) => warning.severity === "error");
  const claimId = options.claimId || buildClaimId(effectiveClaimData);
  const claimDir = path.resolve(options.outDir, claimId);
  await fs.mkdir(claimDir, { recursive: true });

  const editablePath = path.join(claimDir, "packet-editable.pdf");
  const finalizedPath = path.join(claimDir, "packet-finalized.pdf");
  const manifestPath = path.join(claimDir, "manifest.json");
  const invoiceAttachment = {
    mimeType: "application/pdf",
    bytes: inputPdfBytes,
  };

  const editableBytes = await pdfUtils.fillFormEditable(
    templateBytes,
    effectiveClaimData,
    parsedConfig.config.mappings,
    invoiceAttachment
  );
  await writeBytes(editablePath, editableBytes);

  let finalizedWritten = false;
  if (blockingWarnings.length === 0 || options.allowIncomplete) {
    const finalizedBytes = await pdfUtils.fillFormFinalized(
      templateBytes,
      effectiveClaimData,
      parsedConfig.config.mappings,
      invoiceAttachment
    );
    await writeBytes(finalizedPath, finalizedBytes);
    finalizedWritten = true;
  }

  const manifest = {
    schemaVersion: "healthpdf-cli-manifest-v1",
    claimId,
    status: finalizedWritten ? "ready" : "needs_review",
    createdAt: new Date().toISOString(),
    allowIncomplete: Boolean(options.allowIncomplete),
    inputPdf: {
      path: path.resolve(options.inputPdf),
      byteLength: inputPdfBytes.byteLength,
    },
    config: {
      path: path.resolve(options.config),
      schemaVersion: parsedConfig.config.schemaVersion,
      templateName: parsedConfig.config.templateName,
      templateByteLength: parsedConfig.config.templateByteLength,
      pdfFieldCount: parsedConfig.config.pdfFields.length,
      mappingCount: parsedConfig.config.mappings.length,
    },
    outputs: {
      directory: claimDir,
      editablePdf: editablePath,
      finalizedPdf: finalizedWritten ? finalizedPath : null,
      manifest: manifestPath,
    },
    claimSummary: {
      patientName: effectiveClaimData.patientName || "",
      providerName: effectiveClaimData.providerName || "",
      dateOfService: effectiveClaimData.dateOfService || "",
      amountCharged: effectiveClaimData.amountCharged || "",
      amountUSD: effectiveClaimData.amountUSD || "",
      currency: effectiveClaimData.currency || "",
      diagnosisCodePresent: Boolean(String(effectiveClaimData.diagnosisCode || "").trim()),
    },
    warnings,
  };

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(`STATUS: ${manifest.status}`);
    console.log(`CLAIM_ID: ${claimId}`);
    console.log(`EDITABLE_PDF: ${editablePath}`);
    console.log(`FINALIZED_PDF: ${finalizedWritten ? finalizedPath : "not written"}`);
    console.log(`MANIFEST: ${manifestPath}`);
    if (blockingWarnings.length > 0 && !options.allowIncomplete) {
      console.log(`BLOCKING_WARNINGS: ${blockingWarnings.length}`);
    }
  }

  return blockingWarnings.length > 0 && !options.allowIncomplete ? 2 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
