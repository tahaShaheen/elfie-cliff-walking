// --- DOM Elements ---
const instructionsLoader = document.getElementById('instructions-loader');
const loaderTextElement = document.getElementById('loader-text');
const instructionsContentWrapper = document.getElementById('instructions-content-wrapper');
const instructionsDisplayArea = document.getElementById('instructions-display-area');
const proceedToTaskButton = document.getElementById('proceedToTaskButton');

// --- Functions ---

async function initializePage() {
    await fetchAndCacheUIStrings();

    checkDeviceCompatibility(); // Ensure the device is compatible before proceeding

    const urlParams = new URLSearchParams(window.location.search);
    const taskType = urlParams.get('task');

    if (taskType) {
        // For task-specific pages (e.g., instructions.html?task=demonstrations),
        // use a general title.
        document.title = getUIString('instructions_title', 'common');
    } else {
        // For the main instructions page, use the specific "How Close Were You" title.
        document.title = getUIString('title', 'instructions_page');
    }
    if (loaderTextElement) loaderTextElement.textContent = getUIString('loading_instructions', 'common');

    await checkAccessAndLoadInstructions();
}

async function checkAccessAndLoadInstructions() {
    showAppMessage('message-box', getUIString('message_verifying_access', 'instructions_page'), "muted");
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/check-form-status`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);

        const data = await response.json();

        if (data.instruction_group) {
            USER_GROUP = data.instruction_group;
        }


        if (data.form_completed === true) {
            const urlParams = new URLSearchParams(window.location.search);
            const taskType = urlParams.get('task');

            let endpoint = `/api/instructions`;
            if (taskType) {
                endpoint += `?task=${taskType}`;
            }

            // The fetchAndRenderStructuredInstructions function needs to be awaited
            // and its response data captured to get the progress info.
            const instructionData = await fetchAndRenderStructuredInstructions(
                endpoint,
                'instructions-display-area',
                'message-box',
                taskType,
                false
            );

            // Set the proceed button text based on the current and next task
            if (proceedToTaskButton) {
                const nextTask = instructionData ? instructionData.next_task_url : '';

                if (taskType === 'demonstrations_pre') {
                    proceedToTaskButton.textContent = "Let's play the first mini-game";
                } else if (nextTask.includes('manipulation_check.html')) {
                    proceedToTaskButton.textContent = "Continue to Comprehension Check ";
                } else if (taskType) { // For other task pages like comparisons, corrections, etc.
                    proceedToTaskButton.textContent = "Proceed to Mini-Game";
                } else { // Fallback for the main instructions page
                    proceedToTaskButton.textContent = "Continue";
                }

                // Enable the button now that the content is loaded and text is set
                proceedToTaskButton.disabled = false;
            }

            // Now call the progress functions with the correct data
            if (instructionData) {
                updateProgressBar(instructionData.progress_info, null, null);
            }
            instructionsLoader.classList.add('hidden');
            instructionsContentWrapper.classList.remove('hidden');
        } else {
            showAppMessage('message-box', getUIString('message_form_not_completed', 'instructions_page'), "error");
            setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        }
    } catch (error) {
        console.error("Error during access check or loading instructions:", error);
        instructionsLoader.classList.remove('hidden');
        instructionsLoader.innerHTML = `<p class="text-red-500 text-center">${getUIString('error_message_default', 'common')} Details: ${error.message}. Try starting from the <a href="index.html" class="underline">form page</a>.</p>`;
        instructionsContentWrapper.classList.add('hidden');
        showAppMessage('message-box', `Error: ${error.message}`, "error");
    }
}

// --- Event Listeners ---
proceedToTaskButton.addEventListener('click', async () => {
    proceedToTaskButton.disabled = true;
    await navigateToNextTask('message-box');
    proceedToTaskButton.disabled = false;
});

// --- Initial Load ---
initializePage();