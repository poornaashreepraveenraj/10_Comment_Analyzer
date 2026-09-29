const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  initLangSmithEnv,
  isLangSmithTracingActive,
  redactSensitiveData,
  getRunConfig,
} = require('../src/tracing');

test('redactSensitiveData redacts API keys, tokens, emails, phone numbers, and credentials', () => {
  const sensitiveText = [
    'My key is AIzaSyBeCSWqLvYVzFjDAmCidqbSZFTBbZxxkDM please keep it safe.',
    'Auth token is Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and openai sk-12345678901234567890123456.',
    'Contact me at creator@gmail.com or whatsapp +1-234-567-8900.',
    'Database connection password=supersecret1234&host=localhost',
  ].join(' ');

  const cleaned = redactSensitiveData(sensitiveText);

  assert.ok(!cleaned.includes('AIzaSyBeCSWqLvYVzFjDAmCidqbSZFTBbZxxkDM'), 'Google API key must be redacted');
  assert.ok(cleaned.includes('[REDACTED_API_KEY]'), 'Redaction placeholder must be present');
  assert.ok(!cleaned.includes('creator@gmail.com'), 'Email must be redacted');
  assert.ok(cleaned.includes('[REDACTED_EMAIL]'), 'Redaction placeholder must be present');
  assert.ok(!cleaned.includes('+1-234-567-8900'), 'Phone number must be redacted');
  assert.ok(cleaned.includes('[REDACTED_PHONE]'), 'Redaction placeholder must be present');
  assert.ok(!cleaned.includes('Bearer eyJhbGci'), 'Bearer token must be redacted');
  assert.ok(cleaned.includes('Bearer [REDACTED_TOKEN]'), 'Bearer token replacement must be present');
  assert.ok(!cleaned.includes('password=supersecret1234'), 'Password must be redacted');
});

test('initLangSmithEnv correctly synchronizes environment variables when valid key provided', () => {
  const prevTracing = process.env.LANGSMITH_TRACING;
  const prevKey = process.env.LANGSMITH_API_KEY;
  const prevProject = process.env.LANGSMITH_PROJECT;

  try {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2_pt_testkey123456';
    process.env.LANGSMITH_PROJECT = 'test-comment-project';

    const status = initLangSmithEnv();

    assert.equal(status.enabled, true);
    assert.equal(status.project, 'test-comment-project');
    assert.equal(process.env.LANGCHAIN_TRACING_V2, 'true');
    assert.equal(process.env.LANGCHAIN_API_KEY, 'lsv2_pt_testkey123456');
    assert.equal(process.env.LANGCHAIN_PROJECT, 'test-comment-project');
    assert.equal(isLangSmithTracingActive(), true);
  } finally {
    if (prevTracing !== undefined) process.env.LANGSMITH_TRACING = prevTracing; else delete process.env.LANGSMITH_TRACING;
    if (prevKey !== undefined) process.env.LANGSMITH_API_KEY = prevKey; else delete process.env.LANGSMITH_API_KEY;
    if (prevProject !== undefined) process.env.LANGSMITH_PROJECT = prevProject; else delete process.env.LANGSMITH_PROJECT;
  }
});

test('initLangSmithEnv gracefully treats placeholder API key as inactive without crashing', () => {
  const prevTracing = process.env.LANGSMITH_TRACING;
  const prevKey = process.env.LANGSMITH_API_KEY;

  try {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGSMITH_API_KEY = 'your_langsmith_api_key_here';

    const status = initLangSmithEnv();

    assert.equal(status.enabled, false);
    assert.ok(status.reason.includes('placeholder'));
    assert.equal(isLangSmithTracingActive(), false);
  } finally {
    if (prevTracing !== undefined) process.env.LANGSMITH_TRACING = prevTracing; else delete process.env.LANGSMITH_TRACING;
    if (prevKey !== undefined) process.env.LANGSMITH_API_KEY = prevKey; else delete process.env.LANGSMITH_API_KEY;
  }
});

test('getRunConfig creates structured LangChain / LangSmith run configuration', () => {
  const config = getRunConfig({
    videoTitle: 'Test Tutorial - How to shoot 4K [email: john@test.com]',
    batchIndex: 1,
    totalBatches: 2,
    batchSize: 10,
    modelName: 'gemini-1.5-flash',
  });

  assert.ok(typeof config.runName === 'string');
  assert.ok(Array.isArray(config.tags));
  assert.ok(config.metadata);
  assert.equal(config.metadata.batchIndex, 1);
  assert.equal(config.metadata.totalBatches, 2);
  assert.equal(config.metadata.batchSize, 10);
  assert.equal(config.metadata.model, 'gemini-1.5-flash');
  assert.ok(!config.runName.includes('john@test.com'), 'runName should not contain sensitive data');
});
