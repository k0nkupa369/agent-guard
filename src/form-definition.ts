export const fieldDetails = {
  name: { label: 'Name', control: 'text' },
  email: { label: 'Email', control: 'email' },
  message: { label: 'Message', control: 'textarea' },
  reference: { label: 'Reference', control: 'text' },
  company: { label: 'Company', control: 'text' },
} as const;

type FieldName = keyof typeof fieldDetails;

export type FormDefinition = {
  fields: { name: FieldName; required: boolean }[];
  emailFields: FieldName[];
};

export const originalForm: FormDefinition = {
  fields: [
    { name: 'name', required: true },
    { name: 'email', required: true },
    { name: 'message', required: true },
    { name: 'reference', required: true },
  ],
  emailFields: ['reference', 'name', 'email', 'message'],
};

const companyField = { name: 'company', required: false } as const;
const validProposal: FormDefinition = {
  fields: [...originalForm.fields, companyField],
  emailFields: [...originalForm.emailFields, 'company'],
};

export const bundledProposals = {
  'bundled-valid': validProposal,
  'bundled-broken': { ...validProposal, emailFields: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFormDefinition(value: unknown): value is FormDefinition {
  if (!isRecord(value) || Object.keys(value).length !== 2 ||
      !Array.isArray(value.fields) || value.fields.length === 0 || !Array.isArray(value.emailFields)) return false;

  const seen = new Set<FieldName>();
  for (const field of value.fields as unknown[]) {
    if (!isRecord(field) || Object.keys(field).length !== 2 ||
        typeof field.name !== 'string' || !Object.hasOwn(fieldDetails, field.name) ||
        typeof field.required !== 'boolean') return false;

    const name = field.name as FieldName;
    if (seen.has(name)) return false;
    seen.add(name);
  }
  const mailFields = new Set<FieldName>();
  for (const name of value.emailFields as unknown[]) {
    if (typeof name !== 'string' || !seen.has(name as FieldName) || mailFields.has(name as FieldName)) return false;
    mailFields.add(name as FieldName);
  }
  return true;
}
