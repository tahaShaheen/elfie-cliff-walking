// --- DOM Elements ---
const gridContainer = document.getElementById('environment-grid');
const questionTextElement = document.getElementById('question-text');
const descriptionForm = document.getElementById('description-form');
const descriptionTextarea = document.getElementById('user-description');
const submitButton = document.getElementById('submit-description-button');
const pageTitleElement = document.getElementById('page-title');
let envId; // To store the environment ID for submission

/**
 * Initializes the page by fetching necessary UI strings, checking device compatibility,
 * and loading the question and environment data.
 */
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility();
    checkZoomAndShowPopup(); 

    // Use UI strings to populate all text elements
    document.title = getUIString('title', 'free_form_page');
    // Re-purposing a generic button text from another page
    submitButton.textContent = getUIString('submit_button', 'free_form_page');
    submitButton.classList.remove('btn-success');
    submitButton.classList.add('btn-primary');
    if (pageTitleElement) pageTitleElement.textContent = getUIString('page_header', 'free_form_page');
    if (descriptionTextarea) descriptionTextarea.placeholder = getUIString('textarea_placeholder', 'free_form_page');
    
    await loadQuestionAndEnvironment();
}

/**
 * Fetches the configuration for the free-form question page from the backend,
 * including the question text and the environment to display.
 */
async function loadQuestionAndEnvironment() {
    const mainContent = document.getElementById('main-content');
    showAppMessage('message-box', getUIString('loading_instructions', 'common'), "muted");
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/free-form-question-setup`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const config = await response.json();
        updateProgressBar(config.progress_info, null, null);

        if (config.user_group) {
            USER_GROUP = config.user_group; 
        }

        const instructionsContainer = document.getElementById('instructions-container');
        instructionsContainer.innerHTML = ''; // Clear existing content
        if (config.elements && Array.isArray(config.elements)) {
            config.elements.forEach(item => {
                const itemDiv = renderInstructionItem(item);
                if (itemDiv) {
                    instructionsContainer.appendChild(itemDiv);
                }
            });
        }

        // The old grid container is no longer used, so we remove it.
        const oldGrid = document.getElementById('environment-grid');
        if (oldGrid) oldGrid.remove();

        showAppMessage('message-box', getUIString('message_free_form_question_instructions', 'free_form_page'), "muted"); 
        if (mainContent) mainContent.classList.remove('hidden');

    } catch (error) {
        console.error("Error loading page:", error);
        showAppMessage('message-box', `${getUIString('error_message_default', 'common')} ${error.message}`, "error");
    }
}

async function handleSubmit(event) {
    event.preventDefault();

    const stableRatingElement = document.querySelector('input[name="stable_rating"]:checked');
    const slipperyRatingElement = document.querySelector('input[name="slippery_rating"]:checked');

    if (!stableRatingElement || !slipperyRatingElement) {
        showAppMessage('message-box', "Please rate both environments before continuing.", "error");
        return;
    }

    const ratings = {
        stable_rating: parseInt(stableRatingElement.value, 10),
        slippery_rating: parseInt(slipperyRatingElement.value, 10)
    };

    submitButton.disabled = true;
    showAppMessage('message-box', getUIString('message_submitting', 'form_page'), "muted");

    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/submit-free-form-answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                env_id: "ffq_comparison",
                description: ratings
            }),
            credentials: 'include'
        });

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || `HTTP error! Status: ${response.status}`);
        }

        // --- UI TRANSFORMATION LOGIC ---
        
        // 1. Hide the form and identify all page components
        descriptionForm.style.display = 'none';
        const instructionsContainer = document.getElementById('instructions-container');
        const allItems = Array.from(instructionsContainer.children);
        const stableLikert = document.querySelector('input[name="stable_rating"]').closest('.instruction-item');
        const stableImg = stableLikert.previousElementSibling;
        const stableGrid = stableImg.previousElementSibling;
        const stableDivider = stableGrid.previousElementSibling;
        const stableSectionElements = [stableDivider, stableGrid, stableImg, stableLikert];
        const slipperyLikert = document.querySelector('input[name="slippery_rating"]').closest('.instruction-item');
        const slipperyImg = slipperyLikert.previousElementSibling;
        const slipperyGrid = slipperyImg.previousElementSibling;
        const slipperyDivider = slipperyGrid.previousElementSibling;
        const slipperySectionElements = [slipperyDivider, slipperyGrid, slipperyImg, slipperyLikert];
        const allSectionElements = new Set([...stableSectionElements, ...slipperySectionElements]);
        const generalTextElements = allItems.filter(item => !allSectionElements.has(item));
        
        // 2. Determine which section to keep
        const keepSlippery = USER_GROUP.includes('b2');
        const keptGrid = keepSlippery ? slipperyGrid : stableGrid;
        const keptImg = keepSlippery ? slipperyImg : stableImg;
        const elementsToRemove = keepSlippery ? stableSectionElements : slipperySectionElements;
        const elementsToKeep = keepSlippery ? slipperySectionElements : stableSectionElements;

        // Hide text elements before the animation starts
        generalTextElements.forEach(el => { if (el) el.style.display = 'none'; });
        stableLikert.style.display = 'none';
        slipperyLikert.style.display = 'none';

        // --- NEW: Show popup and disable scroll ---
        const overlay = document.getElementById('selection-overlay');
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        // --- End of new setup ---

        // 3. Run "Scrolling Spotlight" Animation
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const scrollOptions = { behavior: 'smooth', block: 'center' };
        async function spotlight(mapElement, duration) {
            mapElement.scrollIntoView(scrollOptions);
            await wait(500);
            mapElement.classList.add('selection-highlight');
            await wait(duration);
            mapElement.classList.remove('selection-highlight');
        }
        // Run the animation sequence
        await spotlight(stableGrid, 250); // New faster round
        await spotlight(slipperyGrid, 250); // New faster round
        await spotlight(stableGrid, 500);
        await spotlight(slipperyGrid, 500);
        await spotlight(stableGrid, 350);
        await spotlight(slipperyGrid, 350);
        
        keptGrid.scrollIntoView(scrollOptions);
        await wait(500);
        keptGrid.classList.add('selection-highlight');
        await wait(1000);

        // --- NEW: Hide popup and re-enable scroll ---
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
        // --- End of new teardown ---

        // 4. Hide the un-selected map and clean up the highlight
        elementsToRemove.forEach(el => { if (el) el.style.display = 'none'; });
        keptGrid.classList.remove('selection-highlight');
        elementsToKeep.forEach(el => {
            if (el && (el.querySelector('.likert-scale-container') || el.querySelector('hr'))) {
                el.style.display = 'none';
            }
        });

        // 5. Update titles and captions
        const pageTitle = document.getElementById('page-title');
        if (pageTitle) pageTitle.textContent = "Realm Selected";

        // Create and insert a divider below the title
        const divider = document.createElement('hr');
        divider.className = 'mt-2 mb-6 border-gray-300';
        pageTitle.after(divider);

        if (keptGrid) {
            const captionElement = keptGrid.querySelector('.image-caption');
            if (captionElement) {
                captionElement.textContent = "This is what the realm will look like in the following mini-games.";
            }
        }

        // 6. Create and insert confirmation message
        const keptRatingName = keepSlippery ? 'slippery_rating' : 'stable_rating';
        const ratingValue = ratings[keptRatingName];
        const ratingMap = { 1: "1 (Rough & Stable)", 2: "2 (Leaning Towards Stable)", 3: "3 (Neutral)", 4: "4 (Leaning Towards Slippery)", 5: "5 (Slick & Slippery)" };
        const ratingText = ratingMap[ratingValue] || ratingValue;
        const confirmationDiv = document.createElement('div');
        confirmationDiv.className = 'instruction-item';
        confirmationDiv.innerHTML = parseSimpleMarkdown(`<div class="emphasis-box emphasis-box-gray" style="margin-top: 1.5rem;"><h3 class="emphasis-box-title">Please Note</h3><ul class="emphasis-box-list"><li>This is the realm you will work with for **all** the mini-games.</li><li>You described this realm as: <strong>${ratingText}</strong>.</li></ul></div>`);
        if (keptImg) {
            keptImg.after(confirmationDiv);
        }
        
        // 7. Create the new "Proceed" button
        const mainContent = document.getElementById('main-content');
        const proceedButton = document.createElement('button');
        proceedButton.textContent = 'Continue';
        proceedButton.className = 'w-full mt-6 btn btn-success';
        proceedButton.onclick = () => {
            proceedButton.disabled = true;
            navigateToNextTask('message-box');
        };
        mainContent.appendChild(proceedButton);
        
        // 8. Add guiding message
        showAppMessage('message-box', "Click 'Continue' to proceed to the first mini-game.", "info");

        // 9. Scroll to the top of the page
        setTimeout(() => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        }, 100);

    } catch (error) {
        console.error("Error submitting ratings:", error);
        showAppMessage('message-box', `${getUIString('error_submission_failed', 'form_page')}`, "error");
        submitButton.disabled = false;
        if(descriptionForm) descriptionForm.style.display = 'block';
    }
}

/**
 * Checks browser zoom and repurposes the mobile warning overlay if zoom > 100%.
 * This will only run if the mobile warning is not already active.
 */
function checkZoomAndShowPopup() {
    // Device pixel ratio is a measure of the display's pixel density (mine is 2)
    if (window.devicePixelRatio <= 2.05) {
        return;
    }

    const overlay = document.getElementById('mobile-warning-overlay');
    // If the mobile warning is already visible, don't do anything
    if (!overlay || !overlay.classList.contains('hidden')) {
        return;
    }

    // Find the elements inside the popup to change their text
    const titleEl = document.getElementById('mobile-warning-title');
    const textEl = document.getElementById('mobile-warning-text');
    const actionEl = document.getElementById('mobile-warning-action');

    if (!overlay || !titleEl || !textEl || !actionEl) {
        return; // Exit if the popup HTML isn't found
    }

    // Change the popup's content to the zoom warning
    titleEl.textContent = 'Your Zoom May Impact Gameplay';
    // Use innerHTML to allow for the **bold** tags
    textEl.innerHTML = 'For the best experience, please reset your browser zoom to 100%. You can do this by pressing Ctrl+0 (on Windows) or Cmd+0 (on Mac).';

    // Create a "Continue" button to dismiss the popup
    const continueButton = document.createElement('button');
    continueButton.className = 'btn btn-primary'; // Use existing button style
    continueButton.style.marginTop = '1rem';
    continueButton.textContent = 'Continue';
    
    // Clear the old content and add the new button
    actionEl.innerHTML = ''; 
    actionEl.appendChild(continueButton);

    // Show the repurposed popup
    overlay.classList.remove('hidden');

    // Make the new button hide the popup when clicked
    continueButton.addEventListener('click', () => {
        overlay.classList.add('hidden');
    }, { once: true });
}

// --- Event Listeners & Initial Load ---
if (descriptionForm) descriptionForm.addEventListener('submit', handleSubmit);
initializePage();