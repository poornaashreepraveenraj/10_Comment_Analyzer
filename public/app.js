(() => {
  'use strict';

  // DOM Elements
  const urlInput = document.getElementById('url-input') || document.getElementById('video-url-input');
  const analyseBtn = document.getElementById('analyse-btn') || document.getElementById('btn-analyse');

  const ingestTabs = document.querySelectorAll('.ingest-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');

  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const btnAnalyzeFile = document.getElementById('btn-analyze-file');

  const textInput = document.getElementById('text-input');
  const btnAnalyzeText = document.getElementById('btn-analyze-text');

  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  const errorBar = document.getElementById('error-bar');

  const resultsSection = document.getElementById('results-section');
  const activeDatasetName = document.getElementById('active-dataset-name');
  const activeChannelName = document.getElementById('active-channel-name');

  const summaryPanel = document.getElementById('summary-panel');
  const summarySentiment = document.getElementById('summary-sentiment-overview');
  const summaryThemes = document.getElementById('summary-themes');
  const summaryQuestions = document.getElementById('summary-questions');
  const summaryActions = document.getElementById('summary-actions');

  const mTotal = document.getElementById('m-total');
  const mQuestions = document.getElementById('m-questions');
  const mComplaints = document.getElementById('m-complaints');
  const mLeads = document.getElementById('m-leads');

  const categoryPills = document.querySelectorAll('.category-pills .pill');
  const priorityPills = document.querySelectorAll('.priority-pills .pill');
  const commentFeed = document.getElementById('comment-feed');
  const historyList = document.getElementById('history-list');
  const toastContainer = document.getElementById('toast-container');

  let allComments = [];
  let currentCategory = 'All';
  let currentPriority = 'All';
  let selectedFile = null;
  let activeVideoId = null;

  // Tab Switcher Logic
  ingestTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      ingestTabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add('active');
    });
  });

  // Toast Notification
  function showToast(message, isError = false) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
    toast.innerHTML = `<span>${isError ? '⚠️' : '✓'}</span><span>${esc(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.4s ease';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  // Status and Error Helpers
  function setStatus(msg) {
    if (msg) {
      if (statusText) statusText.textContent = msg;
      if (statusBar) statusBar.classList.remove('hidden');
      if (errorBar) errorBar.classList.add('hidden');
    } else {
      if (statusBar) statusBar.classList.add('hidden');
    }
  }

  function setError(err) {
    if (err) {
      if (errorBar) {
        errorBar.textContent = err;
        errorBar.classList.remove('hidden');
      }
      if (statusBar) statusBar.classList.add('hidden');
    } else {
      if (errorBar) errorBar.classList.add('hidden');
    }
  }

  function renderSkeletons() {
    if (resultsSection) resultsSection.classList.remove('hidden');
    if (commentFeed) {
      commentFeed.innerHTML = '';
      for (let i = 0; i < 4; i++) {
        commentFeed.innerHTML += '<div class="skeleton-card"></div>';
      }
    }
  }

  function esc(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Render Summary Panel
  function renderSummary(summary) {
    if (!summaryPanel) return;

    if (!summary || (!summary.sentiment_overview && (!summary.top_themes || summary.top_themes.length === 0))) {
      summaryPanel.classList.add('hidden');
      return;
    }

    summaryPanel.classList.remove('hidden');
    if (summarySentiment) {
      summarySentiment.textContent = summary.sentiment_overview || 'Audience sentiment overview available.';
    }

    if (summaryThemes) {
      summaryThemes.innerHTML = (summary.top_themes || [])
        .map(t => `<div class="summary-row-item">• ${esc(t)}</div>`)
        .join('') || '<div class="summary-row-item" style="color: var(--text-dim);">No recurring themes detected.</div>';
    }

    if (summaryQuestions) {
      summaryQuestions.innerHTML = (summary.main_questions || [])
        .map(q => `<div class="summary-row-item">❓ ${esc(q)}</div>`)
        .join('') || '<div class="summary-row-item" style="color: var(--text-dim);">No common questions detected.</div>';
    }

    if (summaryActions) {
      summaryActions.innerHTML = (summary.creator_actions || [])
        .map(a => `<div class="summary-row-item">⚡ ${esc(a)}</div>`)
        .join('') || '<div class="summary-row-item" style="color: var(--text-dim);">No creator action items suggested.</div>';
    }
  }

  // Dashboard Updates
  function updateDashboard(title, channel, metrics, comments, summary) {
    if (activeDatasetName) activeDatasetName.textContent = title;
    if (activeChannelName) {
      if (channel) {
        activeChannelName.textContent = `Channel: ${channel}`;
        activeChannelName.classList.remove('hidden');
      } else {
        activeChannelName.classList.add('hidden');
      }
    }

    if (mTotal) mTotal.textContent = metrics?.totalProcessed || comments?.length || 0;
    if (mQuestions) mQuestions.textContent = metrics?.actionableQuestions || 0;
    if (mComplaints) mComplaints.textContent = metrics?.priorityComplaints || 0;
    if (mLeads) mLeads.textContent = metrics?.contentLeads || 0;

    allComments = comments || [];
    renderSummary(summary);

    if (resultsSection) resultsSection.classList.remove('hidden');
    renderFeed();
  }

  // Feed Renderer
  function renderFeed() {
    if (!commentFeed) return;

    const filtered = allComments.filter(c => {
      // Category filter
      if (currentCategory !== 'All' && c.category && c.category.toLowerCase() !== currentCategory.toLowerCase()) {
        return false;
      }
      // Priority filter: High (2), Medium (1), Low (0)
      if (currentPriority !== 'All') {
        const p = c.priority !== undefined ? c.priority : 0;
        if (currentPriority === 'High' && p !== 2) return false;
        if (currentPriority === 'Medium' && p !== 1) return false;
        if (currentPriority === 'Low' && p !== 0) return false;
      }
      return true;
    });

    commentFeed.innerHTML = '';

    if (filtered.length === 0) {
      commentFeed.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-dim);">No comments match the selected category and priority filters.</div>';
      return;
    }

    filtered.forEach(c => {
      const isVideoLead = Boolean(c.prime_for_reel || c.prime_for_video);
      const rawUser = c.author_name || c.user || '';
      const user = rawUser ? (rawUser.startsWith('@') ? esc(rawUser) : '@' + esc(rawUser)) : '@user';
      const cat = c.category || 'Theme';
      const badgeCls = `badge-${cat.toLowerCase()}`;

      let priorityBadge = '';
      if (c.priority === 2) {
        priorityBadge = '<span class="priority-tag priority-high">HIGH PRIORITY</span>';
      } else if (c.priority === 1) {
        priorityBadge = '<span class="priority-tag priority-med">MED PRIORITY</span>';
      }

      let replyHtml = '';
      if (c.suggested_reply) {
        replyHtml = `
          <div class="comment-reply-row">
            <span class="reply-label">Reply:</span>
            <span>${esc(c.suggested_reply)}</span>
          </div>
        `;
      }

      const card = document.createElement('div');
      card.className = `comment-card ${isVideoLead ? 'is-video is-reel' : ''}`;
      card.innerHTML = `
        <div class="card-top">
          <span class="user-badge">${user}</span>
          <span class="badge ${badgeCls}">${cat.toUpperCase()}</span>
          ${priorityBadge}
          ${isVideoLead ? '<span class="video-pill reel-pill">★ Video Hook</span>' : ''}
        </div>
        <div class="comment-body">${esc(c.raw_text || c.cleaned_text || c.text)}</div>
        <div class="card-meta">
          <span>Sentiment: ${esc(c.sentiment || 'Neutral')}</span>
          ${c.tone ? `<span>•</span><span>Tone: ${esc(c.tone)}</span>` : ''}
          ${c.sub_category ? `<span>•</span><span>${esc(c.sub_category)}</span>` : ''}
        </div>
        ${replyHtml}
      `;
      commentFeed.appendChild(card);
    });
  }

  // Analyse Video Function (bound to window.analyseVideo for onclick="analyseVideo()")
  window.analyseVideo = async function () {
    const rawVal = urlInput ? urlInput.value.trim() : '';

    // Validate client-side
    if (!rawVal) {
      setError('Please paste a YouTube video URL or ID.');
      showToast('Please paste a YouTube URL', true);
      return;
    }

    const isValid = /(youtube\.com|youtu\.be|^[a-zA-Z0-9_-]{11}$)/i.test(rawVal);
    if (!isValid) {
      setError('Invalid YouTube URL. Please provide a valid watch, youtu.be, shorts link or video ID.');
      showToast('Invalid YouTube URL', true);
      return;
    }

    setError(null);
    setStatus('Running LangChain agent & categorising comments…');
    renderSkeletons();

    if (analyseBtn) {
      analyseBtn.textContent = 'Analysing…';
      analyseBtn.disabled = true;
    }

    try {
      const res = await fetch('/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawVal }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to analyse video');
      }

      activeVideoId = data.videoId;
      const count = data.totalFetched || (data.comments ? data.comments.length : 0);
      showToast(`${data.videoTitle || data.videoId} — ${count} comments analysed`);

      updateDashboard(
        data.videoTitle || data.videoId,
        data.channelName,
        data.metrics,
        data.comments,
        data.summary
      );

      loadHistory();
    } catch (err) {
      if (resultsSection) resultsSection.classList.add('hidden');
      setError(err.message);
      showToast(err.message, true);
    } finally {
      setStatus(null);
      if (analyseBtn) {
        analyseBtn.textContent = 'Analyse →';
        analyseBtn.disabled = false;
      }
    }
  };

  // Keyboard Enter key support on urlInput
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.analyseVideo();
      }
    });
  }

  // Filter Event Handlers
  categoryPills.forEach(pill => {
    pill.addEventListener('click', () => {
      categoryPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCategory = pill.dataset.filter || 'All';
      renderFeed();
    });
  });

  priorityPills.forEach(pill => {
    pill.addEventListener('click', () => {
      priorityPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentPriority = pill.dataset.priority || 'All';
      renderFeed();
    });
  });

  // File Upload Ingestion
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        selectedFile = fileInput.files[0];
        const titleEl = dropZone.querySelector('.drop-title');
        if (titleEl) titleEl.textContent = `Selected: ${selectedFile.name}`;
        if (btnAnalyzeFile) btnAnalyzeFile.disabled = false;
      }
    });
  }

  if (btnAnalyzeFile) {
    btnAnalyzeFile.addEventListener('click', async () => {
      if (!selectedFile) return;
      try {
        const text = await selectedFile.text();
        runImportAnalysis({ csvText: text, sourceName: selectedFile.name }, selectedFile.name);
      } catch (e) {
        setError('Could not read CSV file.');
      }
    });
  }

  if (btnAnalyzeText) {
    btnAnalyzeText.addEventListener('click', () => {
      const text = textInput ? textInput.value.trim() : '';
      if (!text) return setError('Please paste raw comments text.');
      runImportAnalysis({ pastedText: text, sourceName: 'Pasted Text Block' }, 'Pasted Text Block');
    });
  }

  async function runImportAnalysis(payload, label) {
    setError(null);
    setStatus('Running LangChain agent on imported comments…');
    renderSkeletons();

    try {
      const res = await fetch('/api/analyze-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Import analysis failed');
      }

      showToast(`${label} — ${data.totalFetched || data.comments?.length || 0} comments analysed`);
      updateDashboard(label, data.channelName, data.metrics, data.comments, data.summary);
      loadHistory();
    } catch (err) {
      if (resultsSection) resultsSection.classList.add('hidden');
      setError(err.message);
      showToast(err.message, true);
    } finally {
      setStatus(null);
    }
  }

  // Sidebar History: Truncate video_title to 28 chars with ellipsis
  async function loadHistory() {
    if (!historyList) return;

    try {
      const res = await fetch('/api/posts');
      const posts = await res.json();
      if (!posts || !Array.isArray(posts) || posts.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No past analyses</div>';
        return;
      }

      historyList.innerHTML = '';
      posts.forEach(p => {
        const vid = p.video_id || p.shortcode;
        const fullTitle = p.video_title || vid;
        // Truncate to 28 characters with an ellipsis as requested
        const displayTitle = fullTitle.length > 28 ? fullTitle.slice(0, 28) + '...' : fullTitle;

        const item = document.createElement('div');
        item.className = 'history-item';
        item.title = fullTitle;
        item.textContent = displayTitle;

        item.addEventListener('click', async () => {
          renderSkeletons();
          activeVideoId = vid;
          try {
            const [m, cData, summaryData] = await Promise.all([
              fetch(`/api/posts/${encodeURIComponent(vid)}/metrics`).then(r => r.json()),
              fetch(`/api/comments?videoId=${encodeURIComponent(vid)}&limit=200`).then(r => r.json()),
              fetch(`/api/summary/${encodeURIComponent(vid)}`).then(r => r.ok ? r.json() : null).catch(() => null),
            ]);

            const comments = Array.isArray(cData) ? cData : (cData.comments || []);
            updateDashboard(fullTitle, p.channel_name, m, comments, summaryData);
          } catch (err) {
            setError(`Could not load video data: ${err.message}`);
          }
        });

        historyList.appendChild(item);
      });
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  loadHistory();
})();
