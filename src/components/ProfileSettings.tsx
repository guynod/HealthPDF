"use client";

import { UserProfile } from "@/lib/types";

interface ProfileSettingsProps {
  profile: UserProfile;
  onChange: (profile: UserProfile) => void;
}

const PROFILE_FIELDS: { key: keyof UserProfile; label: string; type?: string }[] = [
  { key: "patientName", label: "Full Name" },
  { key: "dateOfBirth", label: "Date of Birth", type: "date" },
  { key: "policyNumber", label: "Policy Number" },
  { key: "memberId", label: "Member ID" },
  { key: "insuranceGroup", label: "Insurance Group" },
  { key: "patientAddress", label: "Address" },
  { key: "insurerName", label: "Insurance Company Name" },
  { key: "insurerEmail", label: "Insurance Company Email", type: "email" },
];

export default function ProfileSettings({
  profile,
  onChange,
}: ProfileSettingsProps) {
  const handleChange = (key: keyof UserProfile, value: string) => {
    onChange({ ...profile, [key]: value });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Your Details
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROFILE_FIELDS.map((field) => (
            <div
              key={field.key}
              className={field.key === "patientAddress" ? "sm:col-span-2" : ""}
            >
              <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {field.label}
              </label>
              <input
                type={field.type || "text"}
                value={profile[field.key]}
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
          Email Templates
        </h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Subject Line Template
            </label>
            <input
              type="text"
              value={profile.emailSubjectTemplate}
              onChange={(e) =>
                handleChange("emailSubjectTemplate", e.target.value)
              }
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Body Template
            </label>
            <textarea
              value={profile.emailBodyTemplate}
              onChange={(e) =>
                handleChange("emailBodyTemplate", e.target.value)
              }
              rows={8}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-500 focus:bg-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-blue-500 dark:focus:bg-zinc-900"
            />
          </div>
          <p className="text-xs text-zinc-400">
            Use {"{fieldName}"} placeholders. Available: {"{patientName}"},{" "}
            {"{policyNumber}"}, {"{providerName}"}, {"{dateOfService}"},{" "}
            {"{amountCharged}"}, {"{currency}"}, {"{insurerName}"}
          </p>
        </div>
      </div>
    </div>
  );
}
