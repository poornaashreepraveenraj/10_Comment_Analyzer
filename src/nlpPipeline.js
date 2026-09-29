const { analyseComments } = require('./agent');

/**
 * Smart mock classifier — uses keyword heuristics so demo data
 * shows real variety (Questions, Complaints, Opportunities, Themes).
 */
function mockClassify(id, text) {
  const t = text.toLowerCase();
  if (/(partner|collab|brand|agency|client|sponsor|commercial|shoot|rate|pricing|send you|reach out|dm us)/i.test(t)) {
    return { id, category: 'Opportunity', subCategory: 'Brand collab', sentiment: 'Positive', actionable: true, summary: 'Potential business opportunity or brand partnership.' };
  }
  if (/\?|what|how|where|when|which|can you|do you|tutorial|explain|tell me|software|app|preset|plugin/i.test(t)) {
    return { id, category: 'Question', subCategory: 'Tutorial request', sentiment: 'Neutral', actionable: true, summary: 'User is asking a specific question that deserves a reply.' };
  }
  if (/(broken|bug|crash|glitch|out of sync|not working|terrible|disappointed|ripoff|boring|fix|please fix|hard to watch|bad|worst|hate)/i.test(t)) {
    return { id, category: 'Complaint', subCategory: 'Quality / Bug Report', sentiment: 'Negative', actionable: true, summary: 'User expressing dissatisfaction or reporting an issue.' };
  }
  return { id, category: 'Theme', subCategory: 'General reaction', sentiment: 'Positive', actionable: false, summary: 'Positive general comment about the content.' };
}

async function classifyComment(commentText) {
  const res = await analyseComments([{ youtube_comment_id: 'c_single', text: commentText }], 'Comment');
  const item = res.results.get('c_single');
  if (item) {
    return {
      category: item.category,
      subCategory: item.sub_category,
      sentiment: item.sentiment,
      actionable: item.is_actionable,
      summary: item.summary || item.suggested_reply || '',
    };
  }
  const fallback = mockClassify('_', commentText);
  return {
    category: fallback.category,
    subCategory: fallback.subCategory,
    sentiment: fallback.sentiment,
    actionable: fallback.actionable,
    summary: fallback.summary,
  };
}

async function classifyBatch(commentsArray = []) {
  if (!commentsArray || commentsArray.length === 0) return [];
  const mapped = commentsArray.map(c => ({
    youtube_comment_id: c.id,
    text: c.text,
  }));
  const res = await analyseComments(mapped, 'Batch');
  return commentsArray.map(c => {
    const item = res.results.get(c.id);
    if (item) {
      return {
        id: c.id,
        category: item.category,
        subCategory: item.sub_category,
        sentiment: item.sentiment,
        actionable: item.is_actionable,
        summary: item.summary || item.suggested_reply || '',
      };
    }
    return mockClassify(c.id, c.text);
  });
}

module.exports = {
  classifyComment,
  classifyBatch,
  mockClassify,
};
