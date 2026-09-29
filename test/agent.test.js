const assert = require('node:assert/strict');
const { test } = require('node:test');
const { analyseComments, getLatestBatchSummary } = require('../src/agent');

test('analyseComments returns a results Map and structured summary', async () => {
  const sampleComments = [
    {
      youtube_comment_id: 'test_c1',
      text: 'How do you configure the camera exposure settings for night shots? Can you explain in a tutorial?',
      authorName: 'NightShooter',
    },
    {
      youtube_comment_id: 'test_c2',
      text: 'We would love to sponsor your next video. Who can we reach out to for brand partnership?',
      authorName: 'SponsorBrand',
    },
    {
      youtube_comment_id: 'test_c3',
      text: 'The background music was way too loud and ruined the voiceover, please fix!',
      authorName: 'AnnoyedViewer',
    },
    {
      youtube_comment_id: 'test_c4',
      text: 'Earn $5000 weekly guaranteed crypto bitcoin whatsapp +123456789',
      authorName: 'SpamBot',
    },
    {
      youtube_comment_id: 'test_c5',
      text: 'Incredible editing and storytelling, loved this episode so much!',
      authorName: 'HappyViewer',
    },
  ];

  const output = await analyseComments(sampleComments, 'Camera Tutorial Review');

  assert.ok(output.results instanceof Map, 'results should be an instance of Map');
  assert.equal(output.results.size, sampleComments.length, 'all comments should be processed');

  const question = output.results.get('test_c1');
  assert.equal(question.category, 'Question');
  assert.equal(question.is_actionable, true);
  assert.ok(question.suggested_reply.length > 0, 'suggested reply should exist for actionable question');

  const opp = output.results.get('test_c2');
  assert.equal(opp.category, 'Opportunity');
  assert.equal(opp.is_actionable, true);

  const complaint = output.results.get('test_c3');
  assert.equal(complaint.category, 'Complaint');
  assert.equal(complaint.is_actionable, true);

  const spam = output.results.get('test_c4');
  assert.equal(spam.category, 'Spam');

  const theme = output.results.get('test_c5');
  assert.equal(theme.category, 'Theme');

  // Verify batch summary structure
  assert.ok(output.summary, 'summary should exist');
  assert.ok(Array.isArray(output.summary.top_themes), 'summary.top_themes should be an array');
  assert.ok(Array.isArray(output.summary.main_questions), 'summary.main_questions should be an array');
  assert.ok(typeof output.summary.sentiment_overview === 'string', 'sentiment_overview should be string');
  assert.ok(Array.isArray(output.summary.creator_actions), 'creator_actions should be array');
});
