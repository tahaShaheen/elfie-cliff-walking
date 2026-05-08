// --- DOM Elements ---
const gameLoader = document.getElementById('game-loader');
const actualGameContent = document.getElementById('actual-game-content');
const taskTitleElement = document.querySelector('#actual-game-content h1');
const taskInstructionsArea = document.getElementById('demonstration-task-instructions-area');
const gridContainer = document.getElementById('grid-container');
const resetButton = document.getElementById('resetButton');
const proceedButton = document.getElementById('proceedButton');

const moveUpButton = document.getElementById('move-up');
const moveDownButton = document.getElementById('move-down');
const moveLeftButton = document.getElementById('move-left');
const moveRightButton = document.getElementById('move-right');

// --- State ---
let isPracticeMode = true;
let practiceEnvironmentId = null;
let environmentSequence = [];
let maxDemonstrationsInSequence = 0;
let currentDemonstrationIndex = 0;
let allCollectedDemonstrations = [];

let GRID_ROWS = 0, GRID_COLS = 0, START_STATE = [], GOAL_STATE = [], CLIFF_STATES = [];
let agentElement = null, agentCurrentPos = [], currentEnvironmentId = null, agentSpriteUrl = '/static/imgs/elf_down.png';
let currentUserTrajectory = [];
let isInputDisabled = false;
let currentStepCount = 0;
let maxStepsForCurrentEnv = 0;
let invalidMoveTimeoutId = null; // For managing the invalid move message timer

let currentProgressInfo = null;
let IS_PRE_TASK = false;


// --- Initialization and Flow Control ---

async function initializeDemonstrationTask() {
    // Read the task type from the URL
    const urlParams = new URLSearchParams(window.location.search);
    const taskType = urlParams.get('task');
    IS_PRE_TASK = (taskType === 'pre');

    await fetchAndCacheUIStrings();
    checkDeviceCompatibility();

    resetButton.classList.remove('btn-secondary');
    resetButton.classList.add('btn-primary');

    proceedButton.classList.remove('btn-primary');
    proceedButton.classList.add('btn-success');

    document.title = getUIString('title', 'demonstrations_page');

    showAppMessage('message-box', getUIString('loading_task', 'common'), "info");

    gameLoader.classList.remove('hidden');
    actualGameContent.classList.add('hidden');

    try {
        const statusResponse = await fetch(`${FLASK_SERVER_URL}/api/check-form-status`, { credentials: 'include' });
        const statusData = await statusResponse.json();


        if (statusData.instruction_group) {
            USER_GROUP = statusData.instruction_group;
        }

        if (!statusResponse.ok || !statusData.form_completed) {
            window.location.href = 'index.html';
            return;
        }

        const setupResponse = await fetch(`${FLASK_SERVER_URL}/api/demonstration-setup`, { credentials: 'include' });

        if (!setupResponse.ok) {
             const errorData = await setupResponse.json().catch(() => ({ error: `Server error: ${setupResponse.status}` }));
            throw new Error(`Failed to load demonstration setup: ${errorData.error}`);
        }

        const setupData = await setupResponse.json();
        currentProgressInfo = setupData.progress_info; // Store the progress info
        // Call initially for the practice/first round
        updateProgressBar(currentProgressInfo, isPracticeMode ? null : 1, maxDemonstrationsInSequence);

        overallTaskCurrentNum = setupData.overall_task_current_num;
        overallTaskTotalNum = setupData.overall_task_total_num;
        taskSpecificTitle = setupData.task_title;
        practiceEnvironmentId = setupData.practice_environment_id;
        environmentSequence = setupData.environment_sequence || [];
        maxDemonstrationsInSequence = setupData.max_demonstrations || 0;
        IS_PRE_TASK = setupData.is_pre_task || false;

        const instructionTaskType = IS_PRE_TASK ? 'demonstrations_pre' : 'demonstrations';
        await fetchAndRenderStructuredInstructions(
            `/api/instructions?task=${instructionTaskType}`,
            'task-instructions-container',
            'message-box',
            'demonstrations',
            true
        );
        proceedButton.textContent = getUIString('button_start_task', 'common');

        if (practiceEnvironmentId) {
            await loadSpecificEnvironment(practiceEnvironmentId);
        } else {
            isPracticeMode = false;
            await startRealTasks();
        }
        
        gameLoader.classList.add('hidden');
        actualGameContent.classList.remove('hidden');

    } catch (error) {
        console.error("Error initializing demonstration task:", error);
        const errorMsg = getUIString('message_initial_load_error', 'demonstrations_page') + error.message;
        gameLoader.innerHTML = `<p class="text-red-500 text-center p-4">${errorMsg}. Try starting from <a href="index.html" class="underline">form</a>.</p>`;
    }
}

async function startRealTasks() {
    proceedButton.disabled = true;

    console.log('startRealTasks() called. Wiping all collected demonstrations.');
    isPracticeMode = false;
    currentDemonstrationIndex = 0;
    allCollectedDemonstrations = [];

    taskTitleElement.textContent = getUIString('title', 'demonstrations_page');
    proceedButton.classList.remove('hidden');

    if (environmentSequence.length === 0) {
        showAppMessage('message-box', getUIString('message_no_real_tasks', 'demonstrations_page'), "info");
        proceedButton.classList.remove('hidden');
        proceedButton.disabled = true;
        resetButton.classList.remove('hidden');
        resetButton.disabled = true;
    } else {
        await loadSpecificEnvironment(environmentSequence[currentDemonstrationIndex]);
    }
}

async function loadSpecificEnvironment(envId) {
    currentEnvironmentId = envId;
    currentUserTrajectory = [];
    isInputDisabled = false;
    currentStepCount = 0;

    // Update the per-round progress display
    updateProgressBar(currentProgressInfo, isPracticeMode ? null : currentDemonstrationIndex + 1, maxDemonstrationsInSequence);

    const taskTitleParts = taskSpecificTitle.split(':');
    if (taskTitleParts.length > 1) {
        taskSpecificTitle = taskTitleParts.slice(1).join(':').trim();
    } else {
        taskSpecificTitle = taskTitleParts[0].trim();
    }

    const miniGameText = getUIString('task_title_template', 'common').replace('{current}', overallTaskCurrentNum).replace('{total}', overallTaskTotalNum);
    let roundText = '';
    if (isPracticeMode) {
        roundText = ` (${getUIString('progress_practice_notice', 'common')})`;
    } else if (maxDemonstrationsInSequence > 0) {
        const roundInfo = getUIString('progress_round_template', 'common')
            .replace('{current}', currentDemonstrationIndex + 1)
            .replace('{total}', maxDemonstrationsInSequence);
        roundText = ` (${roundInfo})`;
    }
    taskTitleElement.textContent = miniGameText + roundText;



    // --- Set initial button states for the environment ---
    resetButton.disabled = true;
    resetButton.classList.remove('hidden');

    proceedButton.classList.remove('hidden');
    proceedButton.disabled = true;

    if (isPracticeMode) {
        proceedButton.textContent = getUIString('button_end_practice', 'common');
    } else {
        const isLastDemo = (currentDemonstrationIndex + 1) >= maxDemonstrationsInSequence;
        proceedButton.textContent = isLastDemo
            ? getUIString('button_finish_and_submit', 'common')
            : getUIString('button_next_map', 'common');
    }

    updateTaskStatusBar({
        containerId: 'task-status-bar-container',
        taskName: getUIString('task_name', 'demonstrations_page'),
        isPractice: isPracticeMode,
        currentNum: currentDemonstrationIndex + 1,
        maxNum: maxDemonstrationsInSequence
    });

    if (isPracticeMode) {
        displayPracticeBanner('practice-banner-container');
    } else {
        const banner = document.getElementById('practice-banner');
        if (banner) {
            banner.remove();
        }
    }

    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/environment/${envId}`, {credentials: 'include'});
        const envData = await response.json();

        GRID_ROWS = envData.grid_rows; GRID_COLS = envData.grid_cols;
        START_STATE = envData.start_state; GOAL_STATE = envData.goal_state;
        CLIFF_STATES = envData.cliff_states || [];
        agentCurrentPos = [...START_STATE];

        const totalCells = GRID_ROWS * GRID_COLS;
        maxStepsForCurrentEnv = Math.floor(0.75 * totalCells);

        const cellSize = Math.min(70, Math.max(35, Math.floor((gridContainer.parentElement.offsetWidth || 800) * 0.95 / GRID_COLS)));
        drawGrid(gridContainer, envData, { cellSize });

        // Add a click listener to the start cell to allow resetting the attempt.
        const startCell = document.getElementById(`cell-${START_STATE[0]}-${START_STATE[1]}`);
        if (startCell) {
            startCell.style.cursor = 'pointer'; // Provide a visual cue that it's clickable
            startCell.addEventListener('click', () => {
                // Only trigger a reset if the reset button is currently enabled.
                if (!resetButton.disabled) {
                    resetButton.click();
                }
            });
        }

        resetVisualsAndAgent(false);
        showAppMessage('message-box', getUIString('message_use_arrow_keys', 'common'), "info");
    } catch (error) {
        showAppMessage('message-box', `${getUIString('error_loading_environment', 'common')} ${envId}: ${error.message}.`, "error");
    }
}

function checkPostMoveState(newPos) {
    const [row, col] = newPos;
    if (CLIFF_STATES.some(cliff => cliff[0] === row && cliff[1] === col)) {
        showAppMessage('message-box', getUIString('message_cliff_fall', 'demonstrations_page'), "muted");
        showAppMessage('message-box', getUIString('message_cliff_fall', 'demonstrations_page'), "error");
        const fallenCliffCell = document.getElementById(`cell-${row}-${col}`);
        if (fallenCliffCell) fallenCliffCell.classList.add('cliff-fallen');
        if (agentElement) agentElement.remove(); agentElement = null;
        proceedButton.disabled = true;
        resetButton.disabled = false; // Keep reset enabled
        moveUpButton.disabled = true;
        moveDownButton.disabled = true;
        moveLeftButton.disabled = true;
        moveRightButton.disabled = true;
        isInputDisabled = true;
        resetButton.textContent = getUIString('button_reset_try_again', 'demonstrations_page');
        resetButton.classList.remove('btn-primary');
        resetButton.classList.add('btn-danger');
    } else if (GOAL_STATE && row === GOAL_STATE[0] && col === GOAL_STATE[1]) {
        showAppMessage('message-box', getUIString('message_goal_reached', 'demonstrations_page'), "success");
        isInputDisabled = true;
        moveUpButton.disabled = true;
        moveDownButton.disabled = true;
        moveLeftButton.disabled = true;
        moveRightButton.disabled = true;
        proceedButton.disabled = false; // Enable the single proceed button
    }
}

// Sends the current trajectory to the server every time before it proceeds to the next demonstration.
async function proceedToNextDemonstration() {
    proceedButton.disabled = true;
    resetButton.disabled = true;
    if (!isPracticeMode) {
        const finalTrajectory = [...currentUserTrajectory, agentCurrentPos];
        const demonstrationData = {
            env_id: currentEnvironmentId,
            trajectory: finalTrajectory,
            outcome: 'goal_reached'
        };

        // Submit this single demonstration
        try {
            const response = await fetch(`${FLASK_SERVER_URL}/api/submit-demonstrations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: [demonstrationData],
                    is_pre_task: IS_PRE_TASK
                }), // API expects a list
                credentials: 'include'
            });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error || 'Failed to submit demonstration');
            }
        } catch (error) {
            showAppMessage('message-box', getUIString('error_saving_progress', 'demonstrations_page') + error.message, "muted");
            showAppMessage('message-box', getUIString('error_saving_progress', 'demonstrations_page') + error.message, "error");
            return; // Stop the user from proceeding on failure
        }
    }

    currentDemonstrationIndex++;
    await loadSpecificEnvironment(environmentSequence[currentDemonstrationIndex]);
}

// Sends only the last demonstration data when the user finishes the task.
async function finishTaskAndSubmit() {
    proceedButton.disabled = true;
    if (!isPracticeMode) {
        showAppMessage('message-box', getUIString('message_finalizing_demos', 'demonstrations_page'), "muted");
        proceedButton.disabled = true;
        resetButton.disabled = true;

        const finalTrajectory = [...currentUserTrajectory, agentCurrentPos];
        const lastDemonstrationData = {
            env_id: currentEnvironmentId,
            trajectory: finalTrajectory,
            outcome: 'goal_reached_finish'
        };

        try {
            const response = await fetch(`${FLASK_SERVER_URL}/api/submit-demonstrations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: [lastDemonstrationData],
                    is_pre_task: IS_PRE_TASK
                }), // API expects a list
                credentials: 'include'
            });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.error);
            }
        } catch (error) {
            showAppMessage('message-box', `${getUIString('error_submitting_demos', 'demonstrations_page')} ${error.message}`, "muted");
            showAppMessage('message-box', `${getUIString('error_submitting_demos', 'demonstrations_page')} ${error.message}`, "error");
            proceedButton.disabled = false;
            return;
        }
    }
    await navigateToNextTask('message-box');
}

// --- Graphics and Input Handling ---

function clearAllPathHighlights() {
    gridContainer.querySelectorAll('.grid-cell.path-cell, .grid-cell.cliff-fallen, .grid-cell.current-pos-highlight').forEach(c => {
        c.classList.remove('path-cell', 'cliff-fallen', 'current-pos-highlight');
    });
}

function resetVisualsAndAgent(isUserTriggered) {
    resetButton.disabled = true;

    if (agentElement) agentElement.remove();
    agentElement = null;

    clearAllPathHighlights();

        // I think this is the best place to put this logic
    resetButton.classList.remove('btn-danger');
    resetButton.classList.add('btn-primary');

    moveUpButton.disabled = false;
    moveDownButton.disabled = false;
    moveLeftButton.disabled = false;
    moveRightButton.disabled = false;

    if (isUserTriggered) {
        currentUserTrajectory = [];
        currentStepCount = 0;
        showAppMessage('message-box', getUIString('message_attempt_reset', 'demonstrations_page'), "info");
    }
    if (START_STATE) {
        agentCurrentPos = [...START_STATE];
        agentElement = animateAgentMove(agentElement, null, agentCurrentPos, { goalState: GOAL_STATE });
    }
    isInputDisabled = false;
    resetButton.textContent = getUIString('button_reset_attempt', 'demonstrations_page');
    resetButton.disabled = true;
    proceedButton.disabled = true;

    updateValidMoveHighlights();
    updateArrowButtonStates(); 
}

function handleManualMove(targetRow, targetCol) {
    if (isInputDisabled) return;

    const isMovingToCliff = CLIFF_STATES.some(cliff => cliff[0] === targetRow && cliff[1] === targetCol);
    if (isMovingToCliff) {
        // Show an error message but do not move the agent.
        showAppMessage('message-box', getUIString('message_invalid_move', 'demonstrations_page'), 'error');
        return; // Exit the function immediately.
    }


    const [cr, cc] = agentCurrentPos;
    const isAdjacent = ((Math.abs(targetRow - cr) === 1 && targetCol === cc) || (Math.abs(targetCol - cc) === 1 && targetRow === cr));

    if (!isAdjacent) {
        return; // Ignore non-adjacent clicks
    }

    // --- A valid move is made from here ---

    // Show the reset button on the first valid move
    if (resetButton.disabled) {
        resetButton.disabled = false;
    }

    currentStepCount++;
    const oldPos = [...agentCurrentPos];
    currentUserTrajectory.push([...oldPos]);

    agentCurrentPos = [targetRow, targetCol];
    agentElement = animateAgentMove(agentElement, oldPos, agentCurrentPos, { goalState: GOAL_STATE });

    if (maxStepsForCurrentEnv > 0 && currentStepCount >= maxStepsForCurrentEnv) {
        isInputDisabled = true;
        showAppMessage('message-box', getUIString('message_step_limit_reached', 'demonstrations_page'), "muted");
        showAppMessage('message-box', getUIString('message_step_limit_reached', 'demonstrations_page'), "error");
        resetButton.textContent = getUIString('button_reset_try_again', 'demonstrations_page');
        resetButton.classList.remove('btn-primary');
        resetButton.classList.add('btn-danger');
    } else {
        checkPostMoveState(agentCurrentPos);
    }

    updateValidMoveHighlights();
    updateArrowButtonStates(); 
}

function handleKeyPress(event) {
    // --- Handle Backspace to click the reset button ---
    if (event.key === 'Backspace') {
        // Only trigger a reset if the reset button is currently enabled.
        if (!resetButton.disabled) {
            event.preventDefault(); // Prevent the browser from navigating back.
            resetButton.click();
        }
        // After handling Backspace, we are done.
        return;
    }

    // --- Handle Enter to click a VISIBLE and ENABLED progression button ---
    if (event.key === 'Enter') {
        event.preventDefault();

        if (proceedButton && !proceedButton.disabled && !proceedButton.classList.contains('hidden')) {
            proceedButton.click();
        }
        return;
    }

    // --- Handle Arrow Keys for agent movement ---
    // If input is disabled (e.g., goal reached), do not process movement.
    if (isInputDisabled) return;

    let [row, col] = agentCurrentPos;
    switch (event.key) {
        case "ArrowUp":    row--; break;
        case "ArrowDown":  row++; break;
        case "ArrowLeft":  col--; break;
        case "ArrowRight": col++; break;
        default: return; // Ignore any other keys.
    }
    event.preventDefault(); // Prevent window scrolling from arrow keys.

    // Check for out-of-bounds moves.
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        return;
    }
    handleManualMove(row, col);
}

function handleArrowButtonClick(direction) {
    if (isInputDisabled) return;
    let [row, col] = agentCurrentPos;

    switch (direction) {
        case 'up':    row--; break;
        case 'down':  row++; break;
        case 'left':  col--; break;
        case 'right': col++; break;
        default: return;
    }

    // The "out of bounds" check from handleKeyPress
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
        return;
    }
    handleManualMove(row, col);
}


function updateValidMoveHighlights() {
    // First, clear any cells that are currently highlighted
    gridContainer.querySelectorAll('.correction-target-cell').forEach(cell => {
        cell.classList.remove('correction-target-cell');
    });

    // If input is disabled (because the goal or a cliff was reached), do not show any new highlights
    if (isInputDisabled) {
        return;
    }

    // Get the agent's current position and create a set of coordinates for the existing path
    const [row, col] = agentCurrentPos;
    const trajectoryCells = new Set(currentUserTrajectory.map(pos => pos.join(',')));

    // Define the four potential neighboring cells
    const neighbors = [
        { r: row - 1, c: col }, // Up
        { r: row + 1, c: col }, // Down
        { r: row,     c: col - 1 }, // Left
        { r: row,     c: col + 1 }  // Right
    ];

    // Check each neighbor to see if it should be highlighted
    neighbors.forEach(neighbor => {
        const { r, c } = neighbor;

        // Condition 1: Check if the neighbor is out of the grid bounds
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) {
            return;
        }

        // Condition 2: Check if the neighbor is a cliff
        const isCliff = CLIFF_STATES.some(cliff => cliff[0] === r && cliff[1] === c);
        if (isCliff) {
            return;
        }

        // Condition 3: Check if the neighbor is already part of the user's path
        const isOnPath = trajectoryCells.has(`${r},${c}`);
        if (isOnPath) {
            return;
        }

        // If all conditions pass, highlight the cell
        const targetCell = document.getElementById(`cell-${r}-${c}`);
        if (targetCell) {
            targetCell.classList.add('correction-target-cell');
        }
    });
}

// --- Event Listeners ---
resetButton.addEventListener('click', () => resetVisualsAndAgent(true));
gridContainer.addEventListener('click', (event) => {
    const clickedCell = event.target.closest('.grid-cell');
    if (!clickedCell) return;
    handleManualMove(parseInt(clickedCell.dataset.row), parseInt(clickedCell.dataset.col));
});

moveUpButton.addEventListener('click', () => handleArrowButtonClick('up'));
moveDownButton.addEventListener('click', () => handleArrowButtonClick('down'));
moveLeftButton.addEventListener('click', () => handleArrowButtonClick('left'));
moveRightButton.addEventListener('click', () => handleArrowButtonClick('right'));

document.addEventListener('keydown', handleKeyPress);

proceedButton.addEventListener('click', () => {
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
    if (isPracticeMode) {
        startRealTasks();
    } else {
        const isLastDemo = (currentDemonstrationIndex + 1) >= maxDemonstrationsInSequence;
        if (isLastDemo) {
            finishTaskAndSubmit();
        } else {
            proceedToNextDemonstration();
        }
    }
});



function updateArrowButtonStates() {
    if (isInputDisabled) {
        // If all input is disabled (e.g., goal reached), disable all buttons.
        moveUpButton.disabled = true;
        moveDownButton.disabled = true;
        moveLeftButton.disabled = true;
        moveRightButton.disabled = true;
        return;
    }

    const [row, col] = agentCurrentPos;

    // A small helper to check if a potential move is invalid (off the grid or into a cliff).
    const isInvalidMove = (r, c) => {
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) {
            return true; // The move is off the grid.
        }
        // The move is into a cliff.
        return CLIFF_STATES.some(cliff => cliff[0] === r && cliff[1] === c);
    };

    // Disable each button if its corresponding move is invalid.
    moveUpButton.disabled = isInvalidMove(row - 1, col);
    moveDownButton.disabled = isInvalidMove(row + 1, col);
    moveLeftButton.disabled = isInvalidMove(row, col - 1);
    moveRightButton.disabled = isInvalidMove(row, col + 1);
}

// --- Initial Load ---
initializeDemonstrationTask();