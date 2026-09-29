const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'comments.db');
const db = new Database(dbPath);

// Initialize tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    video_id TEXT PRIMARY KEY,
    video_url TEXT,
    video_title TEXT,
    channel_name TEXT,
    total_comments INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_comment_id TEXT UNIQUE,
    video_id TEXT,
    author_name TEXT,
    raw_text TEXT,
    cleaned_text TEXT,
    category TEXT,
    sub_category TEXT,
    sentiment TEXT,
    tone TEXT,
    is_actionable INTEGER DEFAULT 0,
    prime_for_reel INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    suggested_reply TEXT,
    summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES posts(video_id)
  );

  CREATE TABLE IF NOT EXISTS summaries (
    video_id TEXT PRIMARY KEY,
    top_themes TEXT,
    main_questions TEXT,
    sentiment_overview TEXT,
    creator_actions TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (video_id) REFERENCES posts(video_id)
  );
`);

/**
 * Run migrations idempotently. SQLite throws if column exists, which is caught and ignored.
 */
function runMigrations() {
  const migrations = [
    'ALTER TABLE comments RENAME COLUMN instagram_comment_id TO youtube_comment_id',
    'ALTER TABLE posts RENAME COLUMN shortcode TO video_id',
    'ALTER TABLE posts RENAME COLUMN original_url TO video_url',
    'ALTER TABLE posts ADD COLUMN video_title TEXT',
    'ALTER TABLE posts ADD COLUMN channel_name TEXT',
    'ALTER TABLE comments ADD COLUMN tone TEXT',
    'ALTER TABLE comments ADD COLUMN suggested_reply TEXT',
    'ALTER TABLE comments ADD COLUMN priority INTEGER DEFAULT 0',
    'ALTER TABLE comments ADD COLUMN author_name TEXT',
    'ALTER TABLE comments ADD COLUMN prime_for_reel INTEGER DEFAULT 0',
  ];

  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err) {
      // Column already exists or already renamed, safely ignore
    }
  }

  try {
    const commentsCols = db.prepare('PRAGMA table_info(comments)').all().map(c => c.name);
    if (commentsCols.includes('prime_for_video') && commentsCols.includes('prime_for_reel')) {
      db.exec('UPDATE comments SET prime_for_reel = prime_for_video WHERE prime_for_reel IS NULL OR prime_for_reel = 0');
    }
  } catch (err) { }

  // Populate any legacy posts with default title / channel if empty
  try {
    db.exec(`
      UPDATE posts
      SET video_title = COALESCE(video_title, 'Video ' || video_id),
          channel_name = COALESCE(channel_name, 'YouTube Creator')
      WHERE video_title IS NULL OR channel_name IS NULL
    `);
  } catch (err) { }
}

runMigrations();

/**
 * Upserts a video post record.
 * @param {Object} postData { video_id, video_url, video_title, channel_name, total_comments }
 */
function upsertPost(postData) {
  const videoId = postData.video_id || postData.videoId;
  const videoUrl = postData.video_url || postData.videoUrl || postData.original_url || '';
  const videoTitle = postData.video_title || postData.videoTitle || `Video ${videoId}`;
  const channelName = postData.channel_name || postData.channelName || 'YouTube Creator';
  const totalComments = postData.total_comments !== undefined ? postData.total_comments : (postData.totalFetched || 0);

  const stmt = db.prepare(`
    INSERT INTO posts (video_id, video_url, video_title, channel_name, total_comments)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      video_url = excluded.video_url,
      video_title = excluded.video_title,
      channel_name = excluded.channel_name,
      total_comments = excluded.total_comments
  `);

  stmt.run(videoId, videoUrl, videoTitle, channelName, totalComments);
}

/**
 * Saves or updates processed comments for a video.
 * @param {string} videoId
 * @param {Array<Object>} commentsList
 */
function saveComments(videoId, commentsList = []) {
  const deleteStmt = db.prepare('DELETE FROM comments WHERE video_id = ?');
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO comments (
      youtube_comment_id, video_id, author_name, raw_text, cleaned_text,
      category, sub_category, sentiment, tone, is_actionable, prime_for_reel,
      priority, suggested_reply, summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((vid, items) => {
    deleteStmt.run(vid);
    for (const c of items) {
      insertStmt.run(
        c.youtube_comment_id || c.id,
        vid,
        c.author_name || c.authorName || c.user || '',
        c.raw_text || c.text || '',
        c.cleaned_text || c.text || '',
        c.category || 'Theme',
        c.sub_category || c.subCategory || '',
        c.sentiment || 'Neutral',
        c.tone || '',
        c.is_actionable ? 1 : 0,
        c.prime_for_reel ? 1 : 0,
        Number.isInteger(c.priority) ? c.priority : 0,
        c.suggested_reply || c.suggestedReply || '',
        c.summary || ''
      );
    }
  });

  tx(videoId, commentsList);
}

/**
 * Saves a video's batch summary.
 * @param {string} videoId
 * @param {Object} summary { top_themes, main_questions, sentiment_overview, creator_actions }
 */
function saveBatchSummary(videoId, summary) {
  if (!videoId || !summary) return;

  const topThemes = JSON.stringify(summary.top_themes || []);
  const mainQuestions = JSON.stringify(summary.main_questions || []);
  const sentimentOverview = String(summary.sentiment_overview || '');
  const creatorActions = JSON.stringify(summary.creator_actions || []);

  const stmt = db.prepare(`
    INSERT INTO summaries (video_id, top_themes, main_questions, sentiment_overview, creator_actions)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      top_themes = excluded.top_themes,
      main_questions = excluded.main_questions,
      sentiment_overview = excluded.sentiment_overview,
      creator_actions = excluded.creator_actions,
      created_at = CURRENT_TIMESTAMP
  `);

  stmt.run(videoId, topThemes, mainQuestions, sentimentOverview, creatorActions);
}

/**
 * Retrieves the batch summary for a video.
 * @param {string} videoId
 */
function getBatchSummary(videoId) {
  if (!videoId) return null;
  const row = db.prepare('SELECT * FROM summaries WHERE video_id = ?').get(videoId);
  if (!row) return null;

  try {
    return {
      top_themes: JSON.parse(row.top_themes || '[]'),
      main_questions: JSON.parse(row.main_questions || '[]'),
      sentiment_overview: row.sentiment_overview || '',
      creator_actions: JSON.parse(row.creator_actions || '[]'),
      created_at: row.created_at,
    };
  } catch (err) {
    return null;
  }
}

/**
 * Retrieves all analyzed videos/posts.
 */
function getAllPosts() {
  const rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC').all();
  return rows.map(r => ({
    ...r,
    shortcode: r.video_id,
    original_url: r.video_url,
  }));
}

/**
 * Retrieves comments with flexible filters and pagination.
 * @param {Object} filters { videoId, category, sentiment, priority, page, limit }
 */
function getComments(filters = {}) {
  const conditions = [];
  const params = [];

  const videoId = filters.videoId || filters.video_id;
  if (videoId) {
    conditions.push('video_id = ?');
    params.push(videoId);
  }

  if (filters.category && filters.category !== 'All') {
    conditions.push('LOWER(category) = LOWER(?)');
    params.push(filters.category);
  }

  if (filters.sentiment && filters.sentiment !== 'All') {
    conditions.push('LOWER(sentiment) = LOWER(?)');
    params.push(filters.sentiment);
  }

  if (filters.priority !== undefined && filters.priority !== 'All' && filters.priority !== '') {
    let pVal = filters.priority;
    if (typeof pVal === 'string') {
      if (pVal.toLowerCase() === 'high') pVal = 2;
      else if (pVal.toLowerCase() === 'medium') pVal = 1;
      else if (pVal.toLowerCase() === 'low') pVal = 0;
      else pVal = parseInt(pVal, 10);
    }
    if (!isNaN(pVal)) {
      conditions.push('priority = ?');
      params.push(pVal);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(`SELECT COUNT(*) as count FROM comments ${whereClause}`).get(...params);
  const total = countRow ? countRow.count : 0;

  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.max(1, Math.min(200, parseInt(filters.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
    SELECT * FROM comments
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return {
    comments: rows.map(r => ({
      ...r,
      post_shortcode: r.video_id,
      instagram_comment_id: r.youtube_comment_id,
      prime_for_video: r.prime_for_reel,
    })),
    total,
    page,
    limit,
  };
}

/**
 * Retrieves metric counts for a specific video.
 * @param {string} videoId
 */
function getMetricsForVideo(videoId) {
  const totalProcessed = db.prepare('SELECT COUNT(*) as count FROM comments WHERE video_id = ?').get(videoId).count;
  const actionableQuestions = db.prepare("SELECT COUNT(*) as count FROM comments WHERE video_id = ? AND category = 'Question' AND is_actionable = 1").get(videoId).count;
  const priorityComplaints = db.prepare("SELECT COUNT(*) as count FROM comments WHERE video_id = ? AND category = 'Complaint'").get(videoId).count;
  const contentLeads = db.prepare("SELECT COUNT(*) as count FROM comments WHERE video_id = ? AND category = 'Opportunity'").get(videoId).count;
  const primeForReel = db.prepare("SELECT COUNT(*) as count FROM comments WHERE video_id = ? AND prime_for_reel = 1").get(videoId).count;

  return {
    totalProcessed,
    actionableQuestions,
    priorityComplaints,
    contentLeads,
    primeForReel,
    primeForVideo: primeForReel,
  };
}

module.exports = {
  db,
  upsertPost,
  savePostAnalysis: (v, c) => {
    upsertPost(v);
    saveComments(v.video_id || v.videoId, c);
  },
  saveComments,
  saveBatchSummary,
  getBatchSummary,
  getAllPosts,
  getComments,
  getVideoComments: (videoId) => getComments({ videoId, limit: 1000 }).comments,
  getPostByShortcode: (videoId) => getComments({ videoId, limit: 1000 }).comments,
  getMetricsForVideo,
  getMetricsForPost: getMetricsForVideo,
};
