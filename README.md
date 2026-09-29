# YouTube Comment Analyzer

AI-powered comment categorization & lead extraction platform for YouTube creators. Categorizes YouTube video comments into **Themes**, **Questions**, **Complaints**, and **Opportunities**, filters promotional spam, translates emojis into semantic descriptors, and flags high-leverage content ideas ("Reply with Video").

## Features

- **YouTube Video Ingestion**: Ingest comments from any YouTube video URL (`youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/shorts/...`, `youtube.com/embed/...`) or direct 11-character video ID.
- **YouTube Data API v3**: Fetches up to 100 top relevance comment threads using the `commentThreads.list` endpoint.
- **Audience Intelligence & Categorization**:
  - **Themes**: Opinions, praise, hype, community discussions.
  - **Questions**: Queries, how-tos, tutorial requests, software inquiries.
  - **Complaints**: Bug reports, audio dissatisfaction, issues.
  - **Opportunities**: Business inquiries, brand deals, collaborations, sponsorship leads.
- **Spam Filtering & Emoji Translation**: Rule-based heuristics to block crypto/promotional spam and convert unicode emojis into contextual text descriptions.
- **Studio Dashboard**: Sleek Channel Studio design system with metric cards, filter pills, and history sidebar showing video titles.
- **Flexible Imports**: Also supports CSV dataset upload and raw comment pasting.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Configure the following in `.env`:
   - `PORT`: Server port (default `3000`)
   - `YOUTUBE_API_KEY`: Google Cloud / YouTube Data API v3 key
   - `GOOGLE_API_KEY` (or `GEMINI_API_KEY`): Google Gemini API key for NLP comment classification
   - `LANGSMITH_TRACING`: Set to `true` to enable LangSmith tracing and observability
   - `LANGSMITH_API_KEY`: LangSmith API key (`lsv2_pt_...`) from [smith.langchain.com](https://smith.langchain.com)
   - `LANGSMITH_PROJECT`: LangSmith project name (default: `comment-analysis`)
   - `LANGSMITH_ENDPOINT`: LangSmith endpoint (default: `https://api.smith.langchain.com`)

   *(Note: If `YOUTUBE_API_KEY` or `GOOGLE_API_KEY` are not set, the platform uses smart mock heuristics. If `LANGSMITH_TRACING` is disabled or API key is omitted, the app operates normally in modular fallback mode.)*

3. **Run Tests**:
   ```bash
   npm test
   ```

4. **Verify LangSmith Tracing**:
   ```bash
   npm run test:langsmith
   ```

5. **Start the Application**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

## API Endpoints

- `POST /analyse` — Ingests a YouTube video URL or ID:
  - Body: `{ "url": "https://www.youtube.com/watch?v=..." }`
  - Returns: `{ "videoId": "...", "videoTitle": "...", "channelName": "...", "commentCount": 8, "metrics": {...}, "comments": [...] }`
- `GET /api/posts` — Lists all analyzed videos (`video_id`, `video_title`, `channel_name`, `total_comments`, `created_at`).
- `GET /api/comments` — Returns all comments or comments for a specific video (`?video_id=...`).
- `GET /api/posts/:videoId/metrics` — Returns categorization metrics for a specific video.
- `POST /api/analyze-import` — Ingests comments via CSV text or pasted raw lines.
