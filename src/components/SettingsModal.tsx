"use client";

import { useCallback, useState } from "react";
import { UserProfile, PDFFieldInfo, FieldMapping } from "@/lib/types";
import { discoverFields } from "@/lib/pdf-utils";
import { saveTemplate } from "@/lib/storage";
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
  const [loading, setLoading] = useState(false);

  const handleTemplateUpload = useCallback(
    async (file: File) => {
      setTemplateError("");
      setLoading(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fields = await discoverFields(bytes);

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
      } catch (err) {
        setTemplateError(
          err instanceof Error ? err.message : "Failed to read PDF"
        );
      } finally {
        setLoading(false);
      }
    },
    [onPdfFieldsChange, onTemplateNameChange]
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
