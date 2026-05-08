// --- DOM Elements ---
const taskLoader = document.getElementById('task-loader');
const loaderTextElement = document.getElementById('loader-text');
const taskTitleElement = document.getElementById('page-title');
const actualTaskContent = document.getElementById('actual-game-content');
const comparisonInstructionsContainer = document.getElementById('comparison-instructions-container');
const gridContainerA = document.getElementById('grid-container-a');
const gridContainerB = document.getElementById('grid-container-b');
const gridPairItemA = document.getElementById('grid-pair-item-a');
const gridPairItemB = document.getElementById('grid-pair-item-b');
const labelTrajA = document.getElementById('label-traj-a');
const labelTrajB = document.getElementById('label-traj-b');
const playButton = document.getElementById('playButton');
const startRealTaskButton = document.getElementById('startRealTaskButton');
const selectionActionButton = document.getElementById('selectionActionButton');

// --- State ---
let CELL_SIZE_PX_COMPARISON = 0;
let allComparisonScenarios = [];
let practiceScenario = null;
let isPracticeMode = false;
let currentComparisonIndex = 0;
let maxComparisons = 0;
let collectedComparisonChoices = [];
let currentSelection = null;
let isAnimating = false;
let hasPlayedCurrentComparison = false;
let GOAL_STATE_COMP = [];
let agentElementA = null, agentElementB = null;
let agentSpriteUrlDefault = '/static/imgs/elf_down.png';
let currentScenario = null;
let comparisonAnimationSpeed = 350;
let HOLE_PROXIMITY_WEIGHT = 1.0; // Weight for hole proximity in scoring

let overallTaskCurrentNum = 0;
let overallTaskTotalNum = 0;
let taskSpecificTitle = "";

let currentProgressInfo = null;




// --- Functions ---
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility(); // Ensure the device is compatible before proceeding

    document.title = getUIString('title', 'comparisons_page');
    taskTitleElement.textContent = getUIString('title', 'comparisons_page');
    loaderTextElement.textContent = getUIString('message_loading_scenarios', 'comparisons_page');
    labelTrajA.textContent = getUIString('label_trajectory_a', 'comparisons_page');
    labelTrajB.textContent = getUIString('label_trajectory_b', 'comparisons_page');
    playButton.textContent = getUIString('button_play_trajectories', 'comparisons_page');
    startRealTaskButton.textContent = getUIString('button_start_task', 'common');

    selectionActionButton.classList.remove('hidden');
    playButton.classList.remove('hidden');
    selectionActionButton.disabled = true;

    if (isPracticeMode) {
        selectionActionButton.textContent = getUIString('button_end_practice', 'common');
    } else if (currentComparisonIndex + 1 < maxComparisons) {
        selectionActionButton.textContent = getUIString('button_next_map', 'common');
    } else {
        selectionActionButton.textContent = getUIString('button_finish_and_submit', 'common');
    }
    playButton.disabled = false;

    await fetchAndRenderStructuredInstructions(
        `/api/instructions?task=comparisons`,
        'task-instructions-container',
        'message-box',
        'comparisons',
        true // This makes it collapsible
    );
    await initializeComparisonTask();
}

function renderComparisonPageInstructions() {
    if (!comparisonInstructionsContainer) return;
    comparisonInstructionsContainer.innerHTML = `
        <p class="font-semibold mb-1">${getUIString('instructions_title', 'comparisons_page')}</p>
        <p>${getUIString('instructions_line1', 'comparisons_page')}</p>
        <p>${getUIString('instructions_line2', 'comparisons_page')}</p> 
        <p>${getUIString('instructions_line3', 'comparisons_page')}</p>
    `;
}

async function initializeComparisonTask() {
    showAppMessage('message-box', getUIString('message_loading_scenarios', 'comparisons_page'), "muted");
    taskLoader.classList.remove('hidden');
    actualTaskContent.classList.add('hidden');
    playButton.disabled = true;

    try {
        const statusResponse = await fetch(`${FLASK_SERVER_URL}/api/check-form-status`, { credentials: 'include' });
        const statusData = await statusResponse.json();

        if (statusData.instruction_group) {
            USER_GROUP = statusData.instruction_group; // Store group globally from utils.js
        }

        if (!statusResponse.ok || !statusData.form_completed) {
            window.location.href = 'index.html';
            return;
        }

        const response = await fetch(`${FLASK_SERVER_URL}/api/comparison-setup`, { credentials: 'include' });
        const setupData = await response.json();

        currentProgressInfo = setupData.progress_info; // Store it
        updateProgressBar(currentProgressInfo, isPracticeMode ? null : 1, maxComparisons);

        overallTaskCurrentNum = setupData.overall_task_current_num;
        overallTaskTotalNum = setupData.overall_task_total_num;
        taskSpecificTitle = setupData.task_title;
        if (!response.ok) throw new Error(setupData.error || `Failed to load comparison scenarios`);

        practiceScenario = setupData.practice_scenario;
        allComparisonScenarios = setupData.comparison_scenarios || [];
        maxComparisons = setupData.max_comparisons || 0;
        comparisonAnimationSpeed = setupData.animation_speed || 350;

        // adjustContentScale();
        // window.addEventListener('resize', adjustContentScale);

        taskLoader.classList.add('hidden');
        actualTaskContent.classList.remove('hidden');

        if (practiceScenario) {
            isPracticeMode = true;
            await loadComparison(practiceScenario, true);
        } else {
            isPracticeMode = false;
            await startRealComparisonTasks();
        }
    } catch (error) {
        console.error("Error initializing comparison task:", error);
        showAppMessage('message-box', `${getUIString('message_init_error', 'comparisons_page')} ${error.message}`, "error");
        loaderTextElement.textContent = `Error: ${error.message}${getUIString('error_try_restarting', 'comparisons_page')}`;
    }
}

async function startRealComparisonTasks() {
    isPracticeMode = false;
    currentComparisonIndex = 0;
    collectedComparisonChoices = [];
    startRealTaskButton.classList.add('hidden');
    gridPairItemA.classList.remove('hidden');
    gridPairItemB.classList.remove('hidden');
    playButton.classList.remove('hidden');

    if (allComparisonScenarios.length === 0) {
        showAppMessage('message-box', getUIString('message_no_scenarios', 'comparisons_page'), "warn");
        await navigateToNextTask('message-box');
        return;
    }

    await loadComparison(allComparisonScenarios[0]);
}

async function loadComparison(scenario, isPractice = false) {
    currentScenario = scenario;
    currentSelection = null;
    hasPlayedCurrentComparison = false;
    playButton.disabled = true;
    updateProgressBar(currentProgressInfo, isPractice ? null : currentComparisonIndex + 1, maxComparisons);
    if (isPracticeMode) {
        selectionActionButton.textContent = getUIString('button_end_practice', 'common');
    } else if (currentComparisonIndex + 1 < maxComparisons) {
        selectionActionButton.textContent = getUIString('button_next_map', 'common');
    } else {
        selectionActionButton.textContent = getUIString('button_finish_and_submit', 'common');
    }

    // Remove the Task: in the title
    const taskTitleParts = taskSpecificTitle.split(':');
    if (taskTitleParts.length > 1) {
        taskSpecificTitle = taskTitleParts.slice(1).join(':').trim(); // Remove the "Task: " prefix
    } else {
        taskSpecificTitle = taskTitleParts[0].trim(); // Use the whole title if no prefix
    }
    // taskTitleElement.textContent = `Mini-Game ${overallTaskCurrentNum} of ${overallTaskTotalNum}: ${taskSpecificTitle}`;
    // taskTitleElement.textContent = getUIString('task_title_template', 'common').replace('{current}', overallTaskCurrentNum).replace('{total}', overallTaskTotalNum);

    const miniGameText = getUIString('task_title_template', 'common').replace('{current}', overallTaskCurrentNum).replace('{total}', overallTaskTotalNum);
    let roundText = '';
    if (isPracticeMode) {
        roundText = ` (${getUIString('progress_practice_notice', 'common')})`;
    } else if (maxComparisons > 0) {
        const roundInfo = getUIString('progress_round_template', 'common')
            .replace('{current}', currentComparisonIndex + 1)
            .replace('{total}', maxComparisons);
        roundText = ` (${roundInfo})`;
    }
    taskTitleElement.textContent = miniGameText + roundText;


    gridPairItemA.classList.remove('selected');
    gridPairItemB.classList.remove('selected');
    selectionActionButton.disabled = true;
    startRealTaskButton.classList.add('hidden');
    playButton.textContent = getUIString('button_play_trajectories', 'comparisons_page');

    // Replace the handlePracticeModeUI call with this
    updateTaskStatusBar({
        containerId: 'task-status-bar-container',
        taskName: getUIString('task_name', 'comparisons_page'),
        isPractice: isPractice,
        currentNum: currentComparisonIndex + 1,
        maxNum: maxComparisons,
    });

    if (isPracticeMode) {
        displayPracticeBanner('practice-banner-container');
    } else {
        const banner = document.getElementById('practice-banner');
        if (banner) {
            banner.remove();
        }
    }

    const envResponse = await fetch(`${FLASK_SERVER_URL}/api/environment/${scenario.env_id}`, { credentials: 'include' });
    if (!envResponse.ok) { showAppMessage('message-box', `${getUIString('error_loading_map', 'comparisons_page')}${scenario.env_id}`, "error"); return; }
    const envData = await envResponse.json();
    GOAL_STATE_COMP = envData.goal_state;

    // 1. Generate Trajectory A normally.
    scenario.trajectory_a = generateAndSelectBestPerturbation(
        scenario.policy_a, 
        scenario.policy_b, 
        envData, 
        scenario.epsilon, 
        HOLE_PROXIMITY_WEIGHT
    );

    // 2. Generate Trajectory B, but now pass trajectory_a as the final argument.
    // Its scoring will now also reward being different from trajectory_a.
    scenario.trajectory_b = generateAndSelectBestPerturbation(
        scenario.policy_b, 
        scenario.policy_a, 
        envData, 
        scenario.epsilon, 
        HOLE_PROXIMITY_WEIGHT,
        10, // candidateCount (default)
        scenario.trajectory_a // CRUCIAL ADDITION
    );

    const dynamicSizeOptions = {
        preferred: 55, min: 35, max: 70,
        container: gridPairItemA
    };
    CELL_SIZE_PX_COMPARISON = drawGrid(gridContainerA, envData, { cellIdPrefix: 'comp-cell-A', dynamicCellSize: dynamicSizeOptions });
    drawGrid(gridContainerB, envData, { cellIdPrefix: 'comp-cell-B', cellSize: CELL_SIZE_PX_COMPARISON });

    const agentStartPosA = scenario.trajectory_a.length > 0 ? [...scenario.trajectory_a[0]] : null;
    const agentStartPosB = scenario.trajectory_b.length > 0 ? [...scenario.trajectory_b[0]] : null;
    agentElementA = null; agentElementB = null;
    if (agentStartPosA) {
        agentElementA = updateAgentOnGrid(agentElementA, agentStartPosA, { cellIdPrefix: 'comp-cell-A', spriteUrl: agentSpriteUrlDefault });
    }
    if (agentStartPosB) {
        agentElementB = updateAgentOnGrid(agentElementB, agentStartPosB, { cellIdPrefix: 'comp-cell-B', spriteUrl: agentSpriteUrlDefault });
    }
    showAppMessage('message-box', getUIString('message_playback_prompt', 'comparisons_page'), "info");
    playButton.disabled = false;
}

async function animateTrajectory(gridElement, trajectoryStates, agentStartPos, agentSpriteRef, gridIdSuffix, speed = 300) {
    return new Promise(async (resolve) => {
        if (!trajectoryStates || trajectoryStates.length === 0) {
            resolve();
            return;
        }

        let currentPos = agentStartPos ? [...agentStartPos] : null;
        if (!currentPos) {
            resolve();
            return;
        }

        // Initial placement of the agent without an "old" position
        agentSpriteRef.element = animateAgentMove(agentSpriteRef.element, null, currentPos, {
            cellIdPrefix: `comp-cell-${gridIdSuffix}`,
            goalState: GOAL_STATE_COMP
        });

        for (let i = 1; i < trajectoryStates.length; i++) {
            const nextStep = trajectoryStates[i];
            const oldPos = [...currentPos];

            // This logic to skip non-moving steps remains here
            if (oldPos[0] === nextStep[0] && oldPos[1] === nextStep[1]) {
                await new Promise(r => setTimeout(r, speed / 2));
                continue;
            }

            // We now make a single call to our new central animation function.
            currentPos = [...nextStep];
            agentSpriteRef.element = animateAgentMove(agentSpriteRef.element, oldPos, currentPos, {
                cellIdPrefix: `comp-cell-${gridIdSuffix}`,
                goalState: GOAL_STATE_COMP
            });

            await new Promise(r => setTimeout(r, speed));
        }
        resolve();
    });
}

function handleSelection(selectedItem) {
    if (isAnimating) return;
    if (!hasPlayedCurrentComparison) {
        showAppMessage('message-box', getUIString('message_play_first', 'comparisons_page'), "error");
        return;
    }
    currentSelection = selectedItem;
    gridPairItemA.classList.toggle('selected', selectedItem === 'A');
    gridPairItemB.classList.toggle('selected', selectedItem === 'B');

    selectionActionButton.disabled = false;
    selectionActionButton.classList.remove('hidden', 'bg-gray-400', 'cursor-not-allowed', 'bg-green-500', 'hover:bg-green-600', 'bg-purple-500', 'hover:bg-purple-600');

    selectionActionButton.classList.add('btn-success'); // Use the standard success class
    showAppMessage('message-box', `${getUIString('message_selection_made', 'comparisons_page')} ${selectedItem}.`, "info");

    if (isPracticeMode) {
        selectionActionButton.textContent = getUIString('button_end_practice', 'common');
    } else if (currentComparisonIndex + 1 < maxComparisons) {
        selectionActionButton.textContent = getUIString('button_next_map', 'common');
    } else {
        selectionActionButton.textContent = getUIString('button_finish_and_submit', 'common');
    }
}

// --- Event Listeners ---
playButton.addEventListener('click', async () => {
    if (isAnimating) return;
    isAnimating = true; hasPlayedCurrentComparison = true;
    playButton.disabled = true;
    playButton.textContent = getUIString('button_playing_trajectories', 'comparisons_page');
    showAppMessage('message-box', getUIString('message_playing_trajectories', 'comparisons_page'), "muted");
    currentSelection = null;
    gridPairItemA.classList.remove('selected');
    gridPairItemB.classList.remove('selected');
    // selectionActionButton.classList.add('hidden');
    selectionActionButton.disabled = true;

    const envResponse = await fetch(`${FLASK_SERVER_URL}/api/environment/${currentScenario.env_id}`, { credentials: 'include' });
    if (!envResponse.ok) { isAnimating = false; playButton.disabled = false; return; }
    const envData = await envResponse.json();

    drawGrid(gridContainerA, envData, { cellIdPrefix: 'comp-cell-A', cellSize: CELL_SIZE_PX_COMPARISON });
    drawGrid(gridContainerB, envData, { cellIdPrefix: 'comp-cell-B', cellSize: CELL_SIZE_PX_COMPARISON });

    agentElementA = null; agentElementB = null;
    let agentRefA = { element: agentElementA }; let agentRefB = { element: agentElementB };

    const trajectoryA_states = currentScenario.trajectory_a || [];
    const trajectoryB_states = currentScenario.trajectory_b || [];
    const startA = trajectoryA_states.length > 0 ? trajectoryA_states[0] : envData.start_state;
    const startB = trajectoryB_states.length > 0 ? trajectoryB_states[0] : envData.start_state;

    try {
        await Promise.all([
            animateTrajectory(gridContainerA, trajectoryA_states, startA, agentRefA, 'A', comparisonAnimationSpeed),
            animateTrajectory(gridContainerB, trajectoryB_states, startB, agentRefB, 'B', comparisonAnimationSpeed)
        ]);
        agentElementA = agentRefA.element; agentElementB = agentRefB.element;

        selectionActionButton.textContent = getUIString('button_select_prompt', 'comparisons_page');
        showAppMessage('message-box', getUIString('message_playback_finished_select', 'comparisons_page'), "info");
    } catch (error) {
        showAppMessage('message-box', getUIString('message_playback_error', 'comparisons_page'), "error");
    } finally {
        isAnimating = false; playButton.disabled = false;
        playButton.textContent = getUIString('button_replay_trajectories', 'comparisons_page');

        selectionActionButton.disabled = false;
        selectionActionButton.disabled = true;
        selectionActionButton.classList.add('bg-gray-400', 'cursor-not-allowed');
    }
});

gridPairItemA.addEventListener('click', () => handleSelection('A'));
gridPairItemB.addEventListener('click', () => handleSelection('B'));
startRealTaskButton.addEventListener('click', startRealComparisonTasks);

document.addEventListener('keydown', (event) => {

    // Handle Spacebar to play/replay trajectories
    if (event.code === 'Space' && !playButton.disabled) {
        event.preventDefault(); // Prevent default browser action (e.g., scrolling)
        playButton.click();
        return; // Exit after handling
    }

    // Handle Enter to submit the selected choice
    if (event.key === 'Enter') {
        event.preventDefault();

        if (selectionActionButton.disabled) {
            showAppMessage('message-box', getUIString('message_select_first', 'comparisons_page'), "error");
            return;
        }

        else if (!selectionActionButton.disabled) {

            selectionActionButton.click();
            return; // Exit after handling
        }
    }

    if (isAnimating || actualTaskContent.classList.contains('hidden') || !hasPlayedCurrentComparison) return;
    let selectionMade = false;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        handleSelection('A');
        selectionMade = true;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        handleSelection('B');
        selectionMade = true;
    }
    if (selectionMade) event.preventDefault();
});

// Sends a single choice to the server when the selection action button is clicked.
selectionActionButton.addEventListener('click', async () => {
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
    selectionActionButton.disabled = true;
    playButton.disabled = true;

    if (!currentSelection) {
        showAppMessage('message-box', getUIString('message_select_first', 'comparisons_page'), "error");
        return;
    }
    if (isPracticeMode) {
        await startRealComparisonTasks();
        return;
    }

    const choiceData = {
        comparison_id: currentScenario.comparison_id,
        choice: currentSelection,
        trajectory_a: currentScenario.trajectory_a,
        trajectory_b: currentScenario.trajectory_b
    };
    showAppMessage('message-box', getUIString('message_saving_choice', 'comparisons_page'), "muted");

    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/submit-comparison-choices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([choiceData]), // API expects a list
            credentials: 'include'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || getUIString('error_server_status_code', 'comparisons_page') + response.status, "error");

        currentComparisonIndex++;

        if (currentComparisonIndex < maxComparisons) {
            await loadComparison(allComparisonScenarios[currentComparisonIndex]);
        } else {
            await navigateToNextTask('message-box');
        }
    } catch (error) {
        showAppMessage('message-box', `${getUIString('error_submission_failed', 'comparisons_page')} ${error.message}`, "error");
        selectionActionButton.disabled = false;
    }
});

// --- Initial Load ---
initializePage();