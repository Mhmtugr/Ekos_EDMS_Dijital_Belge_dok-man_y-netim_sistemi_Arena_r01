// Yerel mod parola politikası. Uzunluk NIST SP 800-63B ruhunda; karmaşıklık kuralı zorlanmaz.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordIssue =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "CONTAINS_EMAIL_LOCAL_PART"
  | "REPEATED_SINGLE_CHARACTER";

export function validatePassword(password: string, email: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) issues.push("TOO_SHORT");
  if (length > PASSWORD_MAX_LENGTH) issues.push("TOO_LONG");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 3 && password.toLowerCase().includes(local)) {
    issues.push("CONTAINS_EMAIL_LOCAL_PART");
  }
  if (/^(.)\1+$/u.test(password)) issues.push("REPEATED_SINGLE_CHARACTER");
  return issues;
}
