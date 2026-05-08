// --- DOM Elements ---
const taskLoader = document.getElementById('task-loader');
const loaderText = document.getElementById('loader-text');
const actualTaskContent = document.getElementById('actual-game-content');
const taskTitleElement = document.getElementById('page-title');
const gridContainer = document.getElementById('grid-container');
const playStopButton = document.getElementById('playStopButton');
const proceedButton = document.getElementById('proceedButton');
const resetButton = document.getElementById('resetButton'); // The "Reset All" button
let isInitialPlanPlayed = false;

// --- State ---
let allOffScenarios = [], practiceScenario = null, isPracticeMode = false;
let currentOffIndex = 0, maxOffs = 0;
let isAnimating = false, animationFrameId = null;
let originalTrajectory = [], currentTrajectory = [], currentStepIndex = 0;
let placedObstacles = []; // NEW: Tracks user-placed obstacles [[r, c], ...]
let selectedCell = null; // NEW: Tracks the currently focused cell for keyboard controls
let offTaskAnimationSpeed = 1400;
let agentElement = null, currentEnvData = null;
let latestInterventionForCurrentTrial = null;
let preservedTrajectoryEndIndex = 0;
let currentPolicyType = '';
let overallTaskCurrentNum = 0, overallTaskTotalNum = 0, taskSpecificTitle = "";
let currentProgressInfo = null;
let maxObstacles = 5; // Add a new state variable for the limit


// --- Initialization ---
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility();
    document.title = getUIString('title', 'off_page');
    taskTitleElement.textContent = getUIString('title', 'off_page');
    loaderText.textContent = getUIString('loading_task', 'common');
    proceedButton.textContent = getUIString('button_start_task', 'common');
    await initializeOffTask();
}

async function initializeOffTask() {
    showAppMessage('message-box', getUIString('loading_task', 'common'), 'info');
    try {
        const statusResponse = await fetch(`${FLASK_SERVER_URL}/api/check-form-status`, { credentials: 'include' });
        const statusData = await statusResponse.json();
        if (statusData.instruction_group) USER_GROUP = statusData.instruction_group;
        if (!statusResponse.ok || !statusData.form_completed) { window.location.href = 'index.html'; return; }

        const response = await fetch(`${FLASK_SERVER_URL}/api/off-setup`, { credentials: 'include' });
        const setupData = await response.json();

        currentProgressInfo = setupData.progress_info;
        updateProgressBar(currentProgressInfo, isPracticeMode ? null : 1, maxOffs);

        overallTaskCurrentNum = setupData.overall_task_current_num;
        overallTaskTotalNum = setupData.overall_task_total_num;
        taskSpecificTitle = setupData.task_title;
        practiceScenario = setupData.practice_scenario;
        allOffScenarios = setupData.off_scenarios || [];
        maxOffs = setupData.max_offs || 0;
        maxObstacles = setupData.num_off_attempts || 5;
        offTaskAnimationSpeed = setupData.animation_speed || 1400;

        playStopButton.classList.remove('hidden');
        resetButton.classList.remove('hidden');
        proceedButton.classList.remove('hidden');
        playStopButton.disabled = true;
        proceedButton.disabled = true;
        resetButton.disabled = true;

        await fetchAndRenderStructuredInstructions(`/api/instructions?task=off`, 'task-instructions-container', 'message-box', 'off', true);
        
        taskLoader.classList.add('hidden');
        actualTaskContent.classList.remove('hidden');

        if (practiceScenario) {
            isPracticeMode = true;
            await loadOffScenario(practiceScenario, true);
        } else {
            isPracticeMode = false;
            await startRealOffTasks();
        }
    } catch (error) {
        console.error("Error initializing OFF task:", error);
        loaderText.textContent = `Error: ${error.message}`;
        showAppMessage('message-box', `Initialization Error: ${error.message}`, 'error');
    }
}

async function startRealOffTasks() {
    isPracticeMode = false;
    currentOffIndex = 0;
    if (allOffScenarios.length === 0) {
        showAppMessage('message-box', getUIString('message_no_scenarios', 'off_page'), "warn");
        await navigateToNextTask('message-box');
        return;
    }
    await loadOffScenario(allOffScenarios[0], false);
}

async function loadOffScenario(scenario, isPractice = false) {
    console.log(`%c--- Loading Scenario: ${scenario.env_id} (Practice: ${isPractice}) ---`, 'color: blue; font-weight: bold;');

    currentPolicyType = scenario.policy_type_served;
    originalTrajectory = [];
    currentTrajectory = [];

    placedObstacles = [];
    isPracticeMode = isPractice;
    isInitialPlanPlayed = false;
    isAnimating = false;
    if (animationFrameId) clearTimeout(animationFrameId);
    latestInterventionForCurrentTrial = null;
    preservedTrajectoryEndIndex = 0;

    showAppMessage('message-box', getUIString('message_initial_prompt', 'off_page').replace('{scenarioName}', scenario.env_id), 'info');

    updateProgressBar(currentProgressInfo, isPractice ? null : currentOffIndex + 1, maxOffs);

    const miniGameText = getUIString('task_title_template', 'common').replace('{current}', overallTaskCurrentNum).replace('{total}', overallTaskTotalNum);
    let roundText = '';
    if (isPracticeMode) {
        roundText = ` (${getUIString('progress_practice_notice', 'common')})`;
    } else if (maxOffs > 0) {
        const roundInfo = getUIString('progress_round_template', 'common')
            .replace('{current}', currentOffIndex + 1)
            .replace('{total}', maxOffs);
        roundText = ` (${roundInfo})`;
    }
    taskTitleElement.textContent = miniGameText + roundText;

    if (isPracticeMode) displayPracticeBanner('practice-banner-container');
    else { const banner = document.getElementById('practice-banner'); if (banner) banner.remove(); }

    currentEnvData = await (await fetch(`${FLASK_SERVER_URL}/api/environment/${scenario.env_id}`, { credentials: 'include' })).json();
    const trajectory = generateAndSelectBestPerturbation(scenario.policy_to_use, scenario.rival_policy, currentEnvData, scenario.epsilon);
    originalTrajectory = [...trajectory];
    currentTrajectory = [...trajectory];

    drawGrid(gridContainer, currentEnvData, { cellSize: 50 });

    resetUIForNewTrial();
}

function resetUIForNewTrial() {
    resetAgentAndHighlights();
    playStopButton.textContent = getUIString('button_watch_current_plan', 'off_page');
    playStopButton.classList.remove('btn-danger');
    playStopButton.classList.add('btn-primary');
    playStopButton.disabled = false;

    proceedButton.disabled = true;

    // Set the text for the reset button.
    resetButton.classList.add('btn-danger');
    resetButton.textContent = getUIString('button_reset_trial', 'off_page');
    resetButton.disabled = true;

    if (isPracticeMode) {
        proceedButton.textContent = getUIString('button_end_practice', 'common');
    } else {
        const isLast = (currentOffIndex + 1) >= maxOffs;
        proceedButton.textContent = isLast
            ? getUIString('button_finish_and_submit', 'common')
            : getUIString('button_next_map', 'common');
    }
}


// --- Core Gameplay Flow ---

function startInitialAnimation() {
    console.log("Starting initial, uninterruptible animation.");
    if (isAnimating) return;

    isAnimating = true;
    currentStepIndex = 0;
    resetAgentAndHighlights();

    playStopButton.disabled = true;
    playStopButton.textContent = getUIString('button_watching_plan', 'off_page');
    proceedButton.disabled = true;
    resetButton.disabled = true; // Disable reset button during animation
    showAppMessage('message-box', getUIString('message_animation_playing_status', 'off_page'), 'muted');

    animateStep(true, () => {
        console.log("Initial animation finished.");
        isAnimating = false;
        isInitialPlanPlayed = true;
        enterObstacleMode();
    });
}

function enterObstacleMode() {
    console.log("Entering obstacle placement mode.");

    if (agentElement) agentElement.remove();
    agentElement = animateAgentMove(null, null, currentEnvData.start_state, { goalState: currentEnvData.goal_state });

    // Clear all previous path styling first
    gridContainer.querySelectorAll('.grid-cell.path-cell, .grid-cell.trajectory-path-cell').forEach(c => {
        c.classList.remove('path-cell', 'trajectory-path-cell');
    });

    const clickableCellIds = new Set();

    // Apply new styles based on whether the path segment is preserved or new
    currentTrajectory.forEach((pos, index) => {
        const cell = document.getElementById(`cell-${pos[0]}-${pos[1]}`);
        if (cell) {
            // If it's the start cell, apply no additional path styling and skip to the next point.
            if (index === 0) {
                return;
            }

            // For all other cells in the trajectory:
            if (index < preservedTrajectoryEndIndex) {
                // Style for the preserved, unclickable part of the path (reddish)
                cell.classList.add('path-cell');
            } else {
                // Style for the new, clickable part of the path (bluish)
                cell.classList.add('trajectory-path-cell');
                clickableCellIds.add(cell.id);
            }
        }
    });

    // Also make existing obstacles clickable for removal
    placedObstacles.forEach(obs => clickableCellIds.add(`cell-${obs[0]}-${obs[1]}`));

    // Update click handlers for the entire grid
    gridContainer.querySelectorAll('.grid-cell').forEach(cell => {
        if (clickableCellIds.has(cell.id)) {
            cell.classList.add('trajectory-cell'); // Visual cue for clickable
            cell.onclick = () => handleCellClickForObstacle(cell);
            cell.tabIndex = 0;
        } else {
            // Ensure non-clickable cells have no handler or special class
            cell.classList.remove('trajectory-cell');
            cell.onclick = null;
            cell.tabIndex = -1;
        }
    });

    const startCell = document.getElementById(`cell-${currentEnvData.start_state[0]}-${currentEnvData.start_state[1]}`);
    if (startCell) {
        startCell.onclick = handleElfieClickToReset;
        startCell.tabIndex = -1;
    }

    const goalCell = gridContainer.querySelector('.goal-cell');
    if (goalCell) {
        goalCell.classList.add('trajectory-cell');
        goalCell.onclick = handleGoalClick;
        goalCell.tabIndex = 0;
    }

    // Update playStopButton to allow replaying current trajectory
    playStopButton.disabled = false;
    playStopButton.textContent = getUIString('button_watch_current_plan', 'off_page');

    // resetButton.disabled = placedObstacles.length === 0; // FIX: Disable reset button if no obstacles exist
    resetButton.disabled = preservedTrajectoryEndIndex === 0; // Disable reset button if the traj has no stitches
    proceedButton.disabled = true;
    proceedButton.textContent = getUIString('button_click_on_cookie', 'off_page');

    const obstaclesLeft = maxObstacles - placedObstacles.length;
    showAppMessage('message-box', getUIString('message_obstacle_prompt_template', 'off_page').replace('{obstaclesLeft}', obstaclesLeft), 'info');

    if (startCell) {
        startCell.classList.remove('current-pos-highlight');
        startCell.classList.add('path-cell'); // highlight the start cell red
        goalCell.classList.add('current-pos-highlight'); // Highlight the goal cell
    }

    proceedButton.textContent = getUIString('button_click_on_cookie', 'off_page');
}


async function handlePlayNewPathClick() {
    console.log("User clicked 'Play New Path'. Sending obstacles to backend.");
    playStopButton.disabled = true;
    playStopButton.textContent = getUIString('button_recalculating', 'off_page');
    resetButton.disabled = true; // Disable reset button during retraining
    showAppMessage('message-box', getUIString('message_training_new_policy', 'off_page'), 'muted');

    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/retrain-and-replan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                env_id: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).env_id,
                policy_type: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).policy_type,
                temp_o_states: placedObstacles
            }),
            credentials: 'include'
        });

        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();
        currentTrajectory = data.new_trajectory;
        console.log("Received new trajectory from backend. Length:", currentTrajectory.length);

        // Automatically play the new trajectory
        playCurrentTrajectoryAnimation();

    } catch (error) {
        console.error("Error retraining and replanning:", error);
        showAppMessage('message-box', `Error generating new path: ${error.message}`, 'error');
        // Re-enable buttons on failure
        playStopButton.textContent = getUIString('button_play_new_path', 'off_page');
        playStopButton.disabled = placedObstacles.length === 0;
        resetButton.disabled = placedObstacles.length === 0;
    }
}

function playCurrentTrajectoryAnimation() {
    console.log("Playing new/current trajectory animation.");
    if (isAnimating) return;

    isAnimating = true;
    currentStepIndex = 0;
    resetAgentAndHighlights();

    playStopButton.disabled = true;
    playStopButton.textContent = getUIString('button_watching_new_plan', 'off_page');
    resetButton.disabled = true; // Disable reset button during animation
    showAppMessage('message-box', getUIString('message_playing_new_plan', 'off_page'), 'muted');

    animateStep(false, () => {
        console.log("New trajectory animation finished.");
        isAnimating = false;
        // Return to obstacle mode so the user can add more or finalize.
        enterObstacleMode();
    });
}

/**
 * Handles clicks on grid cells for obstacle placement/removal.
 * @param {HTMLElement} cell - The clicked grid cell element.
 * This function manages both adding and removing obstacles based on the current state.
 * It checks if the clicked cell is already an obstacle or part of the trajectory,
 * and updates the UI accordingly.
 * @param {Array} placedObstacles - The current list of placed obstacles.
 * This function modifies the placedObstacles array directly.
 */
async function handleCellClickForObstacle(cell) {
    if (isAnimating) return;

    proceedButton.disabled = true; // Disable the "Next" button during obstacle placement

    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    const startKey = currentEnvData.start_state.join(',');
    const goalKey = currentEnvData.goal_state.join(',');
    if (`${row},${col}` === startKey || `${row},${col}` === goalKey) return;

    // Disable UI during any action
    gridContainer.style.pointerEvents = 'none';
    resetButton.disabled = true; // Disable reset button during obstacle placement/removal

    const previousTrajectory = [...currentTrajectory];
    const obstacleIndexToRemove = placedObstacles.findIndex(obs => obs[0] === row && obs[1] === col);

    if (obstacleIndexToRemove > -1) {
        // --- LOGIC TO REMOVE AN OBSTACLE ---
        const removedObstacle = placedObstacles.splice(obstacleIndexToRemove, 1)[0];
        cell.classList.remove('obstacle-cell');
        showAppMessage('message-box', getUIString('message_obstacle_removed_recalculating', 'off_page'), 'muted');

        try {
            // A removal requires a full replan from the start state
            const response = await fetch(`${FLASK_SERVER_URL}/api/retrain-and-replan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    env_id: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).env_id,
                    policy_type: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).policy_type_served,
                    temp_o_states: placedObstacles // Send the updated (smaller) list
                }),
                credentials: 'include'
            });
            if (!response.ok) throw new Error(await response.text());

            const data = await response.json();

            currentTrajectory = pruneTrajectory(data.new_trajectory);

            preservedTrajectoryEndIndex = getPreservedTrajectoryEndIndex(currentTrajectory, previousTrajectory);

            playCurrentTrajectoryAnimation();

        } catch (error) {
            console.error("Error after removing obstacle:", error);
            showAppMessage('message-box', getUIString('error_recalculating_path', 'off_page') + error.message, 'error');
            // On failure, put the obstacle back visually and in the state array
            placedObstacles.splice(obstacleIndexToRemove, 0, removedObstacle);
            cell.classList.add('obstacle-cell');
        }

    } else {
        // --- LOGIC TO ADD AN OBSTACLE ---
        if (placedObstacles.length >= maxObstacles) {
            showAppMessage('message-box', getUIString('error_max_obstacles_template', 'off_page').replace('{maxObstacles}', maxObstacles), 'error');
            gridContainer.style.pointerEvents = 'auto'; // Re-enable UI
            resetButton.disabled = placedObstacles.length === 0; // Re-enable reset button
            return;
        }

        // Use the existing isSolvable function with the proper arguments.
        const newObstacle = [row, col];
        const tempObstacles = [...placedObstacles, newObstacle];
        if (!isSolvable(currentEnvData, currentEnvData.start_state, currentEnvData.goal_state, tempObstacles)) {
            showAppMessage('message-box', getUIString('error_unsolvable_obstacle', 'off_page'), 'error');
            gridContainer.style.pointerEvents = 'auto'; // Re-enable UI
            return;
        }

        const addIndex = currentTrajectory.findIndex(p => p[0] === row && p[1] === col);
        if (addIndex <= 0) {
            showAppMessage('message-box', getUIString('error_place_on_blue_path', 'off_page'), 'warn');
            gridContainer.style.pointerEvents = 'auto'; // Re-enable UI
            return;
        }

        const preservedTrajectory = currentTrajectory.slice(0, addIndex);
        preservedTrajectoryEndIndex = preservedTrajectory.length;
        const newStartState = currentTrajectory[addIndex - 1];

        placedObstacles.push(newObstacle);
        cell.classList.add('obstacle-cell');
        showAppMessage('message-box', getUIString('message_obstacle_placed_retraining', 'off_page'), 'muted');

        try {
            // Adding an obstacle uses the partial replan for a smooth continuation
            const response = await fetch(`${FLASK_SERVER_URL}/api/replan-from-point`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    env_id: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).env_id,
                    policy_type: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).policy_type_served,
                    temp_o_states: placedObstacles,
                    new_start_state: newStartState
                }),
                credentials: 'include'
            });
            if (!response.ok) throw new Error(await response.text());

            const data = await response.json();
            const stitchedTrajectory = preservedTrajectory.concat(data.new_trajectory_segment.slice(1));
            // Prune the stitched trajectory
            currentTrajectory = pruneTrajectory(stitchedTrajectory);

            preservedTrajectoryEndIndex = getPreservedTrajectoryEndIndex(currentTrajectory, previousTrajectory);

            playCurrentTrajectoryAnimation();

        } catch (error) {
            console.error("Error replanning from point:", error);
            showAppMessage('message-box', getUIString('error_recalculating_path', 'off_page') + error.message, 'error');
            placedObstacles.pop();
            cell.classList.remove('obstacle-cell');
        }
    }

    // This block runs after both add or remove attempts
    gridContainer.style.pointerEvents = 'auto'; // Re-enable clicks
}

function animateStep(isInitialUnstoppable = false, onCompleteCallback) {
    if (currentStepIndex >= currentTrajectory.length) {
        if (onCompleteCallback) onCompleteCallback();
        return;
    }

    const oldPos = currentStepIndex > 0 ? currentTrajectory[currentStepIndex - 1] : currentTrajectory[0];
    const newPos = currentTrajectory[currentStepIndex];
    agentElement = animateAgentMove(agentElement, oldPos, newPos, { goalState: currentEnvData.goal_state });

    currentStepIndex++;
    animationFrameId = setTimeout(() => animateStep(isInitialUnstoppable, onCompleteCallback), offTaskAnimationSpeed);
}

function handleGoalClick() {
    if (isAnimating) return;
    if (!isInitialPlanPlayed) return;
    console.log("Goal clicked. Finalizing intervention for this trial.");

    latestInterventionForCurrentTrial = {
        env_id: (isPracticeMode ? practiceScenario : allOffScenarios[currentOffIndex]).env_id,
        policy_type: currentPolicyType,
        original_trajectory: originalTrajectory,
        final_trajectory: currentTrajectory,
        obstacles: placedObstacles
    };

    console.log("Intervention recorded:", latestInterventionForCurrentTrial);

    proceedButton.disabled = false;

    if (isPracticeMode) {
        proceedButton.textContent = getUIString('button_end_practice', 'common');
    } else {
        const isLast = (currentOffIndex + 1) >= maxOffs;
        proceedButton.textContent = isLast
            ? getUIString('button_finish_and_submit', 'common')
            : getUIString('button_next_map', 'common');
    }

    // // Disable the other gameplay buttons since the trial is finalized.
    // resetButton.disabled = true;
}

function handleElfieClickToReset() {
    if (isAnimating) return;
    console.log("Resetting trial state.");
    showAppMessage('message-box', getUIString('message_trial_reset', 'off_page'), 'info');
    // isInitialPlanPlayed = false;
    currentTrajectory = [...originalTrajectory];
    placedObstacles = [];
    preservedTrajectoryEndIndex = 0;
    resetUIForNewTrial(); // This will handle all UI resets, including disabling the button.
    playCurrentTrajectoryAnimation();
}


function resetAgentAndHighlights() {
    // Remove the agent sprite from the grid.
    if (agentElement) agentElement.remove();

    // Query all grid cells and robustly remove all path-related styles,
    // mirroring the logic from corrections.js.
    gridContainer.querySelectorAll('.grid-cell').forEach(c => {
        c.classList.remove(
            'path-cell',              // The style for the preserved path
            'trajectory-path-cell',   // The style for the new path
            'obstacle-cell',          // The style for obstacles (re-added below)
            'trajectory-cell',        // The class that makes cells appear clickable
            'selected-cell',          // The class for keyboard selection
            'current-pos-highlight'   // The class for the agent's animated position
        );
    });

    // Re-apply the obstacle 'X' markers, as they were just cleared.
    placedObstacles.forEach(obs => {
        const cell = document.getElementById(`cell-${obs[0]}-${obs[1]}`);
        if (cell) cell.classList.add('obstacle-cell');
    });

    // Place the agent at the start position.
    agentElement = animateAgentMove(null, null, currentEnvData.start_state, { goalState: currentEnvData.goal_state });

    // Restore click-to-reset functionality on Elfie's start position.
    const startCell = document.getElementById(`cell-${currentEnvData.start_state[0]}-${currentEnvData.start_state[1]}`);
    if (startCell) startCell.onclick = handleElfieClickToReset;
}


// --- Event Listeners ---
playStopButton.addEventListener('click', () => {
    const buttonText = playStopButton.textContent;
    if (playStopButton.textContent === getUIString('button_watch_current_plan', 'off_page')) {
        startInitialAnimation();
    } else if (playStopButton.textContent === getUIString('button_play_new_path', 'off_page')) {
        handlePlayNewPathClick();
    } else if (playStopButton.textContent === getUIString('button_watch_current_plan', 'off_page')) {
        playCurrentTrajectoryAnimation();
    }
});

resetButton.addEventListener('click', handleElfieClickToReset);

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
    playStopButton.disabled = true;

    if (isPracticeMode) {
        await startRealOffTasks();
        return;
    }

    if (latestInterventionForCurrentTrial) {
        showAppMessage('message-box', getUIString('message_saving_action', 'off_page'), 'muted');
        try {
            const response = await fetch(`${FLASK_SERVER_URL}/api/submit-off-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([latestInterventionForCurrentTrial]),
                credentials: 'include'
            });
            if (!response.ok) throw new Error(await response.text());
            latestInterventionForCurrentTrial = null;
        } catch (error) {
            showAppMessage('message-box', `${getUIString('error_submission_failed', 'off_page')} ${error.message}`, 'error');
            proceedButton.disabled = false;
            return;
        }
    }

    if (currentOffIndex + 1 < maxOffs) {
        currentOffIndex++;
        await loadOffScenario(allOffScenarios[currentOffIndex], false);
    } else {
        showAppMessage('message-box', getUIString('message_submitting_interventions', 'off_page'), 'muted');
        await navigateToNextTask('message-box');
    }
});

document.addEventListener('keydown', (event) => {
    // 1. If an animation is currently playing, ignore all key presses.
    if (isAnimating) {
        return;
    }

    const activeEl = document.activeElement;

    // --- Spacebar to Play Animation ---
    if (event.code === 'Space') {
        event.preventDefault();
        if (!playStopButton.disabled) {
            playStopButton.click();
        }
        return;
    }


    if (!isInitialPlanPlayed) return;

    // --- Enter to Finalize/Proceed ---
    if (event.key === 'Enter') {
        event.preventDefault();

        // If the initial plan has NOT been played yet, the "Enter" key must do nothing.
        if (!isInitialPlanPlayed) {
            return;
        }

        // Priority 1: Click the enabled progression buttons.
        if (proceedButton && !proceedButton.disabled) {
            // proceedButton.disabled = true; // Disable button immediately to prevent double-presse
            proceedButton.click();
            return;
        }

        // Priority 2: If no buttons are ready, simulate a "goal click" (cookie press).
        handleGoalClick();
        return;
    }

    // --- Backspace to Reset ---
    if (event.key === 'Backspace') {
        event.preventDefault();
        // Only allow reset if button is enabled and not animating
        if (!resetButton.disabled && !isAnimating) {
            handleElfieClickToReset();
        }
        return;
    }

    // --- Grid Navigation with Arrow Keys ---
    if (activeEl && activeEl.classList.contains('grid-cell')) {
        if (event.key.includes('Arrow')) {
            event.preventDefault();
            let r = parseInt(activeEl.dataset.row);
            let c = parseInt(activeEl.dataset.col);

            if (event.key === 'ArrowUp') r--;
            if (event.key === 'ArrowDown') r++;
            if (event.key === 'ArrowLeft') c--;
            if (event.key === 'ArrowRight') c++;

            const nextCell = document.getElementById(`cell-${r}-${c}`);
            if (nextCell && nextCell.classList.contains('trajectory-cell')) {
                nextCell.focus();
            }
        }
    }
});

// --- Utility Functions ---

/**
 * Finds the index where two trajectories start to differ.
 * This determines how much of the previous trajectory is preserved
 * when a new trajectory is calculated after obstacle placement.
 * If they are identical, returns the earlier preservedEndIndex to maintain the UI state.
 * 
 * @param {Array} currentTrajectory - The new trajectory after replanning
 * @param {Array} previousTrajectory - The previous trajectory before replanning
 * @returns {number} The index up to which both trajectories are identical (exclusive)
 */
function getPreservedTrajectoryEndIndex(newTraj, oldTraj) {
    let stitchIndex = 0;
    for (let i = 0; i < newTraj.length && i < oldTraj.length; i++) {
        if (newTraj[i][0] === oldTraj[i][0] && newTraj[i][1] === oldTraj[i][1]) {
            stitchIndex = i + 1;
        } else {
            break; // Stop at the first mismatch
        }
    }

    const areIdentical = newTraj.length === oldTraj.length && stitchIndex === newTraj.length;

    if (areIdentical) {
        // If the path hasn't changed, return the existing global index.
        return preservedTrajectoryEndIndex;
    }

    return stitchIndex;
}

// --- Initial Load ---
initializePage();