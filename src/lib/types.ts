export interface ClaimData {
  patientName: string;
  subscriberName: string;
  subscriberContact: string;
  dateOfBirth: string;
  planName: string;
  insurerName: string;
  policyNumber: string;
  memberId: string;
  insuranceGroup: string;
  patientAddress: string;
  gender: string;
  foreignProvider: string;
  serviceCountry: string;
  claimType: string;
  providerName: string;
  providerAddress: string;
  dateOfService: string;
  description: string;
  diagnosis: string;
  diagnosisCode: string;
  amountCharged: string;
  amountUSD: string;
  currency: string;
  receiptNumber: string;
  additionalNotes: string;
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

export interface ProviderClassification {
  category: "lab" | "doctor_visit" | "hospital" | "imaging" | "pharmacy" | "other";
  confidence: number;
  source: "heuristic" | "lookup";
  evidence: string;
  lookupUsed: boolean;
}

export interface FxConversion {
  sourceCurrency: string;
  sourceAmount: number;
  usdAmount: number;
  rate: number;
  rateDate: string;
  provider: string;
  status: "ok" | "missing_data" | "lookup_failed";
}

export interface DiagnosisSuggestion {
  code: string;
  label: string;
  confidence: number;
}

export interface ValidationWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface ExtractResponsePayload {
  data: ClaimData;
  mappingSuggestions: MappingSuggestion[];
  validationWarnings: ValidationWarning[];
  providerClassification: ProviderClassification | null;
  fxConversion: FxConversion | null;
  diagnosisSuggestions: DiagnosisSuggestion[];
}

export interface UserProfile {
  patientName: string;
  subscriberName: string;
  subscriberContact: string;
  dateOfBirth: string;
  planName: string;
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
  subscriberName: "",
  subscriberContact: "",
  dateOfBirth: "",
  planName: "",
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
  subscriberName: "",
  subscriberContact: "",
  dateOfBirth: "",
  planName: "",
  insurerName: "",
  policyNumber: "",
  memberId: "",
  insuranceGroup: "",
  patientAddress: "",
  gender: "",
  foreignProvider: "",
  serviceCountry: "",
  claimType: "",
  providerName: "",
  providerAddress: "",
  dateOfService: "",
  description: "",
  diagnosis: "",
  diagnosisCode: "",
  amountCharged: "",
  amountUSD: "",
  currency: "",
  receiptNumber: "",
  additionalNotes: "",
};

export const CLAIM_FIELD_META: {
  key: string;
  label: string;
  source: "profile" | "receipt";
}[] = [
  { key: "patientName", label: "Patient Name", source: "profile" },
  { key: "subscriberName", label: "Subscriber Name", source: "profile" },
  { key: "subscriberContact", label: "Subscriber Contact", source: "profile" },
  { key: "dateOfBirth", label: "Date of Birth", source: "profile" },
  { key: "planName", label: "Plan Name", source: "profile" },
  { key: "insurerName", label: "Insurer Name", source: "profile" },
  { key: "policyNumber", label: "Policy Number", source: "profile" },
  { key: "memberId", label: "Member ID", source: "profile" },
  { key: "insuranceGroup", label: "Insurance Group", source: "profile" },
  { key: "patientAddress", label: "Patient Address", source: "profile" },
  { key: "gender", label: "Gender", source: "profile" },
  { key: "foreignProvider", label: "Foreign Provider (Yes/No)", source: "receipt" },
  { key: "serviceCountry", label: "Service Country", source: "receipt" },
  { key: "claimType", label: "Claim Type", source: "receipt" },
  { key: "providerName", label: "Provider Name", source: "receipt" },
  { key: "providerAddress", label: "Provider Address", source: "receipt" },
  { key: "dateOfService", label: "Date of Service", source: "receipt" },
  { key: "description", label: "Service Description", source: "receipt" },
  { key: "diagnosis", label: "Diagnosis", source: "receipt" },
  { key: "diagnosisCode", label: "Diagnosis Code (ICD-10-CM)", source: "receipt" },
  { key: "amountCharged", label: "Amount Charged", source: "receipt" },
  { key: "amountUSD", label: "Amount (USD)", source: "receipt" },
  { key: "currency", label: "Currency", source: "receipt" },
  { key: "receiptNumber", label: "Receipt/Invoice Number", source: "receipt" },
  { key: "additionalNotes", label: "Additional Notes", source: "receipt" },
];
