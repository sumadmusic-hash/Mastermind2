const REFUSAL_PATTERNS_EN = [
  /i (?:can't|cannot|won't|will not) (?:help|assist|provide|create|generate)/i,
  /i'?m (?:sorry|afraid),? (?:but )?i (?:can't|cannot)/i,
  /as an ai (?:language )?model,? i (?:can't|cannot)/i,
  /i(?:'m| am) not able to/i,
  /content (?:policy|filter)/i,
  /this request (?:violates|goes against)/i,
];

const REFUSAL_PATTERNS_DE = [
  /ich (?:kann|darf|werde) (?:nicht|leider nicht)/i,
  /es tut mir leid,? (?:aber )?ich kann/i,
  /als ki-(?:modell|assistent) (?:kann|darf) ich/i,
  /ich bin (?:leider )?nicht in der lage/i,
  /inhaltsrichtlinien/i,
  /diese anfrage verstößt/i,
];

export function detectRefusal(text: string): { isRefusal: boolean; reason: string } {
  const allPatterns = [...REFUSAL_PATTERNS_EN, ...REFUSAL_PATTERNS_DE];
  for (const pattern of allPatterns) {
    if (pattern.test(text)) {
      return { isRefusal: true, reason: `Refusal erkannt: "${text.slice(0, 100)}..."` };
    }
  }
  return { isRefusal: false, reason: '' };
}
