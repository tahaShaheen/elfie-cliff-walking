// static/js/failed_check.js

/**
 * Populates the "debrief" section with an explanation.
 */
function showFailureDebrief() {
    const titleEl = document.getElementById('debrief-title');
    const mainGoalEl = document.getElementById('debrief-main-goal');
    const loginNoticeEl = document.getElementById('debrief-login-notice');


    if (!titleEl || !mainGoalEl || !loginNoticeEl) return;

    // Hardcoded text for the failure page
    const titleText = "Why This Check Was Required";
    const mainGoalText = "This check is crucial for our study's data quality. It ensures participants fully understand the instructions, which is essential for our research to be valid. We appreciate your participation.";
    const loginNoticeText = "Please note: To maintain data integrity, this user ID cannot be used to re-enter the study.";

    titleEl.textContent = titleText;
    mainGoalEl.textContent = mainGoalText;
    loginNoticeEl.textContent = loginNoticeText;
}


/**
 * Clears the user's session data on the server.
 */
function clearServerSession() {
    fetch(`${FLASK_SERVER_URL}/api/end-session`, {
        method: 'POST',
        credentials: 'include' 
    })
    .then(response => response.json())
    .then(data => {
        console.log('Session clear confirmation:', data.message);
    })
    .catch(error => {
        console.error('Error attempting to clear session:', error);
    });
}

/**
 * Initializes the page.
 */
function initializePage() {
    // 1. Show the informational message
    showFailureDebrief();
    
    // 2. Clear the server-side session
    clearServerSession();

    // 3. Prevent the user from navigating back
    history.pushState(null, null, location.href);
    window.onpopstate = function () {
        history.go(1);
    };
}

document.addEventListener('DOMContentLoaded', initializePage);