import { UserProfile, ClaimData } from "./types";

function interpolate(
  template: string,
  data: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => data[key] || "");
}

export function generateMailtoLink(
  profile: UserProfile,
  claimData: ClaimData
): string {
  const merged: Record<string, string> = { ...claimData, ...profile };
  const subject = interpolate(profile.emailSubjectTemplate, merged);
  const body = interpolate(profile.emailBodyTemplate, merged);

  return `mailto:${encodeURIComponent(profile.insurerEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function generateEmailPreview(
  profile: UserProfile,
  claimData: ClaimData
): { to: string; subject: string; body: string } {
  const merged: Record<string, string> = { ...claimData, ...profile };
  const subject = interpolate(profile.emailSubjectTemplate, merged);
  return {
    to: profile.insurerEmail,
    subject,
    body: interpolate(profile.emailBodyTemplate, merged),
  };
}
