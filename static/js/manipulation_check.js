// static/js/manipulation_check.js

// --- DOM Elements ---
const pageLoader = document.getElementById('instructions-loader');
const contentWrapper = document.getElementById('instructions-content-wrapper');
const submitButton = document.getElementById('proceedToTaskButton');
const form = document.getElementById('instructions-form');

// --- State & Config ---
let CORRECT_ANSWERS = {};
let CRITICAL_QUESTIONS = [];
let TOTAL_QUESTIONS = 0;
const MAX_ATTEMPTS = 3;
let attemptsMade = 0;


// Keep a counter for each question to track errors
let errorCounters = {}; // It will be initialized dynamically.

/**
 * Checks if all radio groups have a selection and updates the button state.
 */
function updateButtonState() {
    const selectedCount = form.querySelectorAll('input[type="radio"]:checked').length;

    if (selectedCount === TOTAL_QUESTIONS) {
        submitButton.disabled = false;
        submitButton.textContent = "Continue onto the mini-games";
    } else {
        submitButton.disabled = true;
        submitButton.textContent = "Please select all answers";
    }
}``

/**
 * Collects the current answers and error counts and saves them to the database.
 */
async function saveCurrentAttempt() {
    showAppMessage('message-box', "Saving...", "muted");

    const formData = new FormData(form);
    const userResponses = {};
    for (const [key, value] of formData.entries()) {
        userResponses[key] = value;
    }

    // Combine error counts and current responses into a single payload
    const submissionPayload = {
        errors: errorCounters,
        responses: userResponses
    };
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/submit-manipulation-check-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(submissionPayload),
            credentials: 'include'
        });

        if (!response.ok) {
            console.error("Failed to save manipulation check data.");
        }
    } catch (error) {
        console.error("Error submitting manipulation check data:", error);
    }
}

/**
 * Checks answers on submission and handles success or failure.
 * This version only shows an error and penalizes the user if a CRITICAL question is wrong.
 */
async function handleSubmit(event) {
    event.preventDefault();

    const formData = new FormData(form);
    let criticalQuestionWrong = false; // We only need this one flag to make our decision.

    // This loop checks all questions to record errors for data analysis,
    // but it will only set the criticalQuestionWrong flag for important questions.
    for (const key in CORRECT_ANSWERS) {
        const selectedValueStr = formData.get(key);
        const selectedValue = parseInt(selectedValueStr, 10);
        const correctRange = CORRECT_ANSWERS[key];
        const isAnswerCorrect = selectedValueStr && selectedValue >= correctRange[0] && selectedValue <= correctRange[1];

        // This part ensures we log an error for ANY incorrect answer for our records.
        // This does NOT affect the user's progression.
        if (!isAnswerCorrect && errorCounters.hasOwnProperty(key)) {
            errorCounters[key]++;
        }

        // This is the key logic: Only check against the critical list to decide if we should stop the user.
        // If the question is on the critical list AND the answer is wrong, set the flag.
        if (CRITICAL_QUESTIONS.includes(key) && !isAnswerCorrect) {
            criticalQuestionWrong = true;
        }
    }

    // Always save the result of the current attempt, regardless of correctness.
    await saveCurrentAttempt();

    // The main decision logic is now based ONLY on the criticalQuestionWrong flag.
    if (criticalQuestionWrong) {
        // --- This block runs ONLY if a critical question was wrong ---

        // Apply the penalty since a critical error occurred.
        attemptsMade++;
        const attemptsRemaining = MAX_ATTEMPTS - attemptsMade;
        submitButton.disabled = true;

        if (attemptsRemaining > 0) {
            const errorDuration = 7000;
            submitButton.textContent = "Please Try Again";
            const attemptText = attemptsRemaining === 1 ? "1 attempt" : `${attemptsRemaining} attempts`;
            const message = `You have misunderstood some of the instructions. You have **${attemptText} remaining**. Please review the 'Remember!' box and correct your answers.`;
            showAppMessage('message-box', message, "error", errorDuration);

            setTimeout(() => {
                showAppMessage('message-box', "Please review the 'Remember!' box and try again.", "info");
            }, errorDuration);
        } else {
            // Logic for final failure after too many attempts.
            submitButton.textContent = "Unable to Continue";
            showAppMessage(
                'message-box',
                "Sorry, you have not passed the comprehension check. Saving result...",
                "error",
                10000
            );
            
            errorCounters.failed_manipulation_check = true;
            await saveCurrentAttempt(); // Save one last time to include the failure flag
            
            // Redirect to the failure page
            window.location.href = '/failed_check.html';
        }

        // Trigger the glow effect on the "Remember!" box.
        const rememberBox = document.getElementById('remember-box-for-glow');
        if (rememberBox) {
            rememberBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
            rememberBox.style.boxShadow = '0 0 15px 3px rgba(239, 68, 68, 0.6)';
            rememberBox.style.transition = 'box-shadow 0.3s';
            setTimeout(() => {
                rememberBox.style.boxShadow = '';
            }, 7000);
        }
    } else {
        // --- This block runs if NO critical questions were wrong ---
        // The user proceeds to the next task, even if non-critical questions were incorrect.
        navigateToNextTask('message-box');
    }
}

/**
 * Initializes the page.
 */
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility();

    document.title = "Comprehension Check";
    submitButton.disabled = true;
    submitButton.textContent = "Please select all answers";

    showAppMessage('message-box', getUIString('loading_instructions', 'common'), "muted");

    try {
        // 1. Read the 'task' parameter from the page's URL.
        const urlParams = new URLSearchParams(window.location.search);
        const taskType = urlParams.get('task') || 'main'; // Default to 'main' for safety.
        const setupEndpoint = `${FLASK_SERVER_URL}/api/manipulation-check-setup?task=${taskType}`;

        // 2. Use the new dynamic endpoint for the fetch calls.
        const response = await fetch(setupEndpoint, { credentials: 'include' });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const data = await response.json();

        CORRECT_ANSWERS = data.correct_answers;
        CRITICAL_QUESTIONS = data.critical_questions || [];

        // Dynamically initialize errorCounters based ONLY on the questions
        // the backend sent for this specific check (pre or post).
        errorCounters = {};
        for (const key in CORRECT_ANSWERS) {
            errorCounters[key] = 0;
        }

        // Dynamically set the number of questions based on what the backend sent.
        // This will be 4 for "pre" and 2 for "post".
        TOTAL_QUESTIONS = Object.keys(data.correct_answers).length;

        await fetchAndRenderStructuredInstructions(
            `/api/manipulation-check-setup?task=${taskType}`, // Use it here as well
            'instructions-display-area',
            'message-box',
            'manipulation_check',
            false
        );


        const rememberBox = document.querySelector('.emphasis-box');
        if (rememberBox) {
            const rememberBoxWrapper = rememberBox.closest('.instruction-item');
            if (rememberBoxWrapper && rememberBoxWrapper.previousElementSibling) {
                const dividerWrapper = rememberBoxWrapper.previousElementSibling;
                // Check if the previous element is indeed the divider
                if (dividerWrapper.querySelector('hr')) {
                    dividerWrapper.remove();
                }
            }
        }

        // Set up event listeners
        form.addEventListener('change', updateButtonState);
        form.addEventListener('submit', handleSubmit); // Use 'submit' event on the form

        updateProgressBar(data.progress_info, null, null);
        pageLoader.classList.add('hidden');
        contentWrapper.classList.remove('hidden');

    } catch (error) {
        console.error("Error loading page:", error);
        showAppMessage('message-box', `Error: ${error.message}`);
    }
}

// Since the button is now part of the form, we handle its click via the form's 'submit' event.
// This replaces the old direct click listener on the button.
submitButton.addEventListener('click', (event) => {
    submitButton.disabled = true; // Prevent multiple clicks
    event.preventDefault(); // Prevent default button behavior
    form.requestSubmit(); // Programmatically trigger the form's submit event
});


initializePage();