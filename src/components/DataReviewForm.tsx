"use client";

import {
  ClaimData,
  CLAIM_FIELD_META,
  DiagnosisSuggestion,
  FxConversion,
  ProviderClassification,
  ValidationWarning,
} from "@/lib/types";

interface DataReviewFormProps {
  data: ClaimData;
  onChange: (data: ClaimData) => void;
  warnings?: ValidationWarning[];
  providerClassification?: ProviderClassification | null;
  fxConversion?: FxConversion | null;
  diagnosisSuggestions?: DiagnosisSuggestion[];
  diagnosisConfirmed?: boolean;
  onDiagnosisConfirmedChange?: (value: boolean) => void;
}

export default function DataReviewForm({
  data,
  onChange,
  warnings = [],
  providerClassification = null,
  fxConversion = null,
  diagnosisSuggestions = [],
  diagnosisConfirmed = false,
  onDiagnosisConfirmedChange,
}: DataReviewFormProps) {
  const profileFields = CLAIM_FIELD_META.filter((f) => f.source === "profile");
  const receiptFields = CLAIM_FIELD_META.filter((f) => f.source === "receipt");

  const handleChange = (key: string, value: string) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="space-y-6">
      {(providerClassification || fxConversion) && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          {providerClassification && (
            <p className="text-sm text-blue-800 dark:text-blue-200">
              Provider classification: <strong>{providerClassification.category}</strong>{" "}
              ({Math.round(providerClassification.confidence * 100)}% confidence, {providerClassification.source}
              {providerClassification.lookupUsed ? ", web-assisted" : ""})
            </p>
          )}
          {fxConversion && (
            <p className="mt-1 text-sm text-blue-800 dark:text-blue-200">
              FX conversion: {fxConversion.sourceAmount} {fxConversion.sourceCurrency} {"->"}{" "}
              {fxConversion.usdAmount.toFixed(2)} USD ({fxConversion.rateDate}, {fxConversion.provider})
            </p>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Validation Warnings
          </p>
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}_${index}`}>- {warning.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          From Your Profile
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {profileFields.map((field) => (
            <div key={field.key}>
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {field.label}
              </label>
              <input
                type="text"
                value={data[field.key] || ""}
                onChange={(e) => handleChange(field.key, e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-900"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-200 dark:border-zinc-700" />

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Extracted from Receipt
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {receiptFields.map((field) => (
            <div
              key={field.key}
              className={field.key === "description" ? "sm:col-span-2" : ""}
            >
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {field.label}
              </label>
              {field.key === "description" ? (
                <textarea
                  value={data[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-900"
                />
              ) : (
                <input
                  type="text"
                  value={data[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-900"
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Diagnosis Coding (ICD-10-CM)
        </h3>
        {diagnosisSuggestions.length > 0 && (
          <div className="mb-3 grid gap-2">
            {diagnosisSuggestions.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => handleChange("diagnosisCode", item.code)}
                className={`rounded-lg border px-3 py-2 text-left text-sm ${
                  data.diagnosisCode === item.code
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                    : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <span className="font-medium">{item.code}</span> - {item.label} (
                {Math.round(item.confidence * 100)}%)
              </button>
            ))}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={diagnosisConfirmed}
            onChange={(e) => onDiagnosisConfirmedChange?.(e.target.checked)}
            className="mt-0.5"
          />
          I confirm the diagnosis code selection.
        </label>
      </div>
    </div>
  );
}
