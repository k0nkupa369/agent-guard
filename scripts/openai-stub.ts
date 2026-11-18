import assert from 'node:assert/strict';

const mode = process.env.AGENT_GUARD_STUB;
const fakeKey = 'test-only-agent-guard-key';
const definition = {
  fields: [
    { name: 'name', required: true },
    { name: 'email', required: true },
    { name: 'message', required: true },
    { name: 'reference', required: true },
  ],
  emailFields: ['reference', 'name', 'email', 'message'],
};
const proposal = {
  fields: [...definition.fields, { name: 'company', required: false }],
  emailFields: [...definition.emailFields, 'company'],
};
const localFetch = globalThis.fetch;
let requests = 0;
let invalidRequest = false;

process.on('exit', () => {
  console.error(`Stub provider requests: ${requests}`);
  if (invalidRequest) process.exitCode = 90;
});

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
    if (mode === 'broken-baseline' && init?.method === 'POST') {
      return new Response('Baseline submission failed', { status: 503 });
    }
    return localFetch(input, init);
  }

  requests++;
  try {
    assert.equal(url.href, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    assert.ok(new Headers(init?.headers).get('authorization') === `Bearer ${fakeKey}`);
    const body = JSON.parse(String(init?.body));
    assert.doesNotMatch(String(init?.body), new RegExp(fakeKey));
    assert.equal(body.model, 'gpt-6-luna');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 1024);
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(JSON.parse(body.input).formDefinition, definition);
    assert.match(JSON.parse(body.input).task, /optional Company/);
  } catch {
    invalidRequest = true;
    throw new Error('Unexpected stub request');
  }

  if (mode === 'http-error') return Response.json({ error: { message: fakeKey } }, { status: 429 });
  if (mode === 'transport-error') throw new Error(fakeKey);
  if (mode === 'incomplete') return Response.json({ status: 'incomplete', incomplete_details: { reason: fakeKey } });

  let text = JSON.stringify(proposal);
  if (mode === 'rollback') text = JSON.stringify({ ...proposal, emailFields: [] });
  if (mode === 'malformed') text = `{ ${fakeKey}`;
  if (mode === 'out-of-scope') {
    text = JSON.stringify({ ...proposal, fields: [...proposal.fields, { name: fakeKey, required: false }] });
  }
  const content = mode === 'refusal' ? { type: 'refusal', refusal: fakeKey } : { type: 'output_text', text };
  return Response.json({
    status: 'completed',
    output: [
      { type: 'reasoning' },
      { type: 'message', status: 'completed', role: 'assistant', content: [content] },
    ],
  });
};
