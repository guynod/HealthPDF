"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { UserProfile, PDFFieldInfo, FieldMapping } from "@/lib/types";
import { discoverFields, extractProfileDefaultsFromTemplate } from "@/lib/pdf-utils";
import { loadTemplate, saveTemplate } from "@/lib/storage";
import {
  base64ToBytes,
  buildPortableConfig,
  parsePortableConfigJson,
} from "@/lib/portable-config";
import ProfileSettings from "./ProfileSettings";
import FieldMapper from "./FieldMapper";
import UploadZone from "./UploadZone";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileChange: (profile: UserProfile) => void;
  pdfFields: PDFFieldInfo[];
  onPdfFieldsChange: (fields: PDFFieldInfo[]) => void;
  mappings: FieldMapping[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
  templateName: string;
  onTemplateNameChange: (name: string) => void;
}

export default function SettingsModal({
  open,
  onClose,
  profile,
  onProfileChange,
  pdfFields,
  onPdfFieldsChange,
  mappings,
  onMappingsChange,
  templateName,
  onTemplateNameChange,
}: SettingsModalProps) {
  const [tab, setTab] = useState<"profile" | "template">("profile");
  const [templateError, setTemplateError] = useState("");
  const [templateInfo, setTemplateInfo] = useState("");
  const [bundleInfo, setBundleInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const handleTemplateUpload = useCallback(
    async (file: File) => {
      setTemplateError("");
      setTemplateInfo("");
      setLoading(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fields = await discoverFields(bytes);
        const defaults = await extractProfileDefaultsFromTemplate(bytes);

        if (fields.length === 0) {
          setTemplateError(
            "No fillable fields found. Make sure your PDF has interactive form fields."
          );
          setLoading(false);
          return;
        }

        await saveTemplate(bytes);
        onPdfFieldsChange(fields);
        onTemplateNameChange(file.name);

        const mergedProfile: UserProfile = { ...profile };
        let applied = 0;
        for (const [key, value] of Object.entries(defaults.profile) as Array<
          [keyof UserProfile, string]
        >) {
          if (!mergedProfile[key] && value) {
            mergedProfile[key] = value;
            applied += 1;
          }
        }
        if (applied > 0) {
          onProfileChange(mergedProfile);
          setTemplateInfo(`Pre-filled ${applied} profile field(s) from claim form values.`);
        } else if (defaults.notes.length > 0) {
          setTemplateInfo(
            "Claim form values detected, but your existing profile already had those fields filled."
          );
        }
      } catch (err) {
        setTemplateError(
          err instanceof Error ? err.message : "Failed to read PDF"
        );
      } finally {
        setLoading(false);
      }
    },
    [onPdfFieldsChange, onTemplateNameChange, profile, onProfileChange]
  );

  const handleExportBundle = useCallback(async () => {
    setTemplateError("");
    setBundleInfo("");
    try {
      const templateBytes = await loadTemplate();
      if (!templateBytes) {
        setTemplateError("Upload a claim form template before exporting a portable config.");
        return;
      }

      const config = buildPortableConfig({
        profile,
        pdfFields,
        mappings,
        templateName,
        templateBytes,
      });
      const blob = new Blob([JSON.stringify(config, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `healthpdf-geha-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBundleInfo("Portable config exported.");
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : "Failed to export portable config"
      );
    }
  }, [profile, pdfFields, mappings, templateName]);

  const handleImportBundle = useCallback(
    async (file: File) => {
      setTemplateError("");
      setBundleInfo("");
      setLoading(true);
      try {
        const result = parsePortableConfigJson(await file.text());
        if (!result.ok) {
          setTemplateError(result.errors.join(" "));
          return;
        }

        const templateBytes = base64ToBytes(result.config.templatePdfBase64);
        await saveTemplate(templateBytes);
        onProfileChange(result.config.profile);
        onPdfFieldsChange(result.config.pdfFields);
        onMappingsChange(result.config.mappings);
        onTemplateNameChange(result.config.templateName);
        setBundleInfo(
          `Portable config imported with ${result.config.pdfFields.length} PDF field(s) and ${result.config.mappings.length} mapping(s).`
        );
      } catch (err) {
        setTemplateError(
          err instanceof Error ? err.message : "Failed to import portable config"
        );
      } finally {
        setLoading(false);
      }
    },
    [onProfileChange, onPdfFieldsChange, onMappingsChange, onTemplateNameChange]
  );

  const handleBundleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      await handleImportBundle(file);
    },
    [handleImportBundle]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-zinc-200 px-6 dark:border-zinc-700">
          <button
            onClick={() => setTab("profile")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "profile"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Profile & Email
          </button>
          <button
            onClick={() => setTab("template")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === "template"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            Claim Form Template
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "profile" ? (
            <ProfileSettings profile={profile} onChange={onProfileChange} />
          ) : (
            <div className="space-y-5">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Portable GEHA Config
                </h3>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  Export or restore this browser setup, including the claim form template, profile defaults, PDF fields, and mappings.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleExportBundle}
                    disabled={loading}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Export Config
                  </button>
                  <button
                    type="button"
                    onClick={() => bundleInputRef.current?.click()}
                    disabled={loading}
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Import Config
                  </button>
                  <input
                    ref={bundleInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleBundleFileChange}
                  />
                </div>
                {bundleInfo && (
                  <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                    {bundleInfo}
                  </p>
                )}
              </div>
              <UploadZone
                label="Upload Claim Form Template (PDF)"
                accept=".pdf"
                hint="Drag & drop your insurance company's fillable PDF form"
                onFile={handleTemplateUpload}
                disabled={loading}
                currentFileName={templateName}
              />
              {templateError && (
                <p className="text-sm text-red-500">{templateError}</p>
              )}
              {templateInfo && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {templateInfo}
                </p>
              )}
              {loading && (
                <p className="text-sm text-zinc-500">Analyzing PDF fields...</p>
              )}

              <FieldMapper
                pdfFields={pdfFields}
                mappings={mappings}
                onChange={onMappingsChange}
              />
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
