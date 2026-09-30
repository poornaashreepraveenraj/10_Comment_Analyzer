require('dotenv').config();
const express = require('express');
const path = require('path');
const { randomUUID } = require('crypto');
const { initLangSmithEnv } = require('./tracing');

const langsmithStatus = initLangSmithEnv();

const { extractVideoId, fetchComments } = require('./youtube');
const { processComment } = require('./hustleBot');
const { analyseComments, getLatestBatchSummary } = require('./agent');
const {
  upsertPost,
  saveComments,
  saveBatchSummary,
  getBatchSummary,
  getAllPosts,
  getComments,
  getMetricsForVideo,
} = require('./db');
const { parseCsvComments, parsePastedComments } = require('./commentImport');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ─────────────────────────────────────────────────────────────
   POST /analyse
   Body: { url: string }
───────────────────────────────────────────────────────────── */
app.post('/analyse', async (req, res) => {
  const timestamp = new Date().toISOString();
  let videoId = null;

  try {
    const rawUrl = req.body.url || req.body.videoId || req.body.video_id;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'YouTube video URL is required.',
      });
    }

    videoId = extractVideoId(rawUrl);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL. Please enter a valid watch, youtu.be, shorts link or video ID.',
      });
    }

    // 1. Fetch comments from YouTube Data API v3 (defaults to fetching all comments)
    const reqLimit = req.body.maxComments || req.body.limit;
    const isAll = reqLimit === 'all' || !reqLimit;
    const maxComments = isAll ? 10000 : parseInt(reqLimit, 10);
    const { videoTitle, channelName, comments } = await fetchComments(videoId, { maxComments });

    // 2. Pre-process comments with spam pre-filter regex and emoji translation
    const commentsToAgent = [];
    const prefilteredSpam = new Map();

    for (const c of comments) {
      const processed = processComment(c.text);
      if (processed.isSpam) {
        prefilteredSpam.set(c.youtube_comment_id, {
          youtube_comment_id: c.youtube_comment_id,
          text: c.text,
          author_name: c.authorName || '',
          category: 'Spam',
          sub_category: processed.spamReason || 'Promotional spam',
          sentiment: 'Neutral',
          tone: 'promotional',
          is_actionable: false,
          prime_for_reel: false,
          priority: 0,
          suggested_reply: '',
          summary: processed.spamReason || 'Flagged by spam pre-filter',
        });
      } else {
        commentsToAgent.push({
          youtube_comment_id: c.youtube_comment_id,
          text: processed.processedText || c.text,
          raw_text: c.text,
          authorName: c.authorName || '',
        });
      }
    }

    // 3. Upsert into posts table
    upsertPost({
      video_id: videoId,
      video_url: rawUrl,
      video_title: videoTitle,
      channel_name: channelName,
      total_comments: comments.length,
    });

    // 4. Call LangChain tool-calling agent
    let agentResults = new Map();
    let batchSummary = null;
    let isPartial = false;

    try {
      const agentOutput = await analyseComments(commentsToAgent, videoTitle);
      agentResults = agentOutput.results;
      batchSummary = agentOutput.summary;
      isPartial = Boolean(agentOutput.partial);
    } catch (agentErr) {
      console.error(`[${timestamp}] [videoId: ${videoId}] LangChain agent error: ${agentErr.message}`);
      isPartial = true;
      batchSummary = getLatestBatchSummary();
    }

    // 5. Merge prefiltered spam and agent results
    const allProcessed = [];
    for (const c of comments) {
      let record = prefilteredSpam.get(c.youtube_comment_id) || agentResults.get(c.youtube_comment_id);
      if (!record || !record.category) {
        record = {
          youtube_comment_id: c.youtube_comment_id,
          category: 'Theme',
          sub_category: 'General reaction',
          sentiment: 'Positive',
          tone: 'neutral',
          is_actionable: false,
          prime_for_reel: false,
          priority: 0,
          suggested_reply: '',
          summary: '',
        };
      }

      allProcessed.push({
        youtube_comment_id: c.youtube_comment_id,
        video_id: videoId,
        author_name: c.authorName || record.author_name || '',
        raw_text: c.text,
        cleaned_text: record.text || c.text,
        category: record.category || 'Theme',
        sub_category: record.sub_category || '',
        sentiment: record.sentiment || 'Neutral',
        tone: record.tone || '',
        is_actionable: record.is_actionable ? 1 : 0,
        prime_for_reel: record.prime_for_reel ? 1 : 0,
        priority: record.priority !== undefined ? record.priority : 0,
        suggested_reply: record.suggested_reply || '',
        summary: record.summary || '',
      });
    }

    // 6. Save comments and batch summary to database
    saveComments(videoId, allProcessed);
    saveBatchSummary(videoId, batchSummary);

    // 7. Calculate category breakdown
    const breakdown = { Theme: 0, Question: 0, Complaint: 0, Opportunity: 0, Spam: 0 };
    for (const item of allProcessed) {
      if (breakdown[item.category] !== undefined) {
        breakdown[item.category]++;
      }
    }

    const metrics = getMetricsForVideo(videoId);

    res.json({
      success: true,
      videoId,
      videoTitle,
      channelName,
      totalFetched: comments.length,
      summary: batchSummary,
      breakdown,
      partial: isPartial,
      metrics,
      comments: allProcessed,
    });
  } catch (err) {
    console.error(`[${timestamp}] [videoId: ${videoId || 'unknown'}] POST /analyse error: ${err.message}`);
    const message = err.message || 'An error occurred during analysis';
    res.status(500).json({
      success: false,
      error: message,
      partial: true,
    });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/comments
   Query params: videoId, category, sentiment, priority, page
───────────────────────────────────────────────────────────── */
app.get('/api/comments', (req, res) => {
  try {
    const { videoId, video_id, category, sentiment, priority, page, limit, paginated } = req.query;
    const targetVideoId = videoId || video_id;
    const result = getComments({
      videoId: targetVideoId,
      category,
      sentiment,
      priority,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 1000,
    });

    if (paginated === 'true') {
      return res.json(result);
    }
    res.json(result.comments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/posts  –  returns all rows from posts table
───────────────────────────────────────────────────────────── */
app.get('/api/posts', (req, res) => {
  try {
    res.json(getAllPosts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/summary/:videoId  –  returns batch summary for a video
───────────────────────────────────────────────────────────── */
app.get('/api/summary/:videoId', (req, res) => {
  try {
    const summary = getBatchSummary(req.params.videoId);
    if (!summary) {
      return res.status(404).json({ error: 'No summary found for this video' });
    }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /api/posts/:videoId/metrics
───────────────────────────────────────────────────────────── */
app.get('/api/posts/:videoId/metrics', (req, res) => {
  try {
    res.json(getMetricsForVideo(req.params.videoId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /api/analyze-import  –  CSV / text import fallback
───────────────────────────────────────────────────────────── */
app.post('/api/analyze-import', async (req, res) => {
  try {
    const { csvText, pastedText, sourceName } = req.body;
    const rawComments = csvText !== undefined
      ? parseCsvComments(csvText)
      : parsePastedComments(pastedText);

    const videoId = `import-${randomUUID()}`;
    const label = String(sourceName || 'Imported comments').trim().slice(0, 100) || 'Imported comments';
    const comments = rawComments.map((c, idx) => ({
      youtube_comment_id: `${videoId}_${idx + 1}`,
      text: c.text,
      authorName: c.user || 'User',
      likeCount: 0,
      publishedAt: new Date().toISOString(),
    }));

    upsertPost({
      video_id: videoId,
      video_url: `Import: ${label}`,
      video_title: label,
      channel_name: 'Manual Import',
      total_comments: comments.length,
    });

    const { results, summary, partial } = await analyseComments(comments, label);
    const allProcessed = comments.map(c => {
      const r = results.get(c.youtube_comment_id) || {};
      return {
        youtube_comment_id: c.youtube_comment_id,
        video_id: videoId,
        author_name: c.authorName,
        raw_text: c.text,
        cleaned_text: r.text || c.text,
        category: r.category || 'Theme',
        sub_category: r.sub_category || '',
        sentiment: r.sentiment || 'Neutral',
        tone: r.tone || '',
        is_actionable: r.is_actionable ? 1 : 0,
        prime_for_reel: r.prime_for_reel ? 1 : 0,
        priority: r.priority !== undefined ? r.priority : 0,
        suggested_reply: r.suggested_reply || '',
        summary: r.summary || '',
      };
    });

    saveComments(videoId, allProcessed);
    saveBatchSummary(videoId, summary);

    const breakdown = { Theme: 0, Question: 0, Complaint: 0, Opportunity: 0, Spam: 0 };
    for (const item of allProcessed) {
      if (breakdown[item.category] !== undefined) breakdown[item.category]++;
    }

    res.json({
      success: true,
      videoId,
      videoTitle: label,
      channelName: 'Manual Import',
      totalFetched: comments.length,
      summary,
      breakdown,
      partial,
      metrics: getMetricsForVideo(videoId),
      comments: allProcessed,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─── Start ─── */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✓  Server running → http://localhost:${PORT}`);
    if (langsmithStatus.enabled) {
      console.log(`✓  LangSmith Tracing active [Project: ${langsmithStatus.project}, Endpoint: ${langsmithStatus.endpoint}]`);
    } else {
      console.log(`ℹ  LangSmith Tracing inactive (${langsmithStatus.reason || 'disabled'})`);
    }
  });
}

module.exports = app;
