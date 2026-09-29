const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCsvComments, parsePastedComments } = require('../src/commentImport');

test('parses CSV comments, optional usernames, quoted commas, and multiline text', () => {
  const csv = [
    'username,text',
    'alex,"Love this, thanks!"',
    'sam,"First line',
    'second line"',
  ].join('\n');

  assert.deepEqual(parseCsvComments(csv), [
    { user: 'alex', text: 'Love this, thanks!' },
    { user: 'sam', text: 'First line\nsecond line' },
  ]);
});

test('accepts comment as the CSV text header and ignores blank records', () => {
  assert.deepEqual(parseCsvComments('comment\nNice post\n\n'), [
    { user: '', text: 'Nice post' },
  ]);
});

test('parses one pasted comment per nonempty line', () => {
  assert.deepEqual(parsePastedComments('  Nice post!\r\n\r\nHow did you do this?  '), [
    { user: '', text: 'Nice post!' },
    { user: '', text: 'How did you do this?' },
  ]);
});

test('rejects empty input, missing text columns, and oversized imports', () => {
  assert.throws(() => parsePastedComments('  \n'), /at least one comment/);
  assert.throws(() => parseCsvComments('username\nalex'), /needs a "text" or "comment" column/);
  assert.throws(() => parsePastedComments(Array(5002).fill('comment').join('\n')), /at most 5000/);
  assert.throws(() => parseCsvComments('text\n"unfinished'), /Invalid CSV/);
});
