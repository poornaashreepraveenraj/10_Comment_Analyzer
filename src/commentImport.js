const { parse } = require('csv-parse/sync');

const MAX_COMMENTS = 5000;

/**
 * Parses raw pasted comments into structured objects.
 * One comment per non-empty line.
 * @param {string} text
 * @returns {Array<{ user: string, text: string }>}
 */
function parsePastedComments(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Add at least one comment to analyze.');
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error('Add at least one comment to analyze.');
  }

  if (lines.length > MAX_COMMENTS) {
    throw new Error(`A single import can include at most ${MAX_COMMENTS} comments.`);
  }

  return lines.map(line => ({
    user: '',
    text: line,
  }));
}

/**
 * Parses a CSV string into structured comments.
 * Requires a "text" or "comment" column. Optional "username" or "user" column.
 * @param {string} csvText
 * @returns {Array<{ user: string, text: string }>}
 */
function parseCsvComments(csvText) {
  if (!csvText || typeof csvText !== 'string' || !csvText.trim()) {
    throw new Error('Add at least one comment to analyze.');
  }

  let records;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });
  } catch (err) {
    throw new Error(`Invalid CSV: ${err.message}`);
  }

  if (!records || records.length === 0) {
    throw new Error('Add at least one comment to analyze.');
  }

  // Find the text column name (case-insensitive)
  const sample = records[0];
  const keys = Object.keys(sample);
  const textKey = keys.find(k => /^(text|comment|comment_text|body)$/i.test(k));
  if (!textKey) {
    throw new Error('The CSV needs a "text" or "comment" column.');
  }

  const userKey = keys.find(k => /^(username|user|author|author_name|name)$/i.test(k));

  const comments = [];
  for (const record of records) {
    const rawText = record[textKey];
    if (!rawText || !rawText.trim()) continue;

    comments.push({
      user: userKey && record[userKey] ? record[userKey].trim() : '',
      text: rawText.trim(),
    });
  }

  if (comments.length === 0) {
    throw new Error('Add at least one comment to analyze.');
  }

  if (comments.length > MAX_COMMENTS) {
    throw new Error(`A single import can include at most ${MAX_COMMENTS} comments.`);
  }

  return comments;
}

module.exports = {
  parsePastedComments,
  parseCsvComments,
  parseCsvContent: parseCsvComments,
};