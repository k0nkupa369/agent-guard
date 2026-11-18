import { fieldDetails, type FormDefinition } from './form-definition.ts';

export const openAIModel = 'gpt-6-luna';
const endpoint = 'https://api.openai.com/v1/responses';
const fieldName = { type: 'string', enum: Object.keys(fieldDetails) };
const definitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fields', 'emailFields'],
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'required'],
        properties: { name: fieldName, required: { type: 'boolean' } },
      },
    },
    emailFields: { type: 'array', items: fieldName },
  },
};

type ProposalResult =
  | { kind: 'proposal'; value: unknown }
  | { kind: 'invalid' | 'provider-error'; reason: string };

type ResponseBody = {
  status?: string;
  error?: unknown;
  output?: {
    type?: string;
    status?: string;
    role?: string;
    content?: { type?: string; text?: unknown }[];
  }[];
};

export async function requestOpenAIProposal(formDefinition: FormDefinition): Promise<ProposalResult> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { kind: 'provider-error', reason: 'OPENAI_API_KEY is missing' };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: openAIModel,
        store: false,
        reasoning: { effort: 'low' },
        max_output_tokens: 1024,
        instructions: 'Return only the updated contact form definition. Keep the existing fields, required flags, and email field order.',
        input: JSON.stringify({
          task: 'Add an optional Company field and append Company to the email fields.',
          formDefinition,
        }),
        text: { format: { type: 'json_schema', name: 'contact_form', strict: true, schema: definitionSchema } },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { kind: 'provider-error', reason: `OpenAI returned HTTP ${response.status}` };
    }

    const body: ResponseBody | null = await response.json();
    if (body?.status === 'failed' || body?.error != null) {
      return { kind: 'provider-error', reason: 'OpenAI reported a failed response' };
    }
    if (body?.status !== 'completed' || !Array.isArray(body.output)) {
      return { kind: 'invalid', reason: 'OpenAI did not return a completed proposal' };
    }

    const messages = body.output.filter((item) => item?.type === 'message');
    const message = messages[0];
    if (messages.length !== 1 || message?.status !== 'completed' ||
        message.role !== 'assistant' || !Array.isArray(message.content)) {
      return { kind: 'invalid', reason: 'Expected one completed assistant message' };
    }
    if (message.content.some((part) => part?.type === 'refusal')) {
      return { kind: 'invalid', reason: 'OpenAI refused the proposal request' };
    }
    const [part] = message.content;
    if (message.content.length !== 1 || part?.type !== 'output_text' || typeof part.text !== 'string') {
      return { kind: 'invalid', reason: 'Expected one proposal text item' };
    }
    return { kind: 'proposal', value: JSON.parse(part.text) };
  } catch (error) {
    // Provider bodies and exceptions can contain credentials.
    if (error instanceof SyntaxError) return { kind: 'invalid', reason: 'OpenAI returned malformed JSON' };
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { kind: 'provider-error', reason: 'OpenAI request timed out' };
    }
    return { kind: 'provider-error', reason: 'OpenAI request failed' };
  }
}
