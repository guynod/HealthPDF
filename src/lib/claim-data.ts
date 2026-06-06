import type { ClaimData, UserProfile } from "./types";

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((value || "").trim());
}

function inferForeignProvider(data: ClaimData): string {
  const normalizedCurrency = (data.currency || "").toUpperCase();
  const rawForeign = (data.foreignProvider || "").trim().toLowerCase();
  const foreignTruthy =
    rawForeign === "yes" ||
    rawForeign === "true" ||
    rawForeign === "1" ||
    rawForeign === "y" ||
    rawForeign === "checked";
  const foreignSignal =
    normalizedCurrency && normalizedCurrency !== "USD"
      ? true
      : /(thailand|israel|japan|europe|france|spain|germany|uk|unitedkingdom|mexico|canada|australia)/i.test(
          `${data.serviceCountry || ""}`.replace(/\s+/g, "")
        );

  return foreignTruthy || foreignSignal ? "yes" : "no";
}

function inferClaimType(data: ClaimData): string {
  let normalizedClaimType = (data.claimType || "").trim().toLowerCase();
  if (normalizedClaimType && normalizedClaimType !== "other") {
    return normalizedClaimType;
  }

  const text = `${data.description || ""} ${data.providerName || ""}`.toLowerCase();
  if (/(outpatient|inpatient|hospital|emergency|clinic)/i.test(text)) {
    normalizedClaimType = "hospital";
  } else if (/(lab|laboratory|pathology|blood)/i.test(text)) {
    normalizedClaimType = "lab";
  } else if (/(xray|x-ray|mri|ct|ultrasound|radiology|imaging)/i.test(text)) {
    normalizedClaimType = "imaging";
  } else if (/(pharmacy|rx|prescription|drug)/i.test(text)) {
    normalizedClaimType = "pharmacy";
  } else if (/(doctor|physician|office visit|consult)/i.test(text)) {
    normalizedClaimType = "doctor_visit";
  }

  return normalizedClaimType || data.claimType;
}

export function mergeProfileIntoClaimData(
  data: ClaimData,
  profile: UserProfile
): ClaimData {
  return {
    ...data,
    patientName: data.patientName || profile.patientName,
    subscriberName: profile.subscriberName || data.subscriberName || profile.patientName,
    subscriberContact: profile.subscriberContact || data.subscriberContact,
    // Prefer profile DOB for stability; user can still edit per dependent claim.
    dateOfBirth:
      profile.dateOfBirth ||
      (isIsoDate(data.dateOfBirth) ? data.dateOfBirth : "") ||
      data.dateOfBirth,
    planName: profile.planName || profile.insurerName || data.planName || data.insurerName,
    insurerName: profile.insurerName || data.insurerName || profile.planName,
    policyNumber: profile.policyNumber || data.policyNumber,
    memberId: profile.memberId || data.memberId,
    insuranceGroup: profile.insuranceGroup || data.insuranceGroup,
    patientAddress: data.patientAddress || profile.patientAddress,
    foreignProvider: inferForeignProvider(data),
    claimType: inferClaimType(data),
  };
}
