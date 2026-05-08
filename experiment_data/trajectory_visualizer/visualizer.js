// RUN THIS: http://127.0.0.1:5001/static/trajectory_visualizer/index.html
//  Make sure that the csv file is not being edited in VScode

(function () {
  const API_BASE = '/api';
  const userSelect = document.getElementById('user-select');
  const feedbackSelect = document.getElementById('feedback-select');
  const trialSelect = document.getElementById('trial-select');
  const playBtn = document.getElementById('play-btn');
  const resetBtn = document.getElementById('reset-btn');
  const summaryEl = document.getElementById('summary');
  const gridContainer = document.getElementById('grid-container');

  let allRows = [];
  let envCache = {};
  let current = { row: null, env: null };

  async function fetchParticipantData() {
    try {
      const res = await fetch(API_BASE + '/get-participant-data');
      if (!res.ok) throw new Error('failed to load participant data');
      const data = await res.json();
      allRows = data || [];
      populateUsers();
    } catch (e) {
      userSelect.innerHTML = '<option value="">Error loading</option>';
      console.error(e);
    }
  }

  function populateUsers() {
    const users = [...new Set(allRows.map(r => r.user_id_field).filter(Boolean))];
    userSelect.innerHTML = '<option value="">-- select user --</option>' + users.map(u => `<option value="${u}">${u}</option>`).join('');
  }

  userSelect.addEventListener('change', () => {
    feedbackSelect.innerHTML = '<option value="">--</option>';
    trialSelect.innerHTML = '<option value="">--</option>';
    feedbackSelect.disabled = true;
    trialSelect.disabled = true;
    playBtn.disabled = true; resetBtn.disabled = true;
    summaryEl.innerHTML = 'Select a feedback type and trial.';

    const user = userSelect.value;
    if (!user) return;
    const rows = allRows.filter(r => r.user_id_field === user);
    const feedbacks = [...new Set(rows.map(r => r.feedback_type || 'unknown'))];
    feedbackSelect.innerHTML = '<option value="">-- select feedback type --</option>' + feedbacks.map(f => `<option value="${f}">${f}</option>`).join('');
    feedbackSelect.disabled = false;
  });

  feedbackSelect.addEventListener('change', () => {
    trialSelect.innerHTML = '<option value="">--</option>';
    trialSelect.disabled = true; playBtn.disabled = true; resetBtn.disabled = true;
    const user = userSelect.value; const feedback = feedbackSelect.value;
    if (!user || !feedback) return;
    const rows = allRows.filter(r => r.user_id_field === user && (r.feedback_type || 'unknown') === feedback);
    rows.forEach((r, i) => {
      const tn = r.trial_number || r.trial || i + 1;
      const opt = document.createElement('option');
      opt.value = i; opt.dataset.rowIndex = allRows.indexOf(r);
      opt.textContent = `Trial ${tn} — env:${r.env_id || 'N/A'}`;
      trialSelect.appendChild(opt);
    });
    trialSelect.disabled = false;
  });

  trialSelect.addEventListener('change', async () => {
    const idx = trialSelect.selectedIndex;
    if (idx <= 0) { playBtn.disabled = true; resetBtn.disabled = true; return; }
    const opt = trialSelect.options[trialSelect.selectedIndex];
    const globalIndex = parseInt(opt.dataset.rowIndex, 10);
    const row = allRows[globalIndex];
    current.row = row;
    if (!row) { summaryEl.innerHTML = 'Row not found'; return; }

    // --- CHANGE 1: Check for both manipulation check types ---
    // If feedback type is text-based, show summary instead of visualizing.
    // This now includes 'manipulation_check_pre'.
    const textBasedTypes = ['manipulation_check', 'manipulation_check_pre', 'free_form_description'];
    if (textBasedTypes.includes(row.feedback_type)) {
      renderTextSummary(row);
      return; // Stop here and don't try to load an environment
    }

    if (!row.env_id) { summaryEl.innerHTML = 'No env_id in this trial.'; return; }
    if (envCache[row.env_id]) {
      current.env = envCache[row.env_id];
      renderSummaryAndGrid();
    } else {
      try {
        const r = await fetch(API_BASE + '/environment/' + row.env_id);
        if (!r.ok) throw new Error('env load failed');
        const env = await r.json(); envCache[row.env_id] = env; current.env = env;
        renderSummaryAndGrid();
      } catch (e) { summaryEl.innerHTML = 'Failed to load environment'; console.error(e); }
    }
  });

  function renderTextSummary(row) {
    // 1. Clear visualization area and disable playback buttons
    gridContainer.innerHTML = 'No visualization for this data type.';
    playBtn.disabled = true;
    resetBtn.disabled = true;
    summaryEl.innerHTML = ''; // Clear previous summary

    // 2. Helper to parse data. If not valid JSON, returns the original string.
    const parseData = (str) => {
      try { return JSON.parse(str); } catch (e) { return str; }
    };

    // 3. Display basic info (User, Feedback type)
    const info = document.createElement('div');
    info.innerHTML = `
    <div class="info-row"><strong>User:</strong> ${row.user_id_field}</div>
    <div class="info-row small"><strong>Group:</strong> ${row.instruction_group || 'N/A'}</div>
    <div class="info-row small"><strong>Feedback:</strong> ${row.feedback_type}</div>
    <hr style="margin: 10px 0;">`;
    summaryEl.appendChild(info);

    // Use the correct column names from your database/CSV file.
    const MANIPULATION_CHECK_RESPONSES_COLUMN = 'manipulation_check_responses';
    const MANIPULATION_CHECK_ERRORS_COLUMN = 'manipulation_check_errors';
    const FREE_FORM_DESCRIPTION_COLUMN = 'free_form_description';

    const contentDiv = document.createElement('div');

    // --- CHANGE 2: Handle both Manipulation Check types with a dynamic title ---
    if (row.feedback_type === 'manipulation_check' || row.feedback_type === 'manipulation_check_pre') {
      const responses = parseData(row[MANIPULATION_CHECK_RESPONSES_COLUMN]);
      const errorsData = parseData(row[MANIPULATION_CHECK_ERRORS_COLUMN]);

      const title = document.createElement('h4');
      // Dynamically set the title based on the feedback type
      const checkType = row.feedback_type === 'manipulation_check_pre' ? 'Pre-Task' : 'Post-Instructions';
      title.textContent = `Manipulation Check (${checkType})`;
      contentDiv.appendChild(title);

      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.marginTop = '10px';

      // Create table header with the new "Errors" column
      table.innerHTML = `
      <thead style="text-align: left;">
        <tr>
          <th>Question</th>
          <th>Response</th>
          <th>Errors</th>
        </tr>
      </thead>`;

      const tbody = document.createElement('tbody');
      // Populate table with responses and individual error counts
      if (responses && typeof responses === 'object') {
        for (const [key, value] of Object.entries(responses)) {
          const tr = document.createElement('tr');
          const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          // Get the specific error count for this question, defaulting to 0 if not found
          const errorCount = errorsData ? (errorsData[key] || 0) : 0;
          
          tr.innerHTML = `<td style="padding: 4px 0;">${formattedKey}</td><td style="padding: 4px 0;"><strong>${value}</strong></td><td style="padding: 4px 0;">${errorCount}</td>`;
          tbody.appendChild(tr);
        }
      }
      table.appendChild(tbody);
      contentDiv.appendChild(table);

    // --- Handle Free Form Description ---
    } else if (row.feedback_type === 'free_form_description') {
      const dataToShow = parseData(row[FREE_FORM_DESCRIPTION_COLUMN]);
      
      const title = document.createElement('h4');
      title.textContent = 'Free Form Question Summary';
      contentDiv.appendChild(title);

      if (dataToShow && typeof dataToShow === 'object' && !Array.isArray(dataToShow)) {
        for (const [key, value] of Object.entries(dataToShow)) {
          const item = document.createElement('div');
          item.className = 'info-row small';
          const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          item.innerHTML = `<strong style="margin-top: 8px; display: inline-block;">${formattedKey}:</strong><p style="margin: 4px 0 0 10px; white-space: pre-wrap;">${value}</p>`;
          contentDiv.appendChild(item);
        }
      } else if (dataToShow) {
        const p = document.createElement('p');
        p.textContent = dataToShow;
        contentDiv.appendChild(p);
      }
    } else {
      contentDiv.innerHTML = '<p>No data found in the expected column for this entry.</p>';
    }

    summaryEl.appendChild(contentDiv);
  }

  function renderSummaryAndGrid() {
    const row = current.row; const env = current.env;
    summaryEl.innerHTML = '';
    const info = document.createElement('div');
    info.innerHTML = `
      <div class="info-row"><strong>User:</strong> ${row.user_id_field}</div>
      <div class="info-row small"><strong>Group:</strong> ${row.instruction_group || 'N/A'}</div>
      <div class="info-row small"><strong>Feedback:</strong> ${row.feedback_type || 'N/A'}</div>
      <div class="info-row small"><strong>Policy served:</strong> ${row.policy_type_served || 'N/A'}</div>`;
    summaryEl.appendChild(info);

    const { a, b, obstacles } = extractData(row);
    drawGridLocal(gridContainer, env, 'viz', 40);

    // NEW: If obstacles exist for this trial, draw them on the grid
    if (obstacles && obstacles.length > 0) {
      obstacles.forEach(obs => {
        const [r, c] = obs;
        const cell = document.getElementById(`viz-${r}-${c}`);
        if (cell) {
          cell.classList.add('obstacle-cell');
        }
      });
    }

    // compute DTW vs policy trajectory (match)
    (async () => {
      try {
        const userGroup = row.instruction_group;
        let targetGroupForApi;

        /* IMPORTANT: We use the /generate-instructional-trajectory which designed to only use a1 and a2 (BELIEF) match and mismatch trajectories.
         * We fake the group to always be a MATCHED group to get the correct trajectory from the API.
         */

        // Determine which policy to request based on the user's 'b' group.
        if (userGroup && userGroup.includes('b2')) {
          // If the user's ground truth was slippery (b2), we need the b2 policy.
          // The API provides the b2 (slippery) policy when the 'a' group is 'a2'.
          targetGroupForApi = 'group_a2b2';
        } else if (userGroup && userGroup.includes('b1')) {
          // Otherwise, the user's ground truth was stable (b1).
          // The API provides the b1 (stable) policy when the 'a' group is 'a1'.
          targetGroupForApi = 'group_a1b1';
        } else {
          // Throw an error
          throw new Error(`Unsupported user group: ${userGroup}`);
        }

        const genRes = await fetch(API_BASE + '/generate-instructional-trajectory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // Use our synthetic targetGroupForApi instead of the user's actual group
          body: JSON.stringify({ env_id: row.env_id, instruction_group: targetGroupForApi, policy_type_request: 'match', path_style: 'demonstration' })
        });

        if (genRes.ok) {
          const genJson = await genRes.json();
          const policyTrajectory = genJson.trajectory || null;
          const dtwValue = (a && policyTrajectory) ? dtw(a, policyTrajectory).toFixed(2) : 'N/A';
          const dtwRow = document.createElement('div');
          dtwRow.className = 'info-row small';
          
          // Clarify in the UI which policy is being compared
          const policyType = targetGroupForApi.includes('a2') ? 'b2 (Slippery)' : 'b1 (Stable)';
          dtwRow.innerHTML = `<strong>DTW vs policy (${policyType}):</strong> ${dtwValue}`;
          
          summaryEl.appendChild(dtwRow);
        }
      } catch (e) {
        console.error('policy traj fetch error', e);
      }
    })();

    playBtn.disabled = false; resetBtn.disabled = false;
  }

  function extractData(row) {
    const f = (s) => { try { return s ? JSON.parse(s) : null } catch (e) { return null } };
    const feedback = row.feedback_type;
    let a = null, b = null, obstacles = null;
    if (feedback === 'comparison') {
      a = f(row.chosen_trajectory); b = f(row.unchosen_trajectory);
    } else if (feedback === 'correction') {
      a = f(row.corrected_trajectory); b = f(row.uncorrected_trajectory);
    } else if (feedback === 'demonstration' || feedback === 'demonstration_pre') {
      a = f(row.user_demonstrated_trajectory) || f(row.user_trajectory) || null; b = null;
    } else if (feedback === 'off_intervention') {
      try { 
        const obj = f(row.off_interrupted_trajectory); 
        if (obj) {
            a = obj.trajectory || null;
            obstacles = obj.obstacles || null; // Extract obstacles
        }
      } catch (e) { 
          a = null; 
          obstacles = null;
      }
      b = f(row.off_initial_trajectory);
    } else {
      a = f(row.user_demonstrated_trajectory) || f(row.chosen_trajectory) || null;
      b = f(row.unchosen_trajectory) || f(row.uncorrected_trajectory) || null;
    }
    return { a, b, obstacles };
  }

  function drawGridLocal(container, env, idPrefix = 'viz', cellSize = 40) {
    container.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'grid';
    grid.style.gridTemplateColumns = `repeat(${env.grid_cols}, ${cellSize}px)`;
    grid.style.gridTemplateRows = `repeat(${env.grid_rows}, ${cellSize}px)`;
    grid.style.position = 'relative';

    for (let r = 0; r < env.grid_rows; r++) {
      for (let c = 0; c < env.grid_cols; c++) {
        const cell = document.createElement('div'); cell.className = 'grid-cell'; cell.id = `${idPrefix}-${r}-${c}`;
        cell.style.width = cell.style.height = cellSize + 'px';
        if (env.start_state && r === env.start_state[0] && c === env.start_state[1]) cell.classList.add('start-cell');
        if (env.goal_state && r === env.goal_state[0] && c === env.goal_state[1]) cell.classList.add('goal-cell');
        if (env.cliff_states && env.cliff_states.some(p => p[0] === r && p[1] === c)) cell.classList.add('cliff-cell');
        grid.appendChild(cell);
      }
    }
    container.appendChild(grid);
  }

  async function animate() {
    // clear previous
    document.querySelectorAll('.agent').forEach(n => n.remove());
    document.querySelectorAll('.path-a, .path-b').forEach(n => n.classList.remove('path-a', 'path-b'));

    const { a, b } = extractData(current.row);
    if (!a && !b) { alert('No trajectories to animate'); return; }

    const env = current.env;
    const maxLen = Math.max(a ? a.length : 0, b ? b.length : 0);

    const agentA = createAgent('agent-a', 'A');
    const agentB = b ? createAgent('agent-b', 'B') : null;
    for (let i = 0; i < maxLen; i++) {
      if (a && i < a.length) moveAgent(agentA, a[i], 'viz');
      if (b && i < b.length) moveAgent(agentB, b[i], 'viz');
      await sleep(180);
    }
  }

  function createAgent(id, label) {
    const el = document.createElement('div'); el.className = 'agent'; el.id = id; el.textContent = label; el.style.position = 'absolute'; el.style.width = '28px'; el.style.height = '28px'; el.style.borderRadius = '50%'; el.style.display = 'flex'; el.style.alignItems = 'center'; el.style.justifyContent = 'center'; if (id === 'agent-a') { el.style.background = '#007bff'; el.style.color = 'white' } else { el.style.background = '#ffc107'; el.style.color = '#222' }
    document.querySelector('#grid-container .grid').appendChild(el);
    return el;
  }

  function moveAgent(agent, pos, idPrefix = 'viz') {
    if (!agent || !pos) return;
    const cell = document.getElementById(`${idPrefix}-${pos[0]}-${pos[1]}`);
    if (!cell) return;
    const gridRect = document.querySelector('#grid-container .grid').getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    agent.style.top = (cellRect.top - gridRect.top + 6) + 'px';
    agent.style.left = (cellRect.left - gridRect.left + 6) + 'px';
    if (!cell.classList.contains('start-cell') && !cell.classList.contains('goal-cell')) cell.classList.add(agent.id === 'agent-a' ? 'path-a' : 'path-b');
  }

  function dtw(A, B) { if (!A || !B) return Infinity; const n = A.length; const m = B.length; const D = Array(n + 1).fill(0).map(() => Array(m + 1).fill(1e9)); D[0][0] = 0; const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]); for (let i = 1; i <= n; i++) { for (let j = 1; j <= m; j++) { const cost = dist(A[i - 1], B[j - 1]); D[i][j] = cost + Math.min(D[i - 1][j], D[i][j - 1], D[i - 1][j - 1]); } } return D[n][m]; }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  playBtn.addEventListener('click', () => { animate(); });
  resetBtn.addEventListener('click', () => { 
    // This now correctly re-renders the grid and obstacles when reset is clicked
    renderSummaryAndGrid(); 
  });

  fetchParticipantData();
})();