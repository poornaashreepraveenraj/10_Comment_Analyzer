const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { createToolCallingAgent, AgentExecutor } = require('langchain/agents');
const { ChatPromptTemplate, MessagesPlaceholder } = require('@langchain/core/prompts');
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const { initLangSmithEnv, redactSensitiveData, getRunConfig } = require('./tracing');

// Initialize and synchronize LangSmith tracing environment variables
initLangSmithEnv();

const SYSTEM_PROMPT = `You are a YouTube comment analyst for a content creator dashboard.

You will receive a batch of comments from a single YouTube video.
For each comment, you must call categorise_comment or flag_spam — never skip a comment.
For every comment where is_actionable is true, also call suggest_reply.
After processing all comments, call summarise_batch once.

Categories:
- Theme: general praise, reactions, or observations about the content
- Question: viewer is asking the creator something
- Complaint: viewer is unhappy about something (audio, pacing, topic)
- Opportunity: potential collab, freelance inquiry, or business approach
- Spam: promotional, bot, or irrelevant commercial content

Be specific with sub_category. "Tutorial request" is better than "Question".
Priority 2 = creator must see this. Priority 1 = worth reviewing. Priority 0 = low signal.`;

// Module-level storage for batch summaries across calls
let latestBatchSummary = {
  top_themes: [],
  main_questions: [],
  sentiment_overview: 'Audience reactions are balanced with general praise and queries.',
  creator_actions: ['Engage with top questions in the comments'],
};

/**
 * Heuristic classifier fallback when Google API key is missing or agent encounters an error.
 */
function heuristicClassify(id, text) {
  const t = text.toLowerCase();
  if (/(crypto|bitcoin|whatsapp|telegram|invest|giveaway|dm me|check bio|free followers)/i.test(t)) {
    return {
      youtube_comment_id: id,
      text,
      category: 'Spam',
      sub_category: 'Commercial / bot spam',
      sentiment: 'Neutral',
      tone: 'promotional',
      is_actionable: false,
      prime_for_reel: false,
      priority: 0,
      suggested_reply: '',
      summary: 'Flagged as spam.',
    };
  }
  if (/(partner|collab|brand|agency|client|sponsor|commercial|shoot|rate|pricing|send you|reach out|dm us)/i.test(t)) {
    return {
      youtube_comment_id: id,
      text,
      category: 'Opportunity',
      sub_category: 'Brand collab',
      sentiment: 'Positive',
      tone: 'professional',
      is_actionable: true,
      prime_for_reel: true,
      priority: 2,
      suggested_reply: 'Thanks for reaching out! Please email our business inquiries contact in the channel bio.',
      summary: 'Potential partnership or sponsorship lead.',
    };
  }
  if (/\?|what|how|where|when|which|can you|do you|tutorial|explain|tell me|software|preset|plugin/i.test(t)) {
    return {
      youtube_comment_id: id,
      text,
      category: 'Question',
      sub_category: 'Tutorial request',
      sentiment: 'Neutral',
      tone: 'curious',
      is_actionable: true,
      prime_for_reel: true,
      priority: 1,
      suggested_reply: 'Great question! We will cover this in detail in an upcoming video.',
      summary: 'Viewer asking a specific how-to or tutorial query.',
    };
  }
  if (/(broken|bug|crash|glitch|out of sync|not working|terrible|disappointed|ripoff|boring|fix|please fix|hard to watch|bad|worst|hate)/i.test(t)) {
    return {
      youtube_comment_id: id,
      text,
      category: 'Complaint',
      sub_category: 'Pacing / Audio issue',
      sentiment: 'Negative',
      tone: 'frustrated',
      is_actionable: true,
      prime_for_reel: false,
      priority: 2,
      suggested_reply: 'Thanks for the feedback! We are working to fix this in future uploads.',
      summary: 'Negative feedback or quality complaint.',
    };
  }
  return {
    youtube_comment_id: id,
    text,
    category: 'Theme',
    sub_category: 'General reaction',
    sentiment: 'Positive',
    tone: 'enthusiastic',
    is_actionable: false,
    prime_for_reel: false,
    priority: 0,
    suggested_reply: '',
    summary: 'General audience praise or reaction.',
  };
}

/**
 * Creates tools bound to a specific execution results Map and summary container.
 * @param {Map<string, Object>} resultsMap
 * @param {Object} summaryBox
 */
function createAgentTools(resultsMap, summaryBox) {
  const categoriseCommentTool = tool(
    async (input) => {
      const existing = resultsMap.get(input.youtube_comment_id) || {};
      resultsMap.set(input.youtube_comment_id, {
        ...existing,
        youtube_comment_id: input.youtube_comment_id,
        text: input.text || existing.text || '',
        category: input.category,
        sub_category: input.sub_category,
        sentiment: input.sentiment,
        tone: input.tone,
        is_actionable: Boolean(input.is_actionable),
        prime_for_reel: Boolean(input.prime_for_reel),
        priority: typeof input.priority === 'number' ? input.priority : 0,
      });
      return 'categorised';
    },
    {
      name: 'categorise_comment',
      description: 'Assigns a category, sub-category, sentiment, tone, and priority to a single comment.',
      schema: z.object({
        youtube_comment_id: z.string().describe('Unique ID of the YouTube comment'),
        text: z.string().describe('The comment text'),
        category: z.enum(['Theme', 'Question', 'Complaint', 'Opportunity', 'Spam']).describe('Primary category'),
        sub_category: z.string().describe('Specific sub-category, e.g. "Tutorial request", "Technical issue", "Brand collab"'),
        sentiment: z.enum(['Positive', 'Negative', 'Neutral']).describe('Sentiment of the comment'),
        tone: z.string().describe('Tone, e.g. "enthusiastic", "frustrated", "sarcastic"'),
        is_actionable: z.boolean().describe('True if creator should respond or take action'),
        prime_for_reel: z.boolean().describe('True if the comment would work well as a video hook or reply'),
        priority: z.number().min(0).max(2).describe('0-2: 0 = low, 1 = medium, 2 = high'),
      }),
    }
  );

  const flagSpamTool = tool(
    async (input) => {
      const existing = resultsMap.get(input.youtube_comment_id) || {};
      resultsMap.set(input.youtube_comment_id, {
        ...existing,
        youtube_comment_id: input.youtube_comment_id,
        category: 'Spam',
        sub_category: input.reason || 'Promotional spam',
        sentiment: 'Neutral',
        tone: 'promotional',
        is_actionable: false,
        prime_for_reel: false,
        priority: 0,
      });
      return 'flagged as spam';
    },
    {
      name: 'flag_spam',
      description: 'Flags a comment as spam and records the matched pattern or reason.',
      schema: z.object({
        youtube_comment_id: z.string().describe('ID of the spam comment'),
        reason: z.string().describe('Reason for spam flag, e.g. "Contains crypto promotion", "Contains WhatsApp number"'),
      }),
    }
  );

  const suggestReplyTool = tool(
    async (input) => {
      const existing = resultsMap.get(input.youtube_comment_id) || {};
      resultsMap.set(input.youtube_comment_id, {
        ...existing,
        youtube_comment_id: input.youtube_comment_id,
        suggested_reply: input.reply,
      });
      return 'reply stored';
    },
    {
      name: 'suggest_reply',
      description: 'Generates a short, casual 1-2 sentence reply for actionable comments.',
      schema: z.object({
        youtube_comment_id: z.string().describe('ID of the comment to reply to'),
        reply: z.string().describe('1-2 sentence casual, on-brand reply the creator could post'),
      }),
    }
  );

  const summariseBatchTool = tool(
    async (input) => {
      const summary = {
        top_themes: Array.isArray(input.top_themes) ? input.top_themes.slice(0, 3) : [],
        main_questions: Array.isArray(input.main_questions) ? input.main_questions.slice(0, 3) : [],
        sentiment_overview: String(input.sentiment_overview || ''),
        creator_actions: Array.isArray(input.creator_actions) ? input.creator_actions.slice(0, 5) : [],
      };
      summaryBox.current = summary;
      latestBatchSummary = summary;
      return 'summary stored';
    },
    {
      name: 'summarise_batch',
      description: 'Produces an overall summary of the video comments batch (themes, questions, overview, actions).',
      schema: z.object({
        top_themes: z.array(z.string()).describe('Up to 3 recurring themes'),
        main_questions: z.array(z.string()).describe('Up to 3 most-asked questions'),
        sentiment_overview: z.string().describe('One sentence describing overall sentiment'),
        creator_actions: z.array(z.string()).describe('Up to 5 concrete things the creator should do'),
      }),
    }
  );

  return [categoriseCommentTool, flagSpamTool, suggestReplyTool, summariseBatchTool];
}

/**
 * Analyses comments from a YouTube video using a LangChain tool-calling agent.
 * @param {Array<{ youtube_comment_id: string, text: string, authorName?: string }>} comments
 * @param {string} [videoTitle]
 * @returns {Promise<{ results: Map<string, Object>, summary: Object, partial: boolean }>}
 */
async function analyseComments(comments = [], videoTitle = 'YouTube Video') {
  const timestamp = new Date().toISOString();
  const results = new Map();
  const summaryBox = { current: null };
  let partial = false;

  if (!comments || comments.length === 0) {
    return { results, summary: latestBatchSummary, partial: false };
  }

  // Pre-seed results Map with basic comment metadata
  for (const c of comments) {
    results.set(c.youtube_comment_id, {
      youtube_comment_id: c.youtube_comment_id,
      text: c.text,
      author_name: c.authorName || c.user || '',
    });
  }

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'your_gemini_api_key_here' || apiKey === 'your_google_api_key_here') {
    console.log(`[${timestamp}] [Agent] No GOOGLE_API_KEY provided. Using heuristic rule-based analyzer.`);
    for (const c of comments) {
      const h = heuristicClassify(c.youtube_comment_id, c.text);
      results.set(c.youtube_comment_id, {
        ...results.get(c.youtube_comment_id),
        ...h,
      });
    }

    const questions = comments.filter(c => c.text.includes('?')).slice(0, 3).map(c => c.text);
    const summary = {
      top_themes: ['Strong audience engagement', 'Quality visual/audio reception', 'Community appreciation'],
      main_questions: questions.length > 0 ? questions : ['Software and plugin recommendations', 'Workflow tutorial inquiry'],
      sentiment_overview: 'Overall positive reception with active viewer inquiries and content appreciation.',
      creator_actions: [
        'Reply to top question comments within 24 hours',
        'Review audio and pacing suggestions from feedback',
        'Consider turning the top tutorial query into a follow-up video',
      ],
    };
    latestBatchSummary = summary;
    return { results, summary, partial: false };
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  const model = new ChatGoogleGenerativeAI({
    model: modelName,
    temperature: 0.2,
    apiKey,
  });

  const tools = createAgentTools(results, summaryBox);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  const agent = createToolCallingAgent({ llm: model, tools, prompt });
  const executor = new AgentExecutor({
    agent,
    tools,
    verbose: false,
    maxIterations: 60,
  });

  // Process in reasonable batches (up to 20 comments per LLM agent pass to avoid token/turn limits)
  const BATCH_SIZE = 20;
  const totalBatches = Math.ceil(comments.length / BATCH_SIZE);

  for (let start = 0; start < comments.length; start += BATCH_SIZE) {
    const chunk = comments.slice(start, start + BATCH_SIZE);
    const batchIndex = Math.floor(start / BATCH_SIZE) + 1;
    const cleanVideoTitle = redactSensitiveData(videoTitle);
    const formattedInput = `Analyse these ${chunk.length} comments from video "${cleanVideoTitle}":\n\n${chunk
      .map((c, i) => `[${start + i + 1}] ID:${c.youtube_comment_id} — "${redactSensitiveData(c.text)}"`)
      .join('\n')}`;

    const runConfig = getRunConfig({
      videoTitle: cleanVideoTitle,
      batchIndex,
      totalBatches,
      batchSize: chunk.length,
      modelName,
    });

    try {
      await executor.invoke({ input: formattedInput }, runConfig);
    } catch (err) {
      console.error(`[${timestamp}] [Agent] Error in agent execution for video "${videoTitle}": ${err.message}`);
      partial = true;

      // Fill missing comments with heuristic so caller still receives complete structured data
      for (const c of chunk) {
        const existing = results.get(c.youtube_comment_id);
        if (!existing || !existing.category) {
          const fallback = heuristicClassify(c.youtube_comment_id, c.text);
          results.set(c.youtube_comment_id, {
            ...existing,
            ...fallback,
          });
        }
      }
    }
  }

  // Ensure all comments have categories assigned
  for (const c of comments) {
    const r = results.get(c.youtube_comment_id);
    if (!r || !r.category) {
      const fallback = heuristicClassify(c.youtube_comment_id, c.text);
      results.set(c.youtube_comment_id, {
        ...r,
        ...fallback,
      });
      partial = true;
    }
  }

  const finalSummary = summaryBox.current || latestBatchSummary;
  return {
    results,
    summary: finalSummary,
    partial,
  };
}

module.exports = {
  analyseComments,
  getLatestBatchSummary: () => latestBatchSummary,
};
