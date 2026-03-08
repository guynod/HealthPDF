export interface ClaimData {
  patientName: string;
  dateOfBirth: string;
  policyNumber: string;
  memberId: string;
  insuranceGroup: string;
  patientAddress: string;
  gender: string;
  providerName: string;
  providerAddress: string;
  dateOfService: string;
  description: string;
  diagnosis: string;
  amountCharged: string;
  currency: string;
  receiptNumber: string;
  [key: string]: string;
}

export interface PDFFieldInfo {
  name: string;
  type: "text" | "checkbox" | "dropdown" | "radio" | "other";
}

export type MappingTransform =
  | "none"
  | "date_month"
  | "date_day"
  | "date_year"
  | "checkbox_truthy"
  | "checkbox_equals";

export interface FieldMapping {
  pdfFieldName: string;
  claimDataKey: string;
  transform?: MappingTransform;
  staticValue?: string;
  confidence?: number;
  source?: "manual" | "auto" | "ai" | "preset";
  reason?: string;
}

export interface MappingSuggestion extends FieldMapping {
  confidence: number;
  reason: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface UserProfile {
  patientName: string;
  dateOfBirth: string;
  policyNumber: string;
  memberId: string;
  insuranceGroup: string;
  patientAddress: string;
  insurerName: string;
  insurerEmail: string;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
}

export const EMPTY_PROFILE: UserProfile = {
  patientName: "",
  dateOfBirth: "",
  policyNumber: "",
  memberId: "",
  insuranceGroup: "",
  patientAddress: "",
  insurerName: "",
  insurerEmail: "",
  emailSubjectTemplate:
    "Health Insurance Claim - {patientName} - {dateOfService}",
  emailBodyTemplate: `Dear {insurerName},

Please find attached my health insurance claim form for services received on {dateOfService}.

Policy Number: {policyNumber}
Patient: {patientName}
Provider: {providerName}
Amount: {amountCharged} {currency}

Please let me know if you require any additional documentation.

Best regards,
{patientName}`,
};

export const EMPTY_CLAIM: ClaimData = {
  patientName: "",
  dateOfBirth: "",
  policyNumber: "",
  memberId: "",
  insuranceGroup: "",
  patientAddress: "",
  gender: "",
  providerName: "",
  providerAddress: "",
  dateOfService: "",
  description: "",
  diagnosis: "",
  amountCharged: "",
  currency: "",
  receiptNumber: "",
};

export const CLAIM_FIELD_META: {
  key: string;
  label: string;
  source: "profile" | "receipt";
}[] = [
  { key: "patientName", label: "Patient Name", source: "profile" },
  { key: "dateOfBirth", label: "Date of Birth", source: "profile" },
  { key: "policyNumber", label: "Policy Number", source: "profile" },
  { key: "memberId", label: "Member ID", source: "profile" },
  { key: "insuranceGroup", label: "Insurance Group", source: "profile" },
  { key: "patientAddress", label: "Patient Address", source: "profile" },
  { key: "gender", label: "Gender", source: "profile" },
  { key: "providerName", label: "Provider Name", source: "receipt" },
  { key: "providerAddress", label: "Provider Address", source: "receipt" },
  { key: "dateOfService", label: "Date of Service", source: "receipt" },
  { key: "description", label: "Service Description", source: "receipt" },
  { key: "diagnosis", label: "Diagnosis", source: "receipt" },
  { key: "amountCharged", label: "Amount Charged", source: "receipt" },
  { key: "currency", label: "Currency", source: "receipt" },
  { key: "receiptNumber", label: "Receipt/Invoice Number", source: "receipt" },
];
