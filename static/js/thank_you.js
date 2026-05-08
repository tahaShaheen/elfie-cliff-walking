// static/js/thank_you.js

let IS_PSYCH_USER = true;

// --- DOM Element References ---
const mainMessageEl = document.getElementById('main-message');
const elfieMessageEl = document.getElementById('elfie-message');
const completionMessageEl = document.getElementById('completion-message');
const giftCardMessageEl = document.getElementById('gift-card-message');
// const closingMessageEl = document.getElementById('closing-message');
const verificationStatusEl = document.getElementById('verification-status');
const resultsLoaderEl = document.getElementById('results-loader');
const finishButton = document.getElementById('finishButton');

let sonaId = null; // To store Sona ID if applicable

/**
 * Fetches and displays the personalized debriefing message with animations.
 */
async function showDebriefMessage() {
    const container = document.getElementById('debrief-container');
    const loader = document.getElementById('debrief-loader');
    const content = document.getElementById('debrief-content');
    const mainPageLoader = document.getElementById('results-loader'); // Get main loader

    if (!container || !loader || !content) return;

    // Show the container with its internal loading message
    container.classList.remove('hidden');

    try {
        // --- Success Case ---
        loader.classList.add('hidden');
        content.classList.remove('hidden');

        // Hide the main page loader right before the typewriter effect begins
        if (mainPageLoader) {
            mainPageLoader.classList.add('hidden');
        }

        // --- NEW: Get element references for the full debriefing form ---
        const formTitleEl = document.getElementById('debrief-form-title');
        const formIntroEl = document.getElementById('debrief-form-intro');
        const section1TitleEl = document.getElementById('debrief-section-1-title');
        const section1ContentEl = document.getElementById('debrief-section-1-content');
        const section2TitleEl = document.getElementById('debrief-section-2-title');
        const section2ContentEl = document.getElementById('debrief-section-2-content');
        const section3TitleEl = document.getElementById('debrief-section-3-title');
        const section3ContentEl = document.getElementById('debrief-section-3-content');
        const section4TitleEl = document.getElementById('debrief-section-4-title');
        const section4ContentEl = document.getElementById('debrief-section-4-content');
        const keyFactsHeaderEl = document.getElementById('debrief-key-facts-header');

        // --- NEW: Type out the static debriefing form from ui_strings.yaml ---
        const typewriterSpeed = 10; // Speed for titles
        await typewriterEffect(formTitleEl, getUIString('debrief_form_title', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(formIntroEl, getUIString('debrief_form_intro', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section1TitleEl, getUIString('debrief_section_1_title', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section1ContentEl, getUIString('debrief_section_1_content', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section2TitleEl, getUIString('debrief_section_2_title', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section2ContentEl, getUIString('debrief_section_2_content', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section3TitleEl, getUIString('debrief_section_3_title', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section3ContentEl, getUIString('debrief_section_3_content', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section4TitleEl, getUIString('debrief_section_4_title', 'thank_you_page'), typewriterSpeed);
        await typewriterEffect(section4ContentEl, getUIString('debrief_section_4_content', 'thank_you_page'), typewriterSpeed);

        // --- EXISTING: Fetch and type out the personalized "Key Facts" ---
        const response = await fetch(`${FLASK_SERVER_URL}/api/debrief-info`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const data = await response.json();

        if (!data || !data.title) {
            throw new Error("Debrief data from server is empty or invalid.");
        }

        // Get element references and type out the message sequentially
        const titleEl = document.getElementById('debrief-title'); // This is now the "Key Facts" title
        const mainGoalEl = document.getElementById('debrief-main-goal');
        const userSpecificEl = document.getElementById('debrief-user-specific-info');
        const conditionSummaryEl = document.getElementById('debrief-condition-summary');
        const conclusionEl = document.getElementById('debrief-conclusion');
        
        // Populate the Key Facts section
        await typewriterEffect(keyFactsHeaderEl, getUIString('debrief_key_facts_header', 'thank_you_page'), 30);
        // await typewriterEffect(titleEl, data.title, 30); // We can remove the old title if desired
        await typewriterEffect(mainGoalEl, data.main_goal);
        await typewriterEffect(userSpecificEl, data.user_specific_info);
        await typewriterEffect(conditionSummaryEl, data.condition_summary);
        await typewriterEffect(conclusionEl, data.conclusion);

    } catch (error) {
        console.error("Could not display debrief message:", error.message);
        
        // Also hide the main loader in case of an error
        if (mainPageLoader) {
            mainPageLoader.classList.add('hidden');
        }
        
        loader.innerHTML = '<p>Debriefing information could not be loaded at this time.</p>';
        loader.classList.add('error-state');
        content.classList.add('hidden');
    }
}

/**
 * Checks with the backend to ensure all required trial data was submitted.
 * Updates the UI with the verification status.
 */
async function verifySubmissions() {
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/verify-submission-counts`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Server returned status: ${response.status}`);
        }

        const result = await response.json();
        IS_PSYCH_USER = result.is_psych_user || false;
        const sonaId = result.sona_id;

        updateProgressBar(result.progress_info, null, null);

        if (result.status === 'success') {
            verificationStatusEl.textContent = 'Verification successful: You completed all mini-games.';
            verificationStatusEl.className = 'text-md my-4 p-3 rounded-lg bg-green-100 border border-green-200 text-green-800';
            return [true, sonaId];
        } else {
            mainMessageEl.textContent = "Thank You!";
            mainMessageEl.className = "text-3xl font-bold mb-2 text-green-600";
            verificationStatusEl.innerHTML = `
                <p class="font-bold">It looks like you did not go through the entire experiment.</p>
                <p class="mt-2">Please contact the researchers and provide them with your User ID.</p>
            `;
            verificationStatusEl.className = 'text-md my-4 p-3 rounded-lg bg-red-100 border border-red-200 text-red-800';
            return [false, null];
        }
    } catch (error) {
        console.error('Error during submission verification:', error);
        verificationStatusEl.textContent = 'Could not verify submission status. Please contact the researchers and provide them with your User ID.';
        verificationStatusEl.className = 'text-md my-4 p-3 rounded-lg bg-yellow-100 border border-yellow-200 text-yellow-800';
    }
    return [false, null];
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

async function markExperimentAsCompleted() {
    // Mark the experiment as completed in the backend
    try {
        await fetch(`${FLASK_SERVER_URL}/api/mark-completion`, {
            method: 'POST',
            credentials: 'include'
        });
        console.log("Successfully marked experiment as completed.");
    } catch (error) {
        console.error("Could not mark experiment as completed:", error);
    }
}

async function initializePage() {
    // 1. Fetch UI strings first, as they are needed for all subsequent text.
    await fetchAndCacheUIStrings();

    // 2. Now that strings are available, update the page title.
    document.title = getUIString('title', 'thank_you_page', 'Experiment Complete');
    
    // // 3. Run the two long async operations in parallel and wait for both to complete.
    // await Promise.all([
    //     verifySubmissions(),
    //     showDebriefMessage(), // This function now handles hiding the loader
    //     markExperimentAsCompleted()
    // ]);

    const [[isVerified, receivedSonaId]] = await Promise.all([
        verifySubmissions(),
        // showDebriefMessage() // Removed bevause it just shows up even for test_ users
    ]);

    sonaId = receivedSonaId; // Store the received Sona ID if any

    // 4. Conditionally mark completion based on the verification result.
    if (isVerified) {
        await markExperimentAsCompleted();

        // 5. Only show payment/gift card info if verification was successful.
        // if (!IS_PSYCH_USER) {
        //     giftCardMessageEl.textContent = getUIString('message_gift_card_info', 'thank_you_page', 'Default payment info text.');
        //     giftCardMessageEl.classList.remove('hidden');
        // }
        giftCardMessageEl.innerHTML = `
            Participants in the actual study were compensated for their time.<br>
            Note: <strong>No user data was stored</strong> during this session.
        `;
        giftCardMessageEl.classList.remove('hidden');

        if (finishButton) {
            finishButton.classList.remove('hidden');
            finishButton.disabled = false;
            finishButton.addEventListener('click', () => {
                finishButton.disabled = true; 

                // To disable the navigation trap. Meaning the user can now navigate back if they want.
                window.onpopstate = null;

                if (IS_PSYCH_USER && sonaId) {
                    // For psych users, redirect to Sona URL (using example.com as requested).

                    // const redirectUrl = `https://example.com/sona_credit?survey_code=${sonaId}`; // for testing purposes
                    const redirectUrl = `https://asu.sona-systems.com/webstudy_credit.aspx?experiment_id=3117&credit_token=f5c2603617644739be6274996f574f8a&survey_code=${sonaId}`;
                    
                    window.location.href = redirectUrl;
                } else {
                    // For non-psych users, go to the simple closing page.
                    window.location.href = '/close_window.html';
                }
            });

        }
    }

    // // 5. With the user status now set, instantly show the gift card message if applicable.
    // if (!IS_PSYCH_USER) {
    //     giftCardMessageEl.textContent = getUIString('message_gift_card_info', 'thank_you_page', 'Default payment info text.');
    //     giftCardMessageEl.classList.remove('hidden');
    // }

    // 6. Populate the footer.
    const footer = document.getElementById('page-footer');
    if (footer) {
        const titleText = getUIString('footer_title', 'thank_you_page');
        const linksData = getUIString('footer_links', 'thank_you_page');
        const titleEl = document.createElement('h3');
        titleEl.className = 'text-sm font-semibold text-gray-500 mb-2';
        titleEl.textContent = titleText;
        footer.appendChild(titleEl);
        if (linksData && Array.isArray(linksData)) {
            const linksContainer = document.createElement('div');
            linksContainer.className = 'flex justify-center items-center gap-4';
            linksData.forEach(linkInfo => {
                const linkEl = document.createElement('a');
                linkEl.href = linkInfo.href;
                linkEl.textContent = linkInfo.text;
                linkEl.className = 'text-xs text-gray-400 hover:underline';
                linkEl.target = '_blank';
                linksContainer.appendChild(linkEl);
            });
            footer.appendChild(linksContainer);
        }
    }

    // 7. All content is loaded. Clear the server session.
    clearServerSession();

    // 8. Finally, reveal the "You may now close this window" message.
    // await typewriterEffect(closingMessageEl, getUIString('message_can_close', 'thank_you_page', 'You may now close this window.'), 15);
    // closingMessageEl.classList.remove('hidden');

    // 9. Prevent the user from navigating back to a previous task.
    history.pushState(null, null, location.href);
    window.onpopstate = function () {
        history.go(1);
    };
}

// --- Initial Load ---
// The 'DOMContentLoaded' event ensures that the initializePage function runs
// only after the entire HTML document has been loaded and parsed.
document.addEventListener('DOMContentLoaded', initializePage);