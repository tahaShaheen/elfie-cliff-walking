// static/js/corrections.js

// --- DOM Elements ---
const taskLoader = document.getElementById('task-loader');
const loaderText = document.getElementById('loader-text');
const actualTaskContent = document.getElementById('actual-game-content');
const taskTitleElement = document.getElementById('page-title');
const gridContainer = document.getElementById('grid-container');
const playPlanButton = document.getElementById('playPlanButton');
const proceedButton = document.getElementById('proceedButton');
const resetButton = document.getElementById('resetButton');
let lastPrunedCells = [];

// --- State ---
let allCorrectionScenarios = [], practiceScenario = null, isPracticeMode = false;
let currentCorrectionIndex = 0, maxCorrections = 0, collectedCorrections = [];
let originalTrajectory = [], correctedTrajectory = [];
let correctedStepIndices = [];
let numCorrectionAttempts = 3, attemptsLeft = 3;
let agentElement = null;
let GRID_ROWS = 0, GRID_COLS = 0, START_STATE = [], GOAL_STATE = [], CLIFF_STATES = [];
let currentEnvId = '', currentPolicyType = '';
let isAnimating = false, animationFrameId = null, animationSpeed = 450;
// let stepToCorrect = -1;
let isPlanPlayed = false;
let overallTaskCurrentNum = 0, overallTaskTotalNum = 0, taskSpecificTitle = "";

let currentProgressInfo = null;
let temporaryXStates = [];
let temporaryYStates = [];
let temporaryOStates = [];
let trajectoryBeforeDrag = []; // To store the state before a drag begins

let isDragging = false;
let dragStartInfo = { index: -1, coords: [] };
let atLeastOneDrag = false; // Flag to track if any drag has occurred

let keyboardMode = 'navigate'; // Can be 'navigate' or 'drag'
let keyboardCursorPos = [0, 0]; // Default position
let keyboardDragInfo = { index: -1, originalCoords: [] };

// --- Functions ---
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility();
    document.title = getUIString('title', 'corrections_page');
    taskTitleElement.textContent = getUIString('title', 'corrections_page');
    loaderText.textContent = getUIString('loading_task', 'common');
    proceedButton.textContent = getUIString('button_start_task', 'common');
    proceedButton.classList.add('btn-success');
    resetButton.disabled = true;
    resetButton.textContent = getUIString('button_reset_trial', 'corrections_page');
    gridContainer.addEventListener('mousedown', handleGridMouseDown);
    document.addEventListener('mousemove', handleGridMouseMove);
    document.addEventListener('mouseup', handleGridMouseUp);
    document.addEventListener('mouseleave', handleMouseLeave);
    await initializeCorrectionsTask();
}

async function initializeCorrectionsTask() {
    showAppMessage('message-box', getUIString('loading_task', 'common'), 'info');
    try {
        const statusResponse = await fetch(`${FLASK_SERVER_URL}/api/check-form-status`, { credentials: 'include' });
        const statusData = await statusResponse.json();

        if (statusData.instruction_group) USER_GROUP = statusData.instruction_group;
        if (!statusResponse.ok || !statusData.form_completed) { window.location.href = 'index.html'; return; }

        const response = await fetch(`${FLASK_SERVER_URL}/api/corrections-setup`, { credentials: 'include' });
        const setupData = await response.json();

        currentProgressInfo = setupData.progress_info; // Store it
        updateProgressBar(currentProgressInfo, isPracticeMode ? null : 1, maxCorrections);

        overallTaskCurrentNum = setupData.overall_task_current_num;
        overallTaskTotalNum = setupData.overall_task_total_num;
        taskSpecificTitle = setupData.task_title;
        if (!response.ok) throw new Error(setupData.error || 'Failed to load scenarios');

        practiceScenario = setupData.practice_scenario;
        allCorrectionScenarios = setupData.correction_scenarios || [];
        maxCorrections = setupData.max_corrections || 0;
        numCorrectionAttempts = setupData.num_correction_attempts || 3;
        animationSpeed = setupData.animation_speed || 450;

        await fetchAndRenderStructuredInstructions(`/api/instructions?task=corrections`, 'task-instructions-container', 'message-box', 'corrections', true);

        if (numCorrectionAttempts === -1) {
            const allListItems = document.querySelectorAll('#task-instructions-container li');
            allListItems.forEach(item => {
                if (item.textContent.includes('limited number of corrections')) {
                    item.innerHTML = getUIString('unlimited_corrections_instruction', 'corrections_page');
                }
            });
        }

        taskLoader.classList.add('hidden');
        actualTaskContent.classList.remove('hidden');

        if (practiceScenario) {
            isPracticeMode = true;
            await loadScenario(practiceScenario, true);
        } else {
            isPracticeMode = false;
            await startRealCorrectionsTask();
        }
    } catch (error) {
        loaderText.textContent = `Error: ${error.message}`;
        showAppMessage('message-box', `Initialization Error: ${error.message}`, 'error');
    }
}

async function startRealCorrectionsTask() {
    isPracticeMode = false;
    currentCorrectionIndex = 0;
    collectedCorrections = [];
    await loadScenario(allCorrectionScenarios[currentCorrectionIndex]);
}

async function loadScenario(scenario, isPractice = false) {
    currentEnvId = scenario.env_id;
    currentPolicyType = scenario.policy_type_served;
    originalTrajectory = [];
    correctedTrajectory = [];

    correctedStepIndices = [];
    attemptsLeft = numCorrectionAttempts;
    isAnimating = false;
    stepToCorrect = -1;
    isPlanPlayed = false;
    temporaryXStates = [];
    temporaryYStates = [];
    temporaryOStates = [];
    if (animationFrameId) clearTimeout(animationFrameId);
    atLeastOneDrag = false;

    updateProgressBar(currentProgressInfo, isPractice ? null : currentCorrectionIndex + 1, maxCorrections);

    const taskTitleParts = taskSpecificTitle.split(':');
    taskSpecificTitle = (taskTitleParts.length > 1) ? taskTitleParts.slice(1).join(':').trim() : taskTitleParts[0].trim();

    const miniGameText = getUIString('task_title_template', 'common').replace('{current}', overallTaskCurrentNum).replace('{total}', overallTaskTotalNum);
    let roundText = '';
    if (isPracticeMode) {
        roundText = ` (${getUIString('progress_practice_notice', 'common')})`;
    } else if (maxCorrections > 0) {
        const roundInfo = getUIString('progress_round_template', 'common')
            .replace('{current}', currentCorrectionIndex + 1)
            .replace('{total}', maxCorrections);
        roundText = ` (${roundInfo})`;
    }
    taskTitleElement.textContent = miniGameText + roundText;


    if (isPracticeMode) {
        displayPracticeBanner('practice-banner-container');
    } else {
        const banner = document.getElementById('practice-banner');
        if (banner) banner.remove();
    }

    const envResponse = await fetch(`${FLASK_SERVER_URL}/api/environment/${scenario.env_id}`, { credentials: 'include' });
    const envData = await envResponse.json();

    const trajectory = generateAndSelectBestPerturbation(scenario.policy_to_use, scenario.rival_policy, envData, scenario.epsilon);
    originalTrajectory = JSON.parse(JSON.stringify(trajectory));
    correctedTrajectory = JSON.parse(JSON.stringify(trajectory));

    GRID_ROWS = envData.grid_rows; GRID_COLS = envData.grid_cols;
    START_STATE = envData.start_state; GOAL_STATE = envData.goal_state;
    CLIFF_STATES = envData.cliff_states || [];

    drawGrid(gridContainer, envData, { cellSize: 50 });

    gridContainer.querySelectorAll('.agent-sprite').forEach(sprite => sprite.remove());
    agentElement = animateAgentMove(null, null, START_STATE);

    playPlanButton.textContent = getUIString('button_watch_plan', 'corrections_page');
    playPlanButton.classList.remove('btn-secondary');
    playPlanButton.classList.add('btn-primary');
    playPlanButton.disabled = false;
    playPlanButton.classList.remove('hidden');
    resetButton.disabled = true;
    // correctionInterface.classList.add('hidden');
    // resetCorrectionsButton.classList.add('hidden');

    proceedButton.classList.remove('hidden');
    proceedButton.disabled = true;

    if (isPracticeMode) {
        proceedButton.textContent = getUIString('button_end_practice', 'common');
    } else {
        const isLast = (currentCorrectionIndex + 1) >= maxCorrections;
        proceedButton.textContent = isLast
            ? getUIString('button_finish_and_submit', 'common')
            : getUIString('button_next_map', 'common');
    }

    showAppMessage('message-box', getUIString('message_initial_prompt', 'corrections_page'), 'info');
    // updateGridAfterCorrection();
}

async function resetAllCorrections() {
    proceedButton.disabled = true;
    proceedButton.textContent = getUIString('button_click_on_cookie', 'corrections_page');
    cleanupCorrectionTargets();
    if (isAnimating) return;
    // correctionInterface.classList.add('hidden');
    showAppMessage('message-box', getUIString('message_reverting_plan', 'corrections_page'), 'info');

    attemptsLeft = numCorrectionAttempts;
    correctedStepIndices = [];
    correctedTrajectory = JSON.parse(JSON.stringify(originalTrajectory));

    await animateFullTrajectory();
}

function handleGoalClick() {
    if (isAnimating) return;
    proceedButton.disabled = false;
    if (isPracticeMode) {
        proceedButton.textContent = getUIString('button_end_practice', 'common');
    } else {
        const isLast = (currentCorrectionIndex + 1) >= maxCorrections;
        proceedButton.textContent = isLast
            ? getUIString('button_finish_and_submit', 'common')
            : getUIString('button_next_map', 'common');
    }

    if (isPracticeMode) {
        showAppMessage('message-box', getUIString('message_goal_clicked_practice', 'corrections_page'), 'success');
    }
    else {
        showAppMessage('message-box', getUIString('message_goal_clicked_real', 'corrections_page'), 'success');
    }
}

function handleStartClick() {
    resetAllCorrections();
}

async function animateFullTrajectory() {
    playPlanButton.disabled = true;
    resetButton.disabled = true;
    playPlanButton.textContent = getUIString('button_watching_plan', 'corrections_page');
    // resetCorrectionsButton.disabled = true;
    isAnimating = true;
    showAppMessage('message-box', getUIString('message_watching_plan', 'corrections_page'), 'muted');

    gridContainer.querySelectorAll('.agent-sprite').forEach(sprite => sprite.remove());
    agentElement = null;

    gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove(
            'path-cell',
            'corrected-step-cell',
            'correction-hotspot',
            'trajectory-path-cell',
            'selection-highlight',
            'current-pos-highlight' // This class is for the agent's current position during animation
        );
    });

    agentElement = animateAgentMove(agentElement, null, correctedTrajectory[0]);

    for (let i = 1; i < correctedTrajectory.length; i++) {
        if (!isAnimating) break;
        const oldPos = correctedTrajectory[i - 1], newPos = correctedTrajectory[i];
        const pathCell = document.getElementById(`cell-${oldPos[0]}-${oldPos[1]}`);
        if (pathCell && !pathCell.classList.contains('start-cell')) pathCell.classList.add('path-cell');
        agentElement = animateAgentMove(agentElement, oldPos, newPos, { goalState: GOAL_STATE });
        await new Promise(r => animationFrameId = setTimeout(r, animationSpeed));
    }

    // After the animation is complete, find the goal cell and specifically
    // remove the lingering animation highlight from it.
    const goalCellForCleanup = gridContainer.querySelector('.goal-cell');
    if (goalCellForCleanup) {
        goalCellForCleanup.classList.remove('current-pos-highlight');
    }
    
    // This now calls our centralized styling function.
    applyPrunedPathStyle();

    // Re-apply the style for permanently corrected steps
    correctedStepIndices.forEach(index => {
        const pos = correctedTrajectory[index];
        if (pos) {
            const cell = document.getElementById(`cell-${pos[0]}-${pos[1]}`);
            if (cell) cell.classList.add('corrected-step-cell');
        }
    });

    console.log('[Log] Mapping all trajectory indices to their grid cells.');
    // First, create a map where each cell ID maps to an array of indices where it appears.
    const cellIndicesMap = new Map();
    for (let i = 0; i < correctedTrajectory.length; i++) {
        const pos = correctedTrajectory[i];
        // Skip start and goal cells as they can't be hotspots.
        if (pos[0] === START_STATE[0] && pos[1] === START_STATE[1]) continue;
        if (pos[0] === GOAL_STATE[0] && pos[1] === GOAL_STATE[1]) continue;

        const cellId = `cell-${pos[0]}-${pos[1]}`;
        // If the map doesn't have an entry for this cell yet, create one.
        if (!cellIndicesMap.has(cellId)) {
            cellIndicesMap.set(cellId, []);
        }
        // Add the current step index to this cell's list.
        cellIndicesMap.get(cellId).push(i);
    }

    console.log('[Log] Applying hotspots and aggregated step indices to the grid.');
    // Now, iterate over the map to update the DOM.
    for (const [cellId, indices] of cellIndicesMap.entries()) {
        const cell = document.getElementById(cellId);
        if (cell) {
            cell.classList.add('correction-hotspot');
            // Store all indices as a comma-separated string.
            cell.dataset.stepIndices = indices.join(',');
        }
    }

    if (isAnimating) {
        playPlanButton.textContent = getUIString('button_watch_plan', 'corrections_page');
        playPlanButton.disabled = false;
        isAnimating = false;
        isPlanPlayed = true;

        updateGridAfterCorrection();

        // And display the end message
        let endMessage;
        if (numCorrectionAttempts === -1) {
            endMessage = getUIString('message_drag_instructions_unlimited', 'corrections_page');
        } else if (attemptsLeft > 0) {
            const template = getUIString('message_plan_finished_can_correct', 'corrections_page');
            // Check if the template is valid before trying to use it.
            if (template.includes('{attemptsLeft}')) {
                endMessage = getUIString('message_plan_finished_can_correct', 'corrections_page').replace('{attemptsLeft}', attemptsLeft);
            } else {
                // Provide a safe fallback message if the YAML string is broken.
                endMessage = getUIString('message_plan_finished_can_correct', 'corrections_page').replace('{attemptsLeft}', attemptsLeft);
            }
        } else {
            endMessage = getUIString('message_plan_finished_no_attempts', 'corrections_page');
        }
        showAppMessage('message-box', endMessage, 'info');
    }
}


async function handleCorrectionAndRecalculate(newPosition) {
    const pathToCorrection = correctedTrajectory.slice(0, stepToCorrect + 1);
    const response = await fetch(`${FLASK_SERVER_URL}/api/recalculate-trajectory`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ env_id: currentEnvId, new_start_state: newPosition, policy_type: currentPolicyType })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to fetch recalculated path.');
    return pathToCorrection.concat([newPosition], data.new_trajectory_segment);
}

// --- Event Listeners ---
playPlanButton.addEventListener('click', async () => {
    proceedButton.disabled = true;
    await animateFullTrajectory();
    proceedButton.textContent = getUIString('button_click_on_cookie', 'corrections_page');
});

// Sends a single correction trajectory to the server and loads the next one.
proceedButton.addEventListener('click', async () => {
    const titleElement = document.getElementById('page-title');
    const progressBar = document.getElementById('progress-bar-container');
    if (titleElement) {
        const progressBarHeight = progressBar ? progressBar.offsetHeight : 0;
        const elementPosition = titleElement.getBoundingClientRect().top + window.scrollY;
        const offsetPosition = elementPosition - progressBarHeight - 15; // 15px margin

        window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
        });
    }

    proceedButton.disabled = true;
    resetButton.disabled = true;
    playPlanButton.disabled = true;


    showAppMessage('message-box', getUIString('message_saving_correction', 'corrections_page'), 'muted');

    if (isPracticeMode) {
        startRealCorrectionsTask();
        return;
    }

    const correctionData = {
        env_id: allCorrectionScenarios[currentCorrectionIndex].env_id,
        original_trajectory: originalTrajectory,
        corrected_trajectory: correctedTrajectory,
        policy_type: currentPolicyType
    };


    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/submit-corrections-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([correctionData]), // API expects a list
            credentials: 'include'
        });
        if (!response.ok) throw new Error(await response.text());

        currentCorrectionIndex++;
        if (currentCorrectionIndex < maxCorrections) {
            await loadScenario(allCorrectionScenarios[currentCorrectionIndex]);
        } else {
            showAppMessage('message-box', getUIString('message_submitting_corrections', 'corrections_page'), 'info');
            await navigateToNextTask('message-box');
        }
    } catch (error) {
        showAppMessage('message-box', `${getUIString('error_submission_failed', 'corrections_page')} ${error.message}`, 'error');
        proceedButton.disabled = false;
    }
});

resetButton.addEventListener('click', () => {
    atLeastOneDrag = false;
    proceedButton.disabled = true;
    proceedButton.textContent = getUIString('button_click_on_cookie', 'corrections_page');
    resetAllCorrections();
    showAppMessage('message-box', getUIString('message_corrections_reset', 'corrections_page'), 'info');
});

document.addEventListener('keydown', async (event) => {
    // --- Handle Spacebar (replays plan) ---
    if (event.code === 'Space') {
        event.preventDefault();
        if (!playPlanButton.disabled) {
            playPlanButton.click();
        }
        return;
    }

    // --- Handle 'E' key to initiate a drag ---
    if (event.key.toLowerCase() === 'e' && keyboardMode === 'navigate') {
        event.preventDefault();
        const [row, col] = keyboardCursorPos;
        const cell = document.getElementById(`cell-${row}-${col}`);

        if (cell && cell.classList.contains('correction-hotspot') && (attemptsLeft > 0 || numCorrectionAttempts === -1)) {
            keyboardMode = 'drag';
            trajectoryBeforeDrag = JSON.parse(JSON.stringify(correctedTrajectory));
            const index = parseInt(cell.dataset.stepIndices.split(',')[0]);
            keyboardDragInfo = { index: index, originalCoords: [...keyboardCursorPos] };
            cell.classList.add('dragging');
            showAppMessage('message-box', getUIString('message_drag_mode_prompt', 'corrections_page'), 'info');
        }
        return;
    }

    // --- Handle Backspace ---
    if (event.key === 'Backspace') {
        event.preventDefault();
        handleStartClick();
        return;
    }

    // --- Handle Enter (finalizes round or confirms drag) ---
    if (event.key === 'Enter' && keyboardMode !== 'drag') {
        event.preventDefault();
        if (!isPlanPlayed) { return; }
        if (proceedButton && !proceedButton.disabled) {
            // proceedButton.disabled = true; // Disable button immediately to prevent double-presses
            proceedButton.click();
            return;
        }
        handleGoalClick();
        return;
    }

    // --- Handle Arrow Keys and in-drag Enter/Escape ---
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault();
    } else {
        return; // Ignore other keys
    }

    if (keyboardMode === 'navigate') {
        const [row, col] = keyboardCursorPos;
        let newRow = row, newCol = col;
        switch (event.key) {
            case 'ArrowUp': newRow--; break;
            case 'ArrowDown': newRow++; break;
            case 'ArrowLeft': newCol--; break;
            case 'ArrowRight': newCol++; break;
        }
        if (newRow >= 0 && newRow < GRID_ROWS && newCol >= 0 && newCol < GRID_COLS) {
            gridContainer.querySelector('.keyboard-cursor')?.classList.remove('keyboard-cursor');
            keyboardCursorPos = [newRow, newCol];
            document.getElementById(`cell-${newRow}-${newCol}`)?.classList.add('keyboard-cursor');
        }
    } else if (keyboardMode === 'drag') {
        const [row, col] = keyboardCursorPos;
        let newRow = row, newCol = col;
        switch (event.key) {
            case 'ArrowUp': newRow--; break;
            case 'ArrowDown': newRow++; break;
            case 'ArrowLeft': newCol--; break;
            case 'ArrowRight': newCol++; break;
            case 'Enter': {
                const distance = Math.abs(keyboardDragInfo.originalCoords[0] - row) + Math.abs(keyboardDragInfo.originalCoords[1] - col);
                if (distance > 0) {
                    if (numCorrectionAttempts !== -1 && distance > attemptsLeft) {
                        showAppMessage('message-box', getUIString('error_correction_too_large', 'corrections_page'), 'error');
                        correctedTrajectory = JSON.parse(JSON.stringify(trajectoryBeforeDrag));
                    } else {
                        if (numCorrectionAttempts !== -1) {
                            attemptsLeft -= distance;
                        }
                        const successMsg = (numCorrectionAttempts === -1)
                            ? getUIString('message_correction_applied_unlimited', 'corrections_page')
                            : getUIString('message_correction_applied_template', 'corrections_page').replace('{attemptsLeft}', attemptsLeft);
                        showAppMessage('message-box', successMsg, 'info');
                    }
                }
                keyboardMode = 'navigate';
                trajectoryBeforeDrag = [];
                updateGridAfterCorrection();
                return;
            }
            case 'Escape':
                keyboardMode = 'navigate';
                correctedTrajectory = JSON.parse(JSON.stringify(trajectoryBeforeDrag));
                showAppMessage('message-box', getUIString('message_correction_cancelled', 'corrections_page'), 'muted');
                trajectoryBeforeDrag = [];
                updateGridAfterCorrection();
                return;
        }
        if (newRow >= 0 && newRow < GRID_ROWS && newCol >= 0 && newCol < GRID_COLS) {
            keyboardCursorPos = [newRow, newCol];
            const newPath = requestAndDrawPreview(keyboardDragInfo.index, keyboardDragInfo.originalCoords, keyboardCursorPos);
            if (newPath) correctedTrajectory = newPath;
            gridContainer.querySelector('.dragging')?.classList.remove('dragging');
            gridContainer.querySelector('.keyboard-cursor')?.classList.remove('keyboard-cursor');
            document.getElementById(`cell-${newRow}-${newCol}`)?.classList.add('keyboard-cursor', 'dragging');
        }
    }
});

/**
 * Removes click listeners and styling from cells that were valid correction targets.
 */
function cleanupCorrectionTargets() {
    const targetCells = gridContainer.querySelectorAll('.correction-target-cell');
    targetCells.forEach(cell => {
        cell.classList.remove('correction-target-cell');
        // cell.removeEventListener('click', handleCorrectionCellClick);
        delete cell.dataset.correctionDirection;
    });
}


/**
 * Displays a small pop-up to let the user choose which instance of a repeated step to correct.
 * @param {HTMLElement} targetCell The cell element that was clicked.
 * @param {number[]} indices An array of step indices associated with the clicked cell.
 */
function showStepChooser(targetCell, indices) {
    // First, remove any chooser that might already be open.
    const existingChooser = document.getElementById('step-chooser');
    if (existingChooser) existingChooser.remove();

    // Create the main container for the pop-up.
    const chooser = document.createElement('div');
    chooser.id = 'step-chooser';
    // Basic styling (you can move this to your CSS file for better organization).
    chooser.style.position = 'absolute';
    chooser.style.backgroundColor = 'white';
    chooser.style.border = '1px solid #ccc';
    chooser.style.borderRadius = '8px';
    chooser.style.padding = '10px';
    chooser.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    chooser.style.zIndex = '100'; // Ensure it appears above the grid.

    // Add a title to the pop-up.
    const title = document.createElement('p');
    title.textContent = "This point appears multiple times. Which step do you want to correct?";
    title.style.margin = '0 0 10px 0';
    title.style.fontWeight = 'bold';
    chooser.appendChild(title);

    // This function will remove the pop-up AND the global event listener.
    // This prevents memory leaks and ensures the listener is only active when needed.
    const cleanup = () => {
        chooser.remove();
        document.removeEventListener('click', handleClickOutside);
    };

    // Create a button for each instance.
    indices.forEach(index => {
        const button = document.createElement('button');
        button.textContent = `Correct Step ${index}`;
        button.className = 'btn btn-sm btn-outline-primary'; // Use Bootstrap classes for styling.
        button.style.marginRight = '5px';
        button.classList.add('btn-primary');

        button.onclick = () => {
            // When a button is clicked, set the global state and show the correction arrows.
            stepToCorrect = index;
            showCorrectionInterface();
            // Remove the chooser pop-up.
            chooser.remove();
        };
        chooser.appendChild(button);
    });

    // Add a cancel button to close the pop-up without making a choice.
    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'btn btn-sm btn-outline-secondary';
    cancelButton.classList.add('btn-danger');
    cancelButton.onclick = () => chooser.remove();
    chooser.appendChild(cancelButton);

    // Position the chooser next to the clicked cell.
    const rect = targetCell.getBoundingClientRect();
    chooser.style.left = `${rect.left + window.scrollX}px`;
    chooser.style.top = `${rect.bottom + window.scrollY + 5}px`; // 5px below the cell.

    // Add the chooser to the document body.
    document.body.appendChild(chooser);

    // The "Click Outside" logic
    // Define the event handler that will listen for clicks on the document.
    const handleClickOutside = (event) => {
        // If the click happened inside the chooser OR on the original cell that opened it, do nothing.
        if (chooser.contains(event.target) || targetCell.contains(event.target)) {
            return;
        }
        // Otherwise, the click was "outside," so we clean up the chooser.
        cleanup();
    };

    // Add the event listener to the document.
    // We use a timeout of 0 to push this to the next event loop cycle. This prevents
    // the same click that opened the chooser from immediately triggering this listener and closing it.
    setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
    }, 0);
}

// To draw the path instantly without animation
function drawStaticTrajectory(trajectory) {
    // Clear previous path visualization
    gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove('trajectory-path-cell', 'correction-hotspot', 'dragging');
    });

    // Draw the new path
    trajectory.forEach(pos => {
        const cell = document.getElementById(`cell-${pos[0]}-${pos[1]}`);
        if (cell) {
            cell.classList.add('trajectory-path-cell');
        }
    });
}

// To handle the backend request and preview drawing
function requestAndDrawPreview(startIndex, startCoords, targetCoords) {
    console.log(`%c[Corrections] requestAndDrawPreview called for index ${startIndex}`, 'font-weight: bold; color: orange;');
    const correctionVector = [targetCoords[0] - startCoords[0], targetCoords[1] - startCoords[1]];

    if (correctionVector[0] === 0 && correctionVector[1] === 0) {
        drawStaticTrajectory(trajectoryBeforeDrag);
        return trajectoryBeforeDrag;
    }

    const deformed = deformTrajectory(trajectoryBeforeDrag, startIndex, correctionVector);

    const envData = {
        grid_rows: GRID_ROWS,
        grid_cols: GRID_COLS,
        cliff_states: CLIFF_STATES,
    };
    const result = fixDeformedTrajectory(trajectoryBeforeDrag, deformed, envData);

    // Store the pruned cells from the result for styling later.
    lastPrunedCells = result.pruned || [];

    if (result.path) {
        drawStaticTrajectory(result.path);
        return result.path;
    }
}

// Event handlers for mouse actions
function handleGridMouseDown(event) {
    const clickedCell = event.target.closest('.correction-hotspot');
    // This condition now allows dragging if attempts are infinite (not -1)
    // OR if there are attempts left in the normal, finite mode.
    if (!clickedCell || (attemptsLeft <= 0 && numCorrectionAttempts !== -1)) {
        return;
    }

    event.preventDefault();
    isDragging = true;
    trajectoryBeforeDrag = JSON.parse(JSON.stringify(correctedTrajectory));
    const index = parseInt(clickedCell.dataset.stepIndices.split(',')[0]);
    dragStartInfo = {
        index: index,
        coords: correctedTrajectory[index],
        lastMouseCoords: null // Add this to track mouse position during the drag
    };

    clickedCell.classList.add('dragging');
    gridContainer.style.cursor = 'grabbing';
}

function handleGridMouseMove(event) {
    if (!isDragging) return;

    const targetCell = event.target.closest('.grid-cell');
    if (!targetCell) return;

    const targetCoords = [parseInt(targetCell.dataset.row), parseInt(targetCell.dataset.col)];

    // Only run the logic if the mouse has moved to a new grid cell
    if ((dragStartInfo.lastMouseCoords || []).join(',') !== targetCoords.join(',')) {
        dragStartInfo.lastMouseCoords = targetCoords; // Update the last known position

        const newPath = requestAndDrawPreview(dragStartInfo.index, dragStartInfo.coords, targetCoords);
        if (newPath) {
            correctedTrajectory = newPath;
        }
        // Remove the snap indicator from any previous cells
        document.querySelectorAll('.correction-target-cell').forEach(c => c.classList.remove('correction-target-cell'));


        // Find the closest cell in the trajectory to the new mouse position
        const closestHotspot = findClosestHotspot(targetCoords, correctedTrajectory).coords;

        if (closestHotspot) {
            // Add the indicator class to the closest cell
            const closestCell = document.getElementById(`cell-${closestHotspot[0]}-${closestHotspot[1]}`);
            if (closestCell) {
                closestCell.classList.add('correction-target-cell');
            }
        }
    }
    proceedButton.disabled = true;
    proceedButton.textContent = getUIString('button_click_on_cookie', 'corrections_page');

    // Instantly apply the pruned path style after a drag.
    applyPrunedPathStyle();
}

function handleGridMouseUp(event) {
    if (!isDragging) return;

    // IMMEDIATELY stop dragging and clean up visual state - this must happen first
    isDragging = false;
    gridContainer.style.cursor = 'default';
    gridContainer.querySelector('.dragging')?.classList.remove('dragging');
    
    // Remove the snap indicator from any and all cells to ensure a clean state on mouse up.
    gridContainer.querySelectorAll('.correction-target-cell').forEach(c => c.classList.remove('correction-target-cell'));

    const startCoords = dragStartInfo.coords;

    let endCoords;
    const finalPathLength = correctedTrajectory.length;
    const originalIndex = dragStartInfo.index;

    // Safely determine the end coordinates
    if (finalPathLength > 0 && originalIndex < finalPathLength) {
        // If the original index is still valid in the new path, use it.
        endCoords = correctedTrajectory[originalIndex];
    } else if (finalPathLength > 0) {
        // If the path was shortened past the drag point, use the new last point of the path.
        endCoords = correctedTrajectory[finalPathLength - 1];
    } else {
        // As a fallback, if the path is somehow empty, use the start coordinates.
        endCoords = startCoords; 
    }

    const distance = Math.abs(startCoords[0] - endCoords[0]) + Math.abs(startCoords[1] - endCoords[1]);

    if (distance > 0) {
        // Check the distance against attempts ONLY if attempts are not infinite.
        if (numCorrectionAttempts !== -1 && distance > attemptsLeft) {
            showAppMessage('message-box', getUIString('error_correction_too_large_for_attempts', 'corrections_page'), 'error');
            correctedTrajectory = JSON.parse(JSON.stringify(trajectoryBeforeDrag));
        } else {
            // Only subtract from attemptsLeft if they are not infinite.
            if (numCorrectionAttempts !== -1) {
                attemptsLeft -= distance;
            }
            const successMsg = (numCorrectionAttempts === -1)
                ? getUIString('message_correction_applied_unlimited', 'corrections_page')
                : getUIString('message_correction_applied_template', 'corrections_page').replace('{attemptsLeft}', attemptsLeft);
            showAppMessage('message-box', successMsg, 'info');
            atLeastOneDrag = true;
        }
    }

    // Clean up the temporary state
    trajectoryBeforeDrag = [];

    // Call the main update function to redraw hotspots and fix UI state.
    updateGridAfterCorrection();
}

/**
 * Handles the case where the mouse leaves the document window during a drag.
 * This prevents the application from getting stuck in a dragging state.
 * @param {MouseEvent} event The mouseleave event.
 */
function handleMouseLeave(event) {
    // If we are dragging and the mouse exits the window, we'll treat it
    // as if the mouse button was released to prevent a stuck state.
    if (isDragging) {
        console.warn("[Corrections] Mouse left the window during a drag. Forcing mouse up.");
        handleGridMouseUp(event); // Re-use the existing mouse-up logic for cleanup.
    }
}

function updateGridAfterCorrection() {
    // Clear the visual style from any cells that were part of the pruned path during the drag.
    gridContainer.querySelectorAll('.path-cell').forEach(cell => {
        cell.classList.remove('path-cell');
    });

    // Reset the global list of pruned cells so they don't reappear later.
    lastPrunedCells = [];

    if (atLeastOneDrag) {
        resetButton.disabled = false;
    }

    // Instantly draw the current state of the path
    drawStaticTrajectory(correctedTrajectory);   
    

    // Clear any old hotspots or highlights
    gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
        cell.classList.remove('correction-hotspot', 'dragging', 'keyboard-cursor');
    });

    // Re-enable the goal cell listener
    const goalCell = gridContainer.querySelector('.goal-cell');
    if (goalCell) goalCell.addEventListener('click', handleGoalClick);

    const startCell = document.getElementById(`cell-${START_STATE[0]}-${START_STATE[1]}`);
    if (startCell) {
        startCell.onclick = handleStartClick;
    }

    // Show reset button if corrections have been made
    if (correctedTrajectory.join(',') !== originalTrajectory.join(',')) {
        // resetCorrectionsButton.classList.remove('hidden');
    }

    // Create a map of cell locations to their indices in the trajectory
    const cellIndicesMap = new Map();
    for (let i = 0; i < correctedTrajectory.length; i++) {
        const pos = correctedTrajectory[i];
        if ((pos[0] === START_STATE[0] && pos[1] === START_STATE[1]) || (pos[0] === GOAL_STATE[0] && pos[1] === GOAL_STATE[1])) {
            continue;
        }
        const cellId = `cell-${pos[0]}-${pos[1]}`;
        if (!cellIndicesMap.has(cellId)) {
            cellIndicesMap.set(cellId, []);
        }
        cellIndicesMap.get(cellId).push(i);
    }

    // Apply the 'correction-hotspot' class to the cells
    for (const [cellId, indices] of cellIndicesMap.entries()) {
        const cell = document.getElementById(cellId);
        if (cell) {
            cell.classList.add('correction-hotspot');
            cell.dataset.stepIndices = indices.join(',');
        }
    }
}


/**
 * Finds the point in a given trajectory that is closest to a target coordinate.
 * It only considers points that are active, clickable "hotspots" on the grid,
 * ignoring the start and goal locations.
 *
 * @param {number[]} targetCoords - The [row, col] coordinates of the current mouse position.
 * @param {Array<Array<number>>} trajectory - The trajectory (an array of [row, col] points) to search within.
 * @returns {{index: number, coords: number[], distance: number}|null} An object with the index, coordinates,
 * and distance of the closest hotspot, or null if no valid hotspot is found.
 */
function findClosestHotspot(targetCoords, trajectory) {
    let minDistance = Infinity;
    let closestPointInfo = null;

    // Iterate over each point in the provided trajectory.
    trajectory.forEach((point, index) => {
        // Construct the ID for the corresponding grid cell DOM element.
        const cellId = `cell-${point[0]}-${point[1]}`;
        const cell = document.getElementById(cellId);

        // Check if the cell exists.
        if (cell) {
            // Calculate the Manhattan distance from the trajectory point to the mouse cursor.
            // This is a fast and effective way to measure distance on a grid.
            const distance = Math.abs(point[0] - targetCoords[0]) + Math.abs(point[1] - targetCoords[1]);

            // If this point is closer than any we've found so far, update our result.
            if (distance < minDistance) {
                minDistance = distance;
                closestPointInfo = {
                    index: index,
                    coords: point,
                    distance: distance
                };
            }
        }
    });

    return closestPointInfo;
}

/**
 * Applies the pruned path style to the cells that were removed by the fixing algorithm.
 * This is used to visually indicate which cells were pruned from the path.
 */
function applyPrunedPathStyle() {
    // First, clear any old pruned styles that might be lingering.
    gridContainer.querySelectorAll('.path-cell').forEach(cell => {
        cell.classList.remove('path-cell');
    });

    // Now, iterate through the cells that the fixing algorithm just removed and style them.
    if (lastPrunedCells && lastPrunedCells.length > 0) {
        lastPrunedCells.forEach(pos => {
            const prunedCell = document.getElementById(`cell-${pos[0]}-${pos[1]}`);
            if (prunedCell && !prunedCell.classList.contains('start-cell') && !prunedCell.classList.contains('goal-cell')) {
                prunedCell.classList.add('path-cell'); // Apply the style
            }
        });
    }
}

// --- Initial Load ---
initializePage();