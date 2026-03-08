"use client";

import { ClaimData, CLAIM_FIELD_META, ValidationWarning } from "@/lib/types";

interface DataReviewFormProps {
  data: ClaimData;
  onChange: (data: ClaimData) => void;
  warnings?: ValidationWarning[];
}

export default function DataReviewForm({
  data,
  onChange,
  warnings = [],
}: DataReviewFormProps) {
  const profileFields = CLAIM_FIELD_META.filter((f) => f.source === "profile");
  const receiptFields = CLAIM_FIELD_META.filter((f) => f.source === "receipt");

  const handleChange = (key: string, value: string) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Validation Warnings
          </p>
          <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
            {warnings.map((warning) => (
              <li key={warning.code}>- {warning.message}</li>
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
    </div>
  );
}
