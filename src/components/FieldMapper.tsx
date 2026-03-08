"use client";

import { PDFFieldInfo, FieldMapping, CLAIM_FIELD_META } from "@/lib/types";
import { getPresetMappingForField } from "@/lib/form-presets";

interface FieldMapperProps {
  pdfFields: PDFFieldInfo[];
  mappings: FieldMapping[];
  onChange: (mappings: FieldMapping[]) => void;
}

export default function FieldMapper({
  pdfFields,
  mappings,
  onChange,
}: FieldMapperProps) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

  const getMapping = (pdfFieldName: string): FieldMapping | undefined => {
    return mappings.find((m) => m.pdfFieldName === pdfFieldName);
  };

  const counts = mappings.reduce(
    (acc, mapping) => {
      if (mapping.source === "preset") acc.preset += 1;
      else if (mapping.source === "manual") acc.manual += 1;
      else if (mapping.source === "ai") acc.ai += 1;
      else acc.auto += 1;
      return acc;
    },
    { preset: 0, manual: 0, ai: 0, auto: 0 }
  );

  const getMappedKey = (pdfFieldName: string): string => {
    return getMapping(pdfFieldName)?.claimDataKey || "";
  };

  const handleMap = (pdfFieldName: string, claimDataKey: string) => {
    const filtered = mappings.filter((m) => m.pdfFieldName !== pdfFieldName);
    if (claimDataKey) {
      filtered.push({
        pdfFieldName,
        claimDataKey,
        transform: "none",
        source: "manual",
      });
    }
    onChange(filtered);
  };

  const scoreFieldMatch = (
    fieldName: string,
    claimKey: string,
    label: string
  ): number => {
    const fieldNorm = normalize(fieldName);
    const keyNorm = normalize(claimKey);
    const labelNorm = normalize(label);
    let score = 0;

    if (fieldNorm.includes(keyNorm)) score += 5;
    if (fieldNorm.includes(labelNorm)) score += 4;
    if (fieldNorm.startsWith(keyNorm.slice(0, 4))) score += 2;

    const synonymMap: Record<string, string[]> = {
      dateOfBirth: ["dob", "birth", "birthdate", "birthday"],
      policyNumber: ["policy", "policyno", "policynumber", "insuredid"],
      memberId: ["member", "subscriber", "subscriberid", "insuredid"],
      insuranceGroup: ["group", "groupnumber", "employer", "plan"],
      patientName: ["patient", "insured", "fullname", "membername"],
      dateOfService: ["service", "visitdate", "treatmentdate"],
      amountCharged: ["amount", "total", "charge", "cost"],
      receiptNumber: ["invoice", "receipt", "claimnumber", "referenceno"],
      gender: ["gender", "sex", "male", "female"],
    };
    for (const synonym of synonymMap[claimKey] || []) {
      if (fieldNorm.includes(normalize(synonym))) score += 3;
    }

    return score;
  };

  const autoMap = () => {
    const newMappings: FieldMapping[] = [];
    for (const pdfField of pdfFields) {
      const fieldNorm = normalize(pdfField.name);

      const presetMatch = getPresetMappingForField(pdfField);
      if (presetMatch) {
        newMappings.push(presetMatch);
        continue;
      }

      if (
        (fieldNorm.includes("dob") || fieldNorm.includes("birth")) &&
        (fieldNorm.includes("month") || fieldNorm.endsWith("mm"))
      ) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: "dateOfBirth",
          transform: "date_month",
          source: "auto",
          confidence: 0.95,
          reason: "Detected DOB month field",
        });
        continue;
      }

      if (
        (fieldNorm.includes("dob") || fieldNorm.includes("birth")) &&
        (fieldNorm.includes("day") || fieldNorm.endsWith("dd"))
      ) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: "dateOfBirth",
          transform: "date_day",
          source: "auto",
          confidence: 0.95,
          reason: "Detected DOB day field",
        });
        continue;
      }

      if (
        (fieldNorm.includes("dob") || fieldNorm.includes("birth")) &&
        (fieldNorm.includes("year") || fieldNorm.endsWith("yyyy") || fieldNorm.endsWith("yy"))
      ) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: "dateOfBirth",
          transform: "date_year",
          source: "auto",
          confidence: 0.95,
          reason: "Detected DOB year field",
        });
        continue;
      }

      if (pdfField.type === "checkbox" && fieldNorm.includes("male")) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: "gender",
          transform: "checkbox_equals",
          staticValue: "male",
          source: "auto",
          confidence: 0.92,
          reason: "Detected male checkbox",
        });
        continue;
      }

      if (pdfField.type === "checkbox" && fieldNorm.includes("female")) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: "gender",
          transform: "checkbox_equals",
          staticValue: "female",
          source: "auto",
          confidence: 0.92,
          reason: "Detected female checkbox",
        });
        continue;
      }

      let bestScore = 0;
      let bestMatch: (typeof CLAIM_FIELD_META)[number] | null = null;
      for (const meta of CLAIM_FIELD_META) {
        const score = scoreFieldMatch(pdfField.name, meta.key, meta.label);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = meta;
        }
      }

      if (bestMatch && bestScore >= 3) {
        newMappings.push({
          pdfFieldName: pdfField.name,
          claimDataKey: bestMatch.key,
          transform: pdfField.type === "checkbox" ? "checkbox_truthy" : "none",
          source: "auto",
          confidence: Math.min(0.99, bestScore / 10),
          reason: "Name and synonym matching",
        });
      }
    }

    onChange(newMappings);
  };

  if (pdfFields.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Upload a PDF template first to see its fields.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Map each PDF field to the corresponding claim data field.
        </p>
        <button
          onClick={autoMap}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          Auto-Map
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/40">
        <span className="font-medium text-zinc-500">Matched:</span>
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          Preset {counts.preset}
        </span>
        <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
          AI {counts.ai}
        </span>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Auto {counts.auto}
        </span>
        <span className="rounded bg-zinc-200 px-2 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
          Manual {counts.manual}
        </span>
      </div>

      <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
        {pdfFields.map((field) => (
          <div
            key={field.name}
            className="flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {field.name}
              </p>
              <p className="text-xs text-zinc-400">{field.type}</p>
              {getMapping(field.name)?.source && (
                <p className="text-xs text-zinc-500">
                  source: {getMapping(field.name)?.source}
                </p>
              )}
              {typeof getMapping(field.name)?.confidence === "number" && (
                <p className="text-xs text-blue-500">
                  confidence: {(getMapping(field.name)!.confidence! * 100).toFixed(0)}%
                </p>
              )}
            </div>

            <svg
              className="h-4 w-4 shrink-0 text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>

            <select
              value={getMappedKey(field.name)}
              onChange={(e) => handleMap(field.name, e.target.value)}
              className="w-44 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none transition-colors focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            >
              <option value="">-- Skip --</option>
              {CLAIM_FIELD_META.map((meta) => (
                <option key={meta.key} value={meta.key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-400">
        {mappings.length} of {pdfFields.length} fields mapped
      </p>
    </div>
  );
}
