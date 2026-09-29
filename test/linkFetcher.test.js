const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const { extractVideoId, fetchCommentsForVideo } = require('../src/linkFetcher');

const originalFetch = global.fetch;
const originalApiKey = process.env.YOUTUBE_API_KEY;

after(() => {
  global.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.YOUTUBE_API_KEY;
  } else {
    process.env.YOUTUBE_API_KEY = originalApiKey;
  }
});

test('extractVideoId extracts YouTube video IDs from various URL formats and raw IDs', () => {
  const cases = [
    { input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtube.com/watch?v=dQw4w9WgXcQ&t=10s&feature=share', expected: 'dQw4w9WgXcQ' },
    { input: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtu.be/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtu.be/dQw4w9WgXcQ?t=20', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/embed/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'https://www.youtube.com/live/dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: 'dQw4w9WgXcQ', expected: 'dQw4w9WgXcQ' },
    { input: '  dQw4w9WgXcQ  ', expected: 'dQw4w9WgXcQ' },
  ];

  for (const { input, expected } of cases) {
    assert.equal(extractVideoId(input), expected, `Failed to extract ID from: ${input}`);
  }

  assert.equal(extractVideoId('https://google.com'), null);
  assert.equal(extractVideoId(''), null);
  assert.equal(extractVideoId(null), null);
});

test('fetchCommentsForVideo calls YouTube Data API commentThreads endpoint with required parameters', async () => {
  process.env.YOUTUBE_API_KEY = 'test-youtube-api-key';
  const videoId = 'dQw4w9WgXcQ';
  let requestedCommentThreadsUrl = null;
  let requestedVideosUrl = null;

  global.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/youtube/v3/commentThreads') {
      requestedCommentThreadsUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          kind: 'youtube#commentThreadListResponse',
          items: [
            {
              id: 'thread-1',
              snippet: {
                videoId,
                topLevelComment: {
                  id: 'comment-1',
                  snippet: {
                    authorDisplayName: 'TechFan',
                    textOriginal: 'Awesome video! How did you edit this?',
                    textDisplay: 'Awesome video! How did you edit this?',
                  },
                },
              },
            },
            {
              id: 'thread-2',
              snippet: {
                videoId,
                topLevelComment: {
                  id: 'comment-2',
                  snippet: {
                    authorDisplayName: 'BrandManager',
                    textOriginal: 'We would love to sponsor your next upload. DM us!',
                    textDisplay: 'We would love to sponsor your next upload. DM us!',
                  },
                },
              },
            },
          ],
        }),
      };
    }

    if (parsed.pathname === '/youtube/v3/videos') {
      requestedVideosUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              id: videoId,
              snippet: {
                title: 'Building an AI Comment Analyzer',
                channelTitle: 'Creator Studio',
              },
            },
          ],
        }),
      };
    }

    return { ok: false, status: 404, json: async () => ({}) };
  };

  const result = await fetchCommentsForVideo(videoId);

  assert.ok(requestedCommentThreadsUrl, 'commentThreads endpoint was called');
  const commentUrlObj = new URL(requestedCommentThreadsUrl);
  assert.equal(commentUrlObj.searchParams.get('videoId'), videoId);
  assert.equal(commentUrlObj.searchParams.get('part'), 'snippet');
  assert.equal(commentUrlObj.searchParams.get('maxResults'), '100');
  assert.equal(commentUrlObj.searchParams.get('order'), 'relevance');
  assert.equal(commentUrlObj.searchParams.get('key'), 'test-youtube-api-key');

  assert.equal(result.videoTitle, 'Building an AI Comment Analyzer');
  assert.equal(result.channelName, 'Creator Studio');
  assert.equal(result.comments.length, 2);
  assert.deepEqual(result.comments.map(c => ({ id: c.id, user: c.user, text: c.text })), [
    { id: 'comment-1', user: 'TechFan', text: 'Awesome video! How did you edit this?' },
    { id: 'comment-2', user: 'BrandManager', text: 'We would love to sponsor your next upload. DM us!' },
  ]);
});

test('fetchCommentsForVideo provides realistic mock fallback when no API key is provided', async () => {
  delete process.env.YOUTUBE_API_KEY;

  const result = await fetchCommentsForVideo('dQw4w9WgXcQ');

  assert.ok(Array.isArray(result.comments));
  assert.ok(result.comments.length > 0);
  assert.ok(result.comments[0].text);
  assert.ok(result.comments[0].id);
  assert.ok(result.videoTitle);
  assert.ok(result.channelName);
});

test('fetchComments throws quota exceeded error on 403', async () => {
  const { fetchComments } = require('../src/youtube');
  process.env.YOUTUBE_API_KEY = 'test-key';
  global.fetch = async (url) => {
    if (url.includes('commentThreads')) {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            errors: [{ reason: 'quotaExceeded' }],
            message: 'Quota exceeded',
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };

  await assert.rejects(
    async () => {
      await fetchComments('dQw4w9WgXcQ');
    },
    {
      message: 'YouTube API quota exceeded — try again tomorrow',
    }
  );
});

test('fetchComments throws video not found or comments disabled error on 404', async () => {
  const { fetchComments } = require('../src/youtube');
  process.env.YOUTUBE_API_KEY = 'test-key';
  global.fetch = async (url) => {
    if (url.includes('commentThreads')) {
      return {
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            errors: [{ reason: 'videoNotFound' }],
            message: 'The video was not found.',
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };

  await assert.rejects(
    async () => {
      await fetchComments('dQw4w9WgXcQ');
    },
    {
      message: 'Video not found or comments are disabled',
    }
  );
});

test('fetchComments throws video not found or comments disabled error when commentsDisabled', async () => {
  const { fetchComments } = require('../src/youtube');
  process.env.YOUTUBE_API_KEY = 'test-key';
  global.fetch = async (url) => {
    if (url.includes('commentThreads')) {
      return {
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            errors: [{ reason: 'commentsDisabled' }],
            message: 'The video identified has disabled comments.',
          },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };

  await assert.rejects(
    async () => {
      await fetchComments('dQw4w9WgXcQ');
    },
    {
      message: 'Video not found or comments are disabled',
    }
  );
});