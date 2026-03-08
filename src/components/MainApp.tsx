"use client";

import { useState, useEffect, useCallback } from "react";
import {
  UserProfile,
  PDFFieldInfo,
  FieldMapping,
  ClaimData,
  MappingSuggestion,
  ValidationWarning,
  EMPTY_PROFILE,
  EMPTY_CLAIM,
} from "@/lib/types";
import {
  loadProfile,
  saveProfile,
  loadMappings,
  saveMappings,
  loadTemplate,
} from "@/lib/storage";
import { fillFormEditable, fillFormFinalized } from "@/lib/pdf-utils";
import { generateMailtoLink, generateEmailPreview } from "@/lib/email";
import SettingsModal from "./SettingsModal";
import UploadZone from "./UploadZone";
import DataReviewForm from "./DataReviewForm";

type AppStep = "upload" | "extracting" | "review" | "filling" | "complete";
type OutputMode = "editable" | "finalized" | null;

type InvoiceAttachment = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

type ExtractResponse = {
  data: ClaimData;
  mappingSuggestions?: MappingSuggestion[];
  validationWarnings?: ValidationWarning[];
};

function mergeMappingSuggestions(
  existing: FieldMapping[],
  suggestions: MappingSuggestion[]
): FieldMapping[] {
  if (suggestions.length === 0) return existing;

  const mergedByField = new Map<string, FieldMapping>();
  for (const mapping of existing) {
    mergedByField.set(mapping.pdfFieldName, mapping);
  }

  for (const suggestion of suggestions) {
    const current = mergedByField.get(suggestion.pdfFieldName);
    if (current?.source === "manual" || current?.source === "preset") continue;

    mergedByField.set(suggestion.pdfFieldName, {
      pdfFieldName: suggestion.pdfFieldName,
      claimDataKey: suggestion.claimDataKey,
      transform: suggestion.transform || "none",
      staticValue: suggestion.staticValue,
      confidence: suggestion.confidence,
      source: "ai",
      reason: suggestion.reason,
    });
  }

  return [...mergedByField.values()];
}

function buildBlockingWarnings(claimData: ClaimData): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const required: { key: keyof ClaimData; label: string }[] = [
    { key: "patientName", label: "Patient Name" },
    { key: "dateOfBirth", label: "Date of Birth" },
    { key: "policyNumber", label: "Policy Number" },
    { key: "providerName", label: "Provider Name" },
    { key: "dateOfService", label: "Date of Service" },
    { key: "amountCharged", label: "Amount Charged" },
  ];

  for (const item of required) {
    if (!claimData[item.key]?.trim()) {
      warnings.push({
        code: `missing_${item.key}`,
        message: `${item.label} is missing.`,
        severity: "error",
      });
    }
  }

  if (
    claimData.dateOfBirth &&
    !/^\d{4}-\d{2}-\d{2}$/.test(claimData.dateOfBirth.trim())
  ) {
    warnings.push({
      code: "date_of_birth_format",
      message: "Date of Birth should be in YYYY-MM-DD format.",
      severity: "warning",
    });
  }

  if (
    claimData.dateOfService &&
    !/^\d{4}-\d{2}-\d{2}$/.test(claimData.dateOfService.trim())
  ) {
    warnings.push({
      code: "date_of_service_format",
      message: "Date of Service should be in YYYY-MM-DD format.",
      severity: "warning",
    });
  }

  return warnings;
}

async function convertImageToPngBytes(file: File): Promise<Uint8Array> {
  const objectUrl = URL.createObjectURL(file);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Unable to read image file for PDF append."));
      img.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable for image conversion.");
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("Failed to convert image to PNG for PDF append.");

    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function MainApp() {
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [pdfFields, setPdfFields] = useState<PDFFieldInfo[]>([]);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [step, setStep] = useState<AppStep>("upload");
  const [claimData, setClaimData] = useState<ClaimData>(EMPTY_CLAIM);
  const [receiptName, setReceiptName] = useState("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [filledPdfUrl, setFilledPdfUrl] = useState("");
  const [filledPdfBlob, setFilledPdfBlob] = useState<Blob | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>(null);
  const [validationWarnings, setValidationWarnings] = useState<ValidationWarning[]>([]);

  useEffect(() => {
    setProfile(loadProfile());
    setMappings(loadMappings());
    const stored = localStorage.getItem("healthpdf_template_name");
    if (stored) setTemplateName(stored);
    const storedFields = localStorage.getItem("healthpdf_pdf_fields");
    if (storedFields) {
      try {
        setPdfFields(JSON.parse(storedFields));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleProfileChange = useCallback((p: UserProfile) => {
    setProfile(p);
    saveProfile(p);
  }, []);

  const handleMappingsChange = useCallback((m: FieldMapping[]) => {
    setMappings(m);
    saveMappings(m);
  }, []);

  const handlePdfFieldsChange = useCallback((f: PDFFieldInfo[]) => {
    setPdfFields(f);
    localStorage.setItem("healthpdf_pdf_fields", JSON.stringify(f));
  }, []);

  const handleTemplateNameChange = useCallback((name: string) => {
    setTemplateName(name);
    localStorage.setItem("healthpdf_template_name", name);
  }, []);

  const mergeProfileIntoClaimData = useCallback(
    (data: ClaimData): ClaimData => {
      return {
        ...data,
        patientName: data.patientName || profile.patientName,
        dateOfBirth: data.dateOfBirth || profile.dateOfBirth,
        policyNumber: data.policyNumber || profile.policyNumber,
        memberId: data.memberId || profile.memberId,
        insuranceGroup: data.insuranceGroup || profile.insuranceGroup,
        patientAddress: data.patientAddress || profile.patientAddress,
      };
    },
    [profile]
  );

  const toInvoiceAttachment = useCallback(async (): Promise<InvoiceAttachment | undefined> => {
    if (!receiptFile) return undefined;

    const mimeType = receiptFile.type || "application/octet-stream";

    if (
      mimeType === "application/pdf" ||
      mimeType === "image/png" ||
      mimeType === "image/jpeg" ||
      mimeType === "image/jpg"
    ) {
      return {
        fileName: receiptFile.name,
        mimeType,
        bytes: new Uint8Array(await receiptFile.arrayBuffer()),
      };
    }

    if (mimeType.startsWith("image/")) {
      const pngBytes = await convertImageToPngBytes(receiptFile);
      return {
        fileName: receiptFile.name,
        mimeType: "image/png",
        bytes: pngBytes,
      };
    }

    throw new Error("Invoice attachment must be PDF or image file.");
  }, [receiptFile]);

  const handleReceiptUpload = useCallback(
    async (file: File) => {
      setError("");
      setReceiptName(file.name);
      setReceiptFile(file);
      setValidationWarnings([]);
      setStep("extracting");

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("pdfFields", JSON.stringify(pdfFields));

        const res = await fetch("/api/extract", {
          method: "POST",
          body: formData,
        });

        const json: ExtractResponse & { error?: string } = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Extraction failed");
        }

        const merged = mergeProfileIntoClaimData(json.data);
        setClaimData(merged);

        const suggestedMappings = json.mappingSuggestions || [];
        if (suggestedMappings.length > 0) {
          const mergedMappings = mergeMappingSuggestions(mappings, suggestedMappings);
          setMappings(mergedMappings);
          saveMappings(mergedMappings);
        }

        setValidationWarnings(json.validationWarnings || []);
        setStep("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Extraction failed");
        setStep("upload");
      }
    },
    [mergeProfileIntoClaimData, pdfFields, mappings]
  );

  const generatePdf = useCallback(
    async (mode: OutputMode) => {
      if (!mode) return;

      setError("");
      setStep("filling");

      try {
        const templateBytes = await loadTemplate();
        if (!templateBytes) {
          throw new Error("No template found. Please upload one in Settings.");
        }

        const warnings = buildBlockingWarnings(claimData);
        setValidationWarnings((prev) => [...prev.filter((w) => w.severity !== "error"), ...warnings]);

        if (mode === "finalized" && warnings.some((w) => w.severity === "error")) {
          throw new Error("Please fix required fields before finalizing.");
        }

        const invoiceAttachment = await toInvoiceAttachment();

        const outputBytes =
          mode === "editable"
            ? await fillFormEditable(templateBytes, claimData, mappings, invoiceAttachment)
            : await fillFormFinalized(templateBytes, claimData, mappings, invoiceAttachment);

        const blob = new Blob([new Uint8Array(outputBytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);

        if (filledPdfUrl) URL.revokeObjectURL(filledPdfUrl);
        setFilledPdfUrl(url);
        setFilledPdfBlob(blob);
        setOutputMode(mode);
        setStep("complete");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate PDF");
        setStep("review");
      }
    },
    [claimData, mappings, filledPdfUrl, toInvoiceAttachment]
  );

  const handleGenerateEditable = useCallback(async () => {
    await generatePdf("editable");
  }, [generatePdf]);

  const handleFinalizePdf = useCallback(async () => {
    await generatePdf("finalized");
  }, [generatePdf]);

  const handleDownload = useCallback(() => {
    if (!filledPdfUrl) return;
    const a = document.createElement("a");
    a.href = filledPdfUrl;
    const dateStr = claimData.dateOfService || new Date().toISOString().split("T")[0];
    const suffix = outputMode === "finalized" ? "final" : "editable";
    a.download = `claim-${dateStr}-${suffix}.pdf`;
    a.click();
  }, [filledPdfUrl, claimData.dateOfService, outputMode]);

  const handleShareViaEmail = useCallback(async () => {
    if (!filledPdfBlob) return;

    if (navigator.share && navigator.canShare) {
      const file = new File(
        [filledPdfBlob],
        `claim-${claimData.dateOfService || "form"}.pdf`,
        { type: "application/pdf" }
      );
      const shareData = {
        files: [file],
        ...generateEmailPreview(profile, claimData),
      };
      if (navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          return;
        } catch {
          /* user cancelled, fall through */
        }
      }
    }

    window.location.href = generateMailtoLink(profile, claimData);
  }, [filledPdfBlob, profile, claimData]);

  const handleReset = useCallback(() => {
    if (filledPdfUrl) URL.revokeObjectURL(filledPdfUrl);
    setStep("upload");
    setClaimData(EMPTY_CLAIM);
    setReceiptName("");
    setReceiptFile(null);
    setFilledPdfUrl("");
    setFilledPdfBlob(null);
    setOutputMode(null);
    setError("");
    setValidationWarnings([]);
  }, [filledPdfUrl]);

  const isSetupComplete = templateName && mappings.length > 0;

  const emailPreview =
    step === "complete" ? generateEmailPreview(profile, claimData) : null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur-lg dark:border-zinc-800 dark:bg-zinc-900/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                HealthPDF
              </h1>
              <p className="text-xs text-zinc-500">Insurance claim form filler</p>
            </div>
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {!isSetupComplete && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Setup required: upload your claim form template and map fields in Settings.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {(step === "upload" || step === "extracting") && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Upload Receipt/Invoice</h2>
              {step === "extracting" ? (
                <p className="text-sm text-zinc-500">Analyzing receipt and generating mappings...</p>
              ) : (
                <UploadZone
                  label="Drop your receipt or invoice here"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                  hint="Supports PDF and images"
                  onFile={handleReceiptUpload}
                  currentFileName={receiptName}
                />
              )}
            </div>
          )}

          {(step === "review" || step === "filling") && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Review and Correct Data</h2>

              <DataReviewForm
                data={claimData}
                onChange={setClaimData}
                warnings={validationWarnings}
              />

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={handleReset}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Start Over
                </button>
                <button
                  onClick={handleGenerateEditable}
                  disabled={step === "filling" || !isSetupComplete}
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {step === "filling" ? "Generating..." : "Generate Editable PDF"}
                </button>
                <button
                  onClick={handleFinalizePdf}
                  disabled={step === "filling" || !isSetupComplete}
                  className="flex-1 rounded-xl border border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                >
                  {step === "filling" ? "Finalizing..." : "Finalize & Flatten PDF"}
                </button>
              </div>
            </div>
          )}

          {step === "complete" && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">PDF Ready</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Mode: {outputMode === "finalized" ? "Finalized (flattened)" : "Editable"}
                </p>
                <p className="text-xs text-zinc-500">
                  Output includes claim form first, with invoice pages appended after.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleDownload}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  Download PDF
                </button>
                {outputMode === "editable" && (
                  <button
                    onClick={handleFinalizePdf}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                  >
                    Finalize & Flatten PDF
                  </button>
                )}
                <button
                  onClick={handleShareViaEmail}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Send via Email
                </button>
              </div>

              {emailPreview && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Email Preview</h3>
                  <p className="text-sm"><strong>To:</strong> {emailPreview.to || "(no email configured)"}</p>
                  <p className="text-sm"><strong>Subject:</strong> {emailPreview.subject}</p>
                </div>
              )}

              {filledPdfUrl && (
                <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
                  <iframe
                    src={filledPdfUrl}
                    className="h-[500px] w-full"
                    title="Generated Claim Form Preview"
                  />
                </div>
              )}

              <button
                onClick={handleReset}
                className="w-full rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Process Another Receipt
              </button>
            </div>
          )}
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        onProfileChange={handleProfileChange}
        pdfFields={pdfFields}
        onPdfFieldsChange={handlePdfFieldsChange}
        mappings={mappings}
        onMappingsChange={handleMappingsChange}
        templateName={templateName}
        onTemplateNameChange={handleTemplateNameChange}
      />
    </div>
  );
}
