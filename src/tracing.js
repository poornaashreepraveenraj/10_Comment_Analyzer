require('dotenv').config();

/**
 * LangSmith Tracing & Observability Module
 * Handles configuration, environment variable synchronization,
 * privacy redaction, and run metadata for LangChain and LangSmith.
 */

// Regex patterns for sensitive data redaction
const SENSITIVE_PATTERNS = [
  // Google / OpenAI / Generic API keys
  { regex: /\b(AIza[0-9A-Za-z-_]{35}|sk-[a-zA-Z0-9]{20,}|AQ\.[a-zA-Z0-9_-]{30,})\b/g, replacement: '[REDACTED_API_KEY]' },
  // Bearer tokens and Authorization headers
  { regex: /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  // Email addresses
  { regex: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, replacement: '[REDACTED_EMAIL]' },
  // Phone numbers (e.g., in spam or comments)
  { regex: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,6}/g, replacement: '[REDACTED_PHONE]' },
  // Password or secret credentials in key=value format
  { regex: /(password|passwd|secret|apikey|api_key)\s*[:=]\s*\S+/gi, replacement: '$1=[REDACTED]' },
];

/**
 * Redacts potentially sensitive fields (credentials, emails, phones, API keys)
 * from input text to protect user privacy in LangSmith traces.
 * @param {string} text
 * @returns {string}
 */
function redactSensitiveData(text) {
  if (typeof text !== 'string') return text;
  let sanitized = text;
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

/**
 * Synchronizes and standardizes LangSmith / LangChain environment variables.
 * Ensures compatibility between LANGSMITH_* and legacy LANGCHAIN_* variables.
 */
function initLangSmithEnv() {
  const apiKey = process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  const project = process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || 'comment-analysis';
  const endpoint = process.env.LANGSMITH_ENDPOINT || process.env.LANGCHAIN_ENDPOINT || 'https://api.smith.langchain.com';
  const tracing = process.env.LANGSMITH_TRACING || process.env.LANGCHAIN_TRACING_V2;

  const isExplicitlyEnabled = tracing === 'true' || tracing === '1';
  const hasValidKey = apiKey && apiKey !== 'your_langsmith_api_key_here' && apiKey.trim().length > 0;

  if (isExplicitlyEnabled && hasValidKey) {
    process.env.LANGSMITH_TRACING = 'true';
    process.env.LANGCHAIN_TRACING_V2 = 'true';
    process.env.LANGSMITH_API_KEY = apiKey;
    process.env.LANGCHAIN_API_KEY = apiKey;
    process.env.LANGSMITH_PROJECT = project;
    process.env.LANGCHAIN_PROJECT = project;
    process.env.LANGSMITH_ENDPOINT = endpoint;
    process.env.LANGCHAIN_ENDPOINT = endpoint;
    return {
      enabled: true,
      project,
      endpoint,
    };
  }

  // If tracing is requested but API key is missing or placeholder, disable active tracing to avoid 403 network spam
  if (isExplicitlyEnabled && !hasValidKey) {
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGCHAIN_TRACING_V2;
    return {
      enabled: false,
      reason: 'LANGSMITH_API_KEY is not configured or is using placeholder value.',
      project,
    };
  }

  return {
    enabled: false,
    reason: 'LANGSMITH_TRACING is set to false or not defined.',
    project,
  };
}

/**
 * Checks whether LangSmith tracing is currently active and configured.
 * @returns {boolean}
 */
function isLangSmithTracingActive() {
  const tracing = process.env.LANGSMITH_TRACING || process.env.LANGCHAIN_TRACING_V2;
  const apiKey = process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  return (tracing === 'true' || tracing === '1') && Boolean(apiKey && apiKey !== 'your_langsmith_api_key_here');
}

/**
 * Constructs run configuration for LangChain agent and chain invocations.
 * Injects runName, tags, metadata, and handles safe privacy boundaries.
 * @param {Object} options
 * @returns {Object}
 */
function getRunConfig(options = {}) {
  const { videoTitle = 'unknown', batchIndex = 1, totalBatches = 1, batchSize = 0, modelName = 'gemini-1.5-flash' } = options;
  const project = process.env.LANGSMITH_PROJECT || 'comment-analysis';

  const cleanTitle = redactSensitiveData(videoTitle).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().slice(0, 40) || 'Video';

  return {
    runName: `Batch_Analysis_${cleanTitle}_[${batchIndex}/${totalBatches}]`,
    tags: ['comment-analyzer', 'youtube-agent', `batch-${batchIndex}`],
    metadata: {
      project,
      batchIndex,
      totalBatches,
      batchSize,
      model: modelName,
      agentType: 'createToolCallingAgent',
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = {
  initLangSmithEnv,
  isLangSmithTracingActive,
  redactSensitiveData,
  getRunConfig,
};
