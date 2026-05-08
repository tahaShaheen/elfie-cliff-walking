// utils.js - Shared utility functions for the experiment

const FLASK_SERVER_URL = '';
let UI_STRINGS_CACHE = null; // Cache for UI strings
let USER_GROUP = 'a1'; // Default to 'a1'
const SHOW_ELF_MOVEMENT = false; // Set to true to see elf move, false to keep it at the start.

/**
 * Fetches all UI strings from the backend.
 * This modified version ALWAYS fetches from the backend and does not use sessionStorage.
 */
async function fetchAndCacheUIStrings() {
    console.log("Fetching UI strings from backend...");
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/all-ui-strings`);
        if (!response.ok) {
            throw new Error(`Failed to fetch UI strings: ${response.status}`);
        }
        UI_STRINGS_CACHE = await response.json();
        // The line that saved to sessionStorage has been removed.
        console.log("UI strings fetched.");
        return UI_STRINGS_CACHE;
    } catch (error) {
        console.error("Error fetching UI strings:", error);
        UI_STRINGS_CACHE = {}; // Fallback to empty object on error
        return UI_STRINGS_CACHE;
    }
}

/**
 * Retrieves a UI string by its key and page. If not found in the YAML file,
 * it returns the key itself as the fallback.
 * @param {string} key - The key of the string (e.g., 'button_continue').
 * @param {string} pageKey - The page section in ui_strings (e.g., 'form_page').
 * @returns {string} The UI string from the YAML, or the key itself if not found.
 */
function getUIString(key, pageKey = 'common') {
    if (!UI_STRINGS_CACHE) {
        console.warn("UI_STRINGS_CACHE not initialized. Call fetchAndCacheUIStrings() first or ensure strings are loaded.");
        const storedStrings = sessionStorage.getItem('ui_strings');
        if (storedStrings) {
            try {
                UI_STRINGS_CACHE = JSON.parse(storedStrings);
            } catch (e) { UI_STRINGS_CACHE = {}; }
        } else {
            UI_STRINGS_CACHE = {};
        }
    }
    const pageStrings = UI_STRINGS_CACHE[pageKey] || {};
    const commonStrings = UI_STRINGS_CACHE['common'] || {};

    // Prefer page-specific string, then common, then the key itself as a fallback.
    return pageStrings[key] || commonStrings[key] || key;
}

/**
 * Parses a string for simple markdown (e.g., **bold**).
 * @param {string} text - The text content to parse.
 * @returns {string} HTML string with markdown converted.
 */
function parseSimpleMarkdown(text) {
    if (!text) return '';

    const emojiClass = 'inline-emoji';

    // The 'gs' flags in the last replace are important: 'g' for global, 's' for multiline
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>')
        .replace(/:elf:/g, `<img src="/static/imgs/elf_down.png" alt="elf emoji" class="${emojiClass}">`)
        .replace(/~~(.*?)~~/gs, '<div class="user-description-box">$1</div>');
}

/**
 * Displays a message in a specified message box element with an icon.
 * @param {string} elementId - The ID of the HTML element to display the message in.
 * @param {string} text - The message text.
 * @param {string} type - 'info', 'error', or 'success' (determines styling and icon).
 * @param {number} [error_timeout=1500] - The timeout in ms for error messages.
 */
function showAppMessage(elementId, text, type = "info", error_timeout = 4500) {
    const messageBox = document.getElementById(elementId);
    if (!messageBox) {
        console.error(`Message box element with ID '${elementId}' not found.`);
        return;
    }

    // Before showing a new message, check if the old one should be preserved.
    const isError = type === 'error';
    if (isError && !messageBox.dataset.previousHtml) {
        // If the new message is an error, save the current HTML and classes.
        messageBox.dataset.previousHtml = messageBox.innerHTML;
        messageBox.dataset.previousClassName = messageBox.className;
    }

    if (messageBox.timeoutId) {
        clearTimeout(messageBox.timeoutId);
    }

    const icons = {
        info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>',
        error: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>',
        success: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>'
    };

    messageBox.className = 'message-box';
    messageBox.innerHTML = `
        <div class="message-box-icon">${icons[type] || icons['info']}</div>
        <span class="message-box-text">${parseSimpleMarkdown(text)}</span>
    `;

    messageBox.classList.add(`message-box-${type}`);

    if (isError) {
        // --- ADD THIS LINE ---
        messageBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        messageBox.timeoutId = setTimeout(() => {
            // --- NEW: Restore the saved state ---
            if (messageBox.dataset.previousHtml) {
                messageBox.innerHTML = messageBox.dataset.previousHtml;
                messageBox.className = messageBox.dataset.previousClassName;
            } else {
                // Fallback: If there was no previous message, just clear it.
                messageBox.innerHTML = '';
                messageBox.className = '';
            }

            // Clean up the stored data
            delete messageBox.dataset.previousHtml;
            delete messageBox.dataset.previousClassName;
            messageBox.timeoutId = null;

        }, error_timeout);
    } else {
        // If the new message is NOT an error, clear any saved state.
        delete messageBox.dataset.previousHtml;
        delete messageBox.dataset.previousClassName;
    }
}

/**
 * Navigates to the next task in the overall experiment flow.
 * @param {string} messageBoxIdForStatus - Optional ID of a message box to show status.
 */
async function navigateToNextTask(messageBoxIdForStatus = null) {
    if (messageBoxIdForStatus) {
        showAppMessage(messageBoxIdForStatus, getUIString('message_proceeding_next_task', 'common', "Loading next task..."), "muted");
    }
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/get-next-task`, {
            method: 'POST',
            credentials: 'include'
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Server error ${response.status}` }));
            throw new Error(errorData.error || `Failed to get next task: ${response.status}`);
        }
        const data = await response.json();
        if (data.next_task_url) {
            window.location.href = data.next_task_url;
        } else {
            console.warn("Next task URL not provided by server. Defaulting to thank_you.html or check logic.");
            window.location.href = 'thank_you.html';
        }
    } catch (error) {
        console.error("Error proceeding to next task in flow:", error);
        const errorMsg = getUIString('error_message_default', 'common', "An error occurred.") + ` Details: ${error.message}`;
        if (messageBoxIdForStatus) {
            showAppMessage(messageBoxIdForStatus, errorMsg, "error");
        } else {
            alert(errorMsg);
        }
    }
}

async function fetchAndRenderStructuredInstructions(endpoint, displayAreaId, messageBoxId, taskType, isCollapsible = false, defaultTitle = 'Instructions') {
    const displayArea = document.getElementById(displayAreaId);
    if (!displayArea) {
        console.error(`Instruction display area with ID '${displayAreaId}' not found.`);
        return;
    }

    showAppMessage(messageBoxId, getUIString('loading_instructions', 'common'), "muted");
    try {
        const response = await fetch(`${FLASK_SERVER_URL}${endpoint}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const instructionData = await response.json();

        // Update the global USER_GROUP variable with the data from the backend.
        if (instructionData.user_group) {
            USER_GROUP = instructionData.user_group;
        }

        displayArea.innerHTML = '';

        // --- Step 1: Parse the flat element list into a structured array of cards ---
        const cards = [];
        if (instructionData.elements) {
            let currentCardElements = [];
            let nextCardDisplayMode = 'both'; // Default for the very first card

            for (const item of instructionData.elements) {
                if (item.type === 'new_card') {
                    cards.push({ elements: currentCardElements, displayMode: nextCardDisplayMode });
                    currentCardElements = [];
                    nextCardDisplayMode = item.display_mode || 'both';
                } else {
                    currentCardElements.push(item);
                }
            }
            if (currentCardElements.length > 0) {
                cards.push({ elements: currentCardElements, displayMode: nextCardDisplayMode });
            }
        }

        // --- Step 2: Render the cards based on the view (collapsible or main) ---
        let pageTitle;
        const pageKey = taskType ? `${taskType}_page` : 'instructions_page';
        if (instructionData.title_key) pageTitle = getUIString(instructionData.title_key, pageKey);
        else pageTitle = defaultTitle;

        if (isCollapsible) {
            // --- RENDER COLLAPSIBLE VIEW WITH PARALLEL LOADING ---
            const visibleCards = cards.filter(card => card.displayMode !== 'main_only');
            const elementsToRender = visibleCards.flatMap(card => card.elements);

            // Separate environment items from regular items for parallel loading
            const environmentItems = elementsToRender.filter(item =>
                item.type === 'render_environment' || item.type === 'render_environment_dynamically'
            );
            const regularItems = elementsToRender.filter(item =>
                item.type !== 'render_environment' && item.type !== 'render_environment_dynamically'
            );

            displayArea.className = 'collapsible-container';
            const header = document.createElement('button');
            header.className = 'collapsible-header';
            header.innerHTML = `<span>${getUIString('collapsible_header_text', 'instructions_page')}</span><span class="collapsible-icon"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></span>`;

            const content = document.createElement('div');
            content.className = 'collapsible-content';

            // Render all items immediately (environments will show loading placeholders)
            const elementPlaceholders = new Map();
            elementsToRender.forEach((item, index) => {
                const itemDiv = renderInstructionItem(item);
                if (itemDiv) {
                    content.appendChild(itemDiv);
                    // Store placeholders for environment items so we can update them later
                    if (item.type === 'render_environment' || item.type === 'render_environment_dynamically') {
                        elementPlaceholders.set(index, itemDiv);
                    }
                }
            });

            // Start parallel loading of environments in the background
            if (environmentItems.length > 0) {
                fetchInstructionEnvironmentsInParallel(environmentItems).then(results => {
                    results.forEach((result, resultIndex) => {
                        if (result.success && !result.error) {
                            // Find the corresponding placeholder element
                            const originalIndex = elementsToRender.findIndex((item, idx) =>
                                (item.type === 'render_environment' || item.type === 'render_environment_dynamically') &&
                                elementsToRender.slice(0, idx).filter(i => i.type === 'render_environment' || i.type === 'render_environment_dynamically').length === resultIndex
                            );

                            const placeholderElement = elementPlaceholders.get(originalIndex);
                            if (placeholderElement && result.envData) {
                                renderEnvironmentInPlaceholder(placeholderElement, result.item, result.envData, result.trajectoryData);
                            }
                        } else if (result.error) {
                            console.error(`Failed to load environment:`, result.error);
                        }
                    });

                    // Recalculate collapsible height after environments load
                    if (content.style.maxHeight) {
                        content.style.maxHeight = content.scrollHeight + "px";
                    }
                }).catch(error => {
                    console.error('Error in parallel environment loading:', error);
                });
            }

            header.addEventListener('click', () => {
                header.classList.toggle('active');

                if (content.style.maxHeight) {
                    // If the panel is open, close it.
                    content.style.maxHeight = null;
                } else {
                    // If the panel is closed, open it to its full height.
                    content.style.maxHeight = content.scrollHeight + "px";

                    // After expanding, find all images within the content.
                    const images = content.querySelectorAll('img');
                    images.forEach(img => {
                        // Add an event listener to each image.
                        img.addEventListener('load', () => {
                            // When an image finishes loading, check if the panel is still open.
                            if (content.style.maxHeight) {
                                // If so, recalculate the maxHeight to account for the new image height.
                                content.style.maxHeight = content.scrollHeight + "px";
                            }
                        }, { once: true }); // The listener will run only once per image.
                    });
                }
            });
            displayArea.appendChild(header);
            displayArea.appendChild(content);

        } else {
            // --- RENDER MAIN MULTI-CARD VIEW ---
            const visibleCards = cards.filter(card => card.displayMode !== 'collapsible_only');

            // Get the original card from the HTML to use as a template. This is Card 1.
            const firstCardContainer = document.getElementById('instructions-content-wrapper');
            // This is the content area *inside* the first card.
            const firstCardContentArea = document.getElementById(displayAreaId);
            firstCardContentArea.innerHTML = ''; // Clear it for new content.

            // This will track the last created card's outer DIV element.
            let lastCardDomElement = null;

            if (!visibleCards.length) {
                firstCardContainer.classList.add('hidden'); // Hide template if no cards are visible
            } else {
                visibleCards.forEach((card, index) => {
                    let targetContentArea;
                    if (index === 0) {
                        // The first visible card populates the existing container from the HTML.
                        targetContentArea = firstCardContentArea;
                        lastCardDomElement = firstCardContainer;

                        if (instructionData.current_task_num && instructionData.total_tasks) {
                            pageTitle = getUIString('task_title_template', 'common').replace('{current}', instructionData.current_task_num).replace('{total}', instructionData.total_tasks);
                        }

                        const titleEl = document.createElement('h1');
                        titleEl.className = 'task-title';
                        titleEl.textContent = pageTitle;
                        targetContentArea.appendChild(titleEl);
                    } else {
                        // All subsequent cards are new DIVs created at the same level.
                        const newCardContainer = document.createElement('div');
                        newCardContainer.className = firstCardContainer.className;
                        newCardContainer.classList.remove('hidden');

                        // **THE FIX**: Insert the new card AFTER the previous full card container.
                        lastCardDomElement.after(newCardContainer);

                        targetContentArea = newCardContainer;
                        lastCardDomElement = newCardContainer;
                    }

                    let previousItemType = null;
                    card.elements.forEach(item => {
                        const isNoticeLegend = (item.type === 'image_group' && previousItemType === 'instruction_grid');
                        const itemDiv = renderInstructionItem(item, { isNoticeLegend });
                        if (itemDiv) targetContentArea.appendChild(itemDiv);
                        previousItemType = item.type;
                    });
                });
            }

            const proceedButton = document.getElementById('proceedToTaskButton');
            if (proceedButton && lastCardDomElement) {
                // Append the button to the very last visible card container.
                lastCardDomElement.appendChild(proceedButton);
            }
        }
        showAppMessage(messageBoxId, getUIString('message_read_carefully', 'instructions_page'), "muted");
        return instructionData;
    } catch (error) {
        console.error(`Error fetching/rendering instructions:`, error);
        showAppMessage(messageBoxId, `Error loading instructions: ${error.message}`, "error");
    }
}


// --- CHANGE 4: ADD THIS NEW HELPER FUNCTION ---
// This new function contains the rendering logic that used to be inside your forEach loop.
// Add this function right below fetchAndRenderStructuredInstructions in your utils.js file.
function renderInstructionItem(item, options = {}) {
    const itemDiv = document.createElement('div');
    itemDiv.classList.add('instruction-item');

    if (item.type === "header") {
        const header = document.createElement('h2');
        header.className = "text-xl font-semibold mt-4 mb-2 text-gray-700";
        header.innerHTML = parseSimpleMarkdown(item.content); // Use innerHTML for bolding
        itemDiv.appendChild(header);
    } else if (item.type === "text") {
        const para = document.createElement('p');
        para.className = "text-gray-600 leading-relaxed";
        para.innerHTML = parseSimpleMarkdown(item.content);
        itemDiv.appendChild(para);
    } else if (item.type === "section_header") {
        const header = document.createElement('h2');
        header.className = 'task-section-header';
        header.innerHTML = parseSimpleMarkdown(item.content);
        // We return the header directly, not wrapped in an "instruction-item" div
        // to allow its top margin to work correctly.
        return header;
    } else if (item.type === "caption") {
        const caption = document.createElement('p');
        caption.className = 'image-caption'; // Reuse the existing, centered caption style
        caption.innerHTML = parseSimpleMarkdown(item.content);
        itemDiv.appendChild(caption);
    }
    else if (item.type === "image_group") {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'image-group-container';
        if (item.images && Array.isArray(item.images)) {
            item.images.forEach(imgData => {
                const itemWrapper = document.createElement('div');
                itemWrapper.className = 'image-group-item';

                // Make the specified legend items look and act like buttons
                if (imgData.caption === 'Cliff Tile' || imgData.caption === 'Elfie the Elf') {
                    itemWrapper.style.cursor = 'pointer';
                    itemWrapper.setAttribute('role', 'button');
                    itemWrapper.setAttribute('title', `Click to highlight ${imgData.caption} in the example above`);
                }

                // --- CORRECTED LOGIC TO RENDER LEGEND ITEMS AS GRID CELLS ---

                // 1. Create a single div to act as the tile.
                const tileDiv = document.createElement('div');
                tileDiv.className = 'grid-cell'; // Use the same base class as game cells for consistent styling.

                // Only allow hover on the legend associated with the "Remember!" notice grid.
                if (!options.isNoticeLegend) {
                    tileDiv.style.pointerEvents = 'none';
                }

                // 2. Set the size and background image to mimic a game cell.
                // A standard 50px size should work well for legends.
                tileDiv.style.width = '50px';
                tileDiv.style.height = '50px';
                tileDiv.style.backgroundImage = `url(/static/${imgData.path})`;
                tileDiv.style.backgroundSize = 'cover';
                tileDiv.setAttribute('role', 'img'); // Accessibility improvement
                tileDiv.setAttribute('aria-label', imgData.alt || 'Legend tile');

                // 3. Apply the special effect classes (e.g., for borders, highlights) from the YAML file.
                if (imgData.classes && Array.isArray(imgData.classes)) {
                    tileDiv.classList.add(...imgData.classes);
                }

                // 4. Add the complete, styled tile to the display.
                itemWrapper.appendChild(tileDiv);

                // 5. Add the caption, which will now align correctly.
                if (imgData.caption) {
                    const caption = document.createElement('p');
                    caption.className = 'image-caption';
                    caption.innerHTML = parseSimpleMarkdown(imgData.caption);
                    itemWrapper.appendChild(caption);
                }

                if (imgData.caption === 'Cliff Tile') {
                    itemWrapper.addEventListener('click', () => {
                        const gridComponent = itemWrapper.closest('.instruction-item')?.previousElementSibling;
                        const cliffCell = gridComponent?.querySelector('.cliff-cell');
                        if (cliffCell) {
                            highlightElement(cliffCell, 'red');
                        }
                    });
                } else if (imgData.caption === 'Elfie the Elf') {
                    itemWrapper.addEventListener('click', () => {
                        const gridComponent = itemWrapper.closest('.instruction-item')?.previousElementSibling;
                        const elfImages = gridComponent?.querySelectorAll('img[src="/static/imgs/elf_down.png"]');

                        if (gridComponent && elfImages?.length > 0) {
                            // Scroll the main grid into view once.
                            gridComponent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Highlight all elf cells without individually scrolling.
                            elfImages.forEach(img => {
                                const parentCell = img.parentElement;
                                highlightElement(parentCell, 'red', false);
                            });
                        }
                    });
                }

                groupContainer.appendChild(itemWrapper);
            });

        }
        itemDiv.appendChild(groupContainer);
    } else if (item.type === "instruction_grid") {
        // This is the main container that will center the grid and its caption.
        const componentWrapper = document.createElement('div');
        componentWrapper.style.display = 'flex';
        componentWrapper.style.flexDirection = 'column';
        componentWrapper.style.alignItems = 'center';
        componentWrapper.style.paddingTop = '1.5rem';
        componentWrapper.style.paddingBottom = '1.5rem';

        // --- ALL STYLING IS NOW APPLIED DIRECTLY TO THE GRID CONTAINER ---
        const gridContainer = document.createElement('div');

        // Style the grid container to look like the image provided
        gridContainer.style.border = '1px solid #D1D5DB';  // Light gray border
        gridContainer.style.borderRadius = '0.75rem';       // Rounded corners
        gridContainer.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'; // Subtle shadow
        gridContainer.style.overflow = 'hidden';            // CRITICAL: This clips the inner cells to the rounded corners.
        gridContainer.style.backgroundColor = '#D1D5DB';    // This color will show through the gaps, creating the grid lines.

        // Define the grid layout
        const cellSize = 48; // A slightly smaller, tighter cell size
        const numCols = item.cols || 3;
        gridContainer.style.display = 'grid';
        gridContainer.style.gridTemplateColumns = `repeat(${numCols}, ${cellSize}px)`;
        // --- THIS CREATES THE SEAMLESS GRID EFFECT ---
        gridContainer.style.gap = '1px'; // A 1px gap that the background color shows through.

        if (item.cells && Array.isArray(item.cells)) {
            // This logic for creating the individual tiles remains the same
            item.cells.forEach(cellData => {
                const tileContainer = document.createElement('div');
                tileContainer.style.position = 'relative';
                tileContainer.style.width = `${cellSize}px`;
                tileContainer.style.height = `${cellSize}px`;

                if (cellData.base_image) {
                    tileContainer.style.backgroundImage = `url(/static/${cellData.base_image})`;
                    tileContainer.style.backgroundSize = 'cover';
                    tileContainer.style.backgroundPosition = 'center';

                    if (cellData.base_image.includes('mountain_cliff.png')) {
                        tileContainer.classList.add('cliff-cell');
                    }

                }

                if (cellData.overlay_image) {
                    const overlayImg = document.createElement('img');
                    overlayImg.src = `/static/${cellData.overlay_image}`;
                    overlayImg.style.position = 'absolute';
                    overlayImg.style.top = '50%';
                    overlayImg.style.left = '50%';
                    overlayImg.style.transform = 'translate(-50%, -50%)';
                    overlayImg.style.width = '60%';
                    overlayImg.style.height = '60%';
                    tileContainer.appendChild(overlayImg);
                }
                gridContainer.appendChild(tileContainer);
            });
        }
        componentWrapper.appendChild(gridContainer); // Add the styled grid to the main container

        if (item.group_caption) {
            const groupCaption = document.createElement('p');
            groupCaption.style.textAlign = 'center';
            groupCaption.style.marginTop = '1rem';
            groupCaption.style.fontSize = '1rem';
            groupCaption.style.color = '#374151';
            groupCaption.innerHTML = parseSimpleMarkdown(item.group_caption);
            componentWrapper.appendChild(groupCaption); // Add the caption below the grid
        }

        return componentWrapper;

    } else if (item.type === "large_image") {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'large-image-container'; // For styling

        const img = document.createElement('img');
        img.className = 'contextual-large-image';

        if (item.path) {
            img.src = `/static/${item.path}`;
            img.alt = item.caption || 'A close-up picture of the ground.';
        } else {
            // Fallback to original logic if path is not provided
            if (USER_GROUP === 'group_a1b2' || USER_GROUP === 'group_a2b2') {
                img.src = '/static/imgs/ice_actual_picture.jpg';
                img.alt = 'A close-up picture of a slippery, icy surface.';
            } else {
                img.src = '/static/imgs/grass_actual_picture.jpg';
                img.alt = 'A close-up picture of a stable, grassy surface.';
            }
        }

        imageContainer.appendChild(img);

        if (item.caption) {
            const caption = document.createElement('p');
            caption.className = 'image-caption';
            caption.innerHTML = parseSimpleMarkdown(item.caption);
            imageContainer.appendChild(caption);
        }

        itemDiv.appendChild(imageContainer);
    } else if (item.type === "emphasis_box") {
        const boxDiv = document.createElement('div');
        const color = item.color || 'yellow';
        boxDiv.className = `emphasis-box emphasis-box-${color}`;
        if (item.title) {
            const title = document.createElement('h3');
            title.className = 'emphasis-box-title';
            title.innerHTML = parseSimpleMarkdown(item.title); // Use innerHTML for bolding
            boxDiv.appendChild(title);

            if (item.title.includes('Remember!')) {
                boxDiv.id = 'remember-box-for-glow';
            }
        }
        if (item.items && Array.isArray(item.items)) {
            const list = document.createElement('ul');
            list.className = 'emphasis-box-list';
            item.items.forEach(listItemText => {
                const listItem = document.createElement('li');
                listItem.innerHTML = parseSimpleMarkdown(listItemText);
                list.appendChild(listItem);
            });
            boxDiv.appendChild(list);
        }
        itemDiv.appendChild(boxDiv);

    } else if (item.type === "divider") {
        const hr = document.createElement('hr');
        hr.style.marginTop = '2rem';
        hr.style.marginBottom = '2rem';
        hr.style.borderTop = '1px solid #e5e7eb'; // A light gray line
        itemDiv.appendChild(hr);
    } else if (item.type === "free_form_input") {
        const label = document.createElement('label');
        label.htmlFor = item.name;
        label.className = 'block text-sm font-medium text-gray-700 mt-4';
        label.textContent = item.placeholder;

        const textArea = document.createElement('textarea');
        textArea.id = item.name;
        textArea.name = item.name;
        textArea.className = 'w-full p-2 border border-gray-300 rounded-md mt-1';
        textArea.rows = 3;
        // The placeholder text is now used as a label
        textArea.placeholder = "e.g., The ground looks sticky and wet.";

        itemDiv.appendChild(label);
        itemDiv.appendChild(textArea);
    } else if (item.type === "radio_button_group") {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'radio-group-container'; // For styling

        // Randomize the order of options before rendering
        const shuffledOptions = [...item.options].sort(() => Math.random() - 0.5);

        shuffledOptions.forEach((optionText, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'radio-option-wrapper';

            const radioInput = document.createElement('input');
            radioInput.type = 'radio';
            radioInput.name = item.name; // Use the name from YAML
            radioInput.value = optionText; // The value is the text itself
            radioInput.id = `${item.name}-${index}`;
            radioInput.className = 'mr-2';

            const label = document.createElement('label');
            label.htmlFor = radioInput.id;
            label.innerHTML = parseSimpleMarkdown(optionText);

            wrapper.appendChild(radioInput);
            wrapper.appendChild(label);
            groupContainer.appendChild(wrapper);
        });

        itemDiv.appendChild(groupContainer);
    }
    else if (item.type === "render_environment") {
        // Create a placeholder that will be populated by parallel loading for collapsible views
        // or load immediately for non-collapsible views
        const envId = item.env_id;
        if (!envId) return null;

        const placeholderWrapper = document.createElement('div');
        placeholderWrapper.className = 'rendered-environment-wrapper instruction-item';
        placeholderWrapper.innerHTML = `<p class="image-caption">Loading interactive map...</p>`;

        // Store the item data on the element for later use by parallel loading
        placeholderWrapper.dataset.itemData = JSON.stringify(item);

        // For non-collapsible views, load immediately (preserves existing behavior)
        // For collapsible views, this will be handled by parallel loading
        const isInCollapsibleContext = placeholderWrapper.closest('.collapsible-content') !== null;
        if (!isInCollapsibleContext) {
            // --- THE FIX: Wrap the async logic in a function to isolate the 'item' variable ---
            const renderMap = (currentItem) => {
                fetch(`${FLASK_SERVER_URL}/api/environment/${envId}`)
                    .then(response => {
                        if (!response.ok) throw new Error(`Environment '${envId}' not found.`);
                        return response.json();
                    })
                    .then(envData => {
                        renderEnvironmentInPlaceholder(placeholderWrapper, currentItem, envData);
                    })
                    .catch(error => {
                        console.error(error);
                        placeholderWrapper.innerHTML = `<p class="image-caption text-red-500">Error: ${error.message}</p>`;
                    });
            };

            // Call the function, passing the current 'item' to lock it in for the callback
            renderMap(item);
        }

        return placeholderWrapper;
    } else if (item.type === "render_environment_dynamically") {
        const envId = item.env_id;
        if (!envId) return null;

        const placeholderWrapper = document.createElement('div');
        placeholderWrapper.className = 'rendered-environment-wrapper instruction-item';
        placeholderWrapper.innerHTML = `<p class="image-caption">Loading interactive map...</p>`;

        // Store item data for the parallel loader
        placeholderWrapper.dataset.itemData = JSON.stringify(item);

        const isInCollapsibleContext = placeholderWrapper.closest('.collapsible-content') !== null;

        // Only render immediately if it's NOT a collapsible instruction.
        // The collapsible view uses the parallel loader instead.
        if (!isInCollapsibleContext) {
            const renderNow = async (currentItem) => {
                try {
                    // 1. Fetch all necessary data in parallel
                    const payload = {
                        env_id: envId,
                        instruction_group: USER_GROUP,
                        policy_type_request: currentItem.generate_trajectory.policy_type,
                        path_style: currentItem.generate_trajectory.path_style || 'demonstration',
                        intermediate_goal: currentItem.generate_trajectory.intermediate_goal || null,
                        intervention_points: currentItem.generate_trajectory.intervention_points || null
                    };
                    const [trajectoryResponse, envResponse] = await Promise.all([
                        fetch(`${FLASK_SERVER_URL}/api/generate-instructional-trajectory`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            credentials: 'include'
                        }),
                        fetch(`${FLASK_SERVER_URL}/api/environment/${envId}`)
                    ]);

                    if (!trajectoryResponse.ok || !envResponse.ok) {
                        throw new Error(`Failed to fetch data for ${envId}`);
                    }

                    const trajectoryData = await trajectoryResponse.json();
                    const envData = await envResponse.json();

                    // 2. Call the single, powerful rendering function
                    await renderCompleteDynamicMap(placeholderWrapper, currentItem, envData, trajectoryData);

                } catch (error) {
                    console.error("Error during immediate map render:", error);
                    placeholderWrapper.innerHTML = `<p class="image-caption text-red-500">Error: ${error.message}</p>`;
                }
            };
            renderNow(item);
        }

        return placeholderWrapper;
    } else if (item.type === "render_comparison_dynamically") {
        const envId = item.env_id;
        if (!envId) return null;

        // Main wrapper for the entire component
        const componentWrapper = document.createElement('div');
        componentWrapper.className = 'instruction-item';

        // Flex container to hold the two maps
        const flexContainer = document.createElement('div');
        flexContainer.style.display = 'flex';
        flexContainer.style.justifyContent = 'space-around';
        flexContainer.style.alignItems = 'flex-start';
        flexContainer.style.gap = '1rem';
        flexContainer.style.flexWrap = 'wrap';

        // Create placeholders for the two maps
        const mapAWrapper = document.createElement('div');
        mapAWrapper.style.textAlign = 'center';
        const mapBWrapper = document.createElement('div');
        mapBWrapper.style.textAlign = 'center';

        flexContainer.appendChild(mapAWrapper);
        flexContainer.appendChild(mapBWrapper);
        componentWrapper.appendChild(flexContainer);

        // Async function to fetch and render a single map
        const renderMap = async (wrapper, policyType, cellIdPrefix, labelText) => {
            wrapper.innerHTML = `<p class="image-caption">Loading ${labelText}...</p>`;
            const gridEl = document.createElement('div');
            gridEl.className = 'grid-container';
            wrapper.appendChild(gridEl);

            try {
                const envResponse = await fetch(`${FLASK_SERVER_URL}/api/environment/${envId}`);
                if (!envResponse.ok) throw new Error(`Env '${envId}' not found.`);
                const envData = await envResponse.json();

                const trajectoryResponse = await fetch(`${FLASK_SERVER_URL}/api/generate-instructional-trajectory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        env_id: envId,
                        instruction_group: USER_GROUP,
                        policy_type_request: policyType,
                        path_style: 'comparison'
                    }),
                    credentials: 'include'
                });
                if (!trajectoryResponse.ok) throw new Error(`Failed to get ${policyType} trajectory.`);
                const { trajectory } = await trajectoryResponse.json();

                wrapper.innerHTML = ''; // Clear loading text
                wrapper.appendChild(gridEl); // Add grid container back

                drawGrid(gridEl, envData, { cellIdPrefix, cellSize: 25 });
                updateAgentOnGrid(null, envData.start_state, { cellIdPrefix });

                // Style the path using the red 'path-cell' class
                (trajectory || []).forEach(pos => {
                    const cell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                    if (cell && !cell.classList.contains('start-cell')) {
                        cell.classList.add('path-cell');
                    }
                });

                const label = document.createElement('p');
                label.className = 'image-caption';
                label.textContent = labelText;
                wrapper.appendChild(label);

                updateCollapsibleHeight(wrapper);

            } catch (error) {
                wrapper.innerHTML = `<p class="image-caption text-red-500">Error: ${error.message}</p>`;
            }
        };

        // Render both maps using different policies
        renderMap(mapAWrapper, 'match', `instr-comp-A-${Math.random()}`, 'Plan A');
        renderMap(mapBWrapper, 'mismatch', `instr-comp-B-${Math.random()}`, 'Plan B');

        // Add the overall component caption if provided in YAML
        if (item.caption) {
            const caption = document.createElement('p');
            caption.className = 'image-caption';
            caption.style.marginTop = '1rem';
            caption.innerHTML = parseSimpleMarkdown(item.caption);
            componentWrapper.appendChild(caption);
        }
        return componentWrapper;
    } else if (item.type === "render_plan_execution_comparison") {
        const componentWrapper = document.createElement('div');
        componentWrapper.className = 'instruction-item';

        // --- Create the new two-level layout ---
        const topContainer = document.createElement('div');
        topContainer.className = 'pve-top-container';

        const bottomContainer = document.createElement('div');
        bottomContainer.className = 'pve-bottom-container';

        // Define wrappers for each map
        const planWrapper = document.createElement('div');
        planWrapper.className = 'plan-execution-item';
        const execSafeWrapper = document.createElement('div');
        execSafeWrapper.className = 'plan-execution-item';
        const execSlipWrapper = document.createElement('div');
        execSlipWrapper.className = 'plan-execution-item';

        // Assign maps to the correct containers
        topContainer.appendChild(planWrapper);
        bottomContainer.appendChild(execSafeWrapper);
        bottomContainer.appendChild(execSlipWrapper);

        componentWrapper.appendChild(topContainer);

        // Check for the new header property and render it
        if (item.execution_header) {
            const header = document.createElement('h2');
            // Reuse the existing style for section headers
            header.className = 'task-section-header';
            header.style.textAlign = 'center'; // Center the header
            header.innerHTML = parseSimpleMarkdown(item.execution_header);
            componentWrapper.appendChild(header);
        }

        componentWrapper.appendChild(bottomContainer);

        // Helper function to set up a map (no changes needed here)
        const setupMap = (wrapper, headerText, captionText, id, envData) => {
            wrapper.innerHTML = '';
            const header = document.createElement('h3');
            header.className = 'animation-title';

            // Apply the markdown parser to the header text ---
            header.innerHTML = parseSimpleMarkdown(headerText);

            wrapper.appendChild(header);
            const grid = document.createElement('div');
            grid.className = 'grid-container';
            wrapper.appendChild(grid);
            if (captionText) {
                const caption = document.createElement('p');
                caption.className = 'animation-caption';

                // Apply the markdown parser to the caption text ---
                caption.innerHTML = parseSimpleMarkdown(captionText);

                wrapper.appendChild(caption);
            }
            drawGrid(grid, envData, { cellIdPrefix: id, cellSize: 48 });
            return updateAgentOnGrid(null, envData.start_state, { cellIdPrefix: id });
        };

        // Animation logic (no changes needed here)
        const renderAnimations = async () => {
            const envData = item.map_data;
            const trajectory = item.trajectory;
            const animSpeed = item.animation_speed || 300;

            if (!envData || !trajectory) {
                componentWrapper.innerHTML = "<p class='text-red-500 text-center'>Configuration error: map_data or trajectory missing.</p>";
                return;
            }

            const uniqueId = `plan-cell-${Math.random().toString(36).substring(2, 9)}`;

            // setupMap(planWrapper, item.plan_map.title, item.plan_map.caption, 'plan-cell', envData);

            // An array to hold all the animation promises that we actually start.
            const promises = [];

            // Always set up and animate the Plan map, passing the UNIQUE ID
            setupMap(planWrapper, item.plan_map.title, item.plan_map.caption, uniqueId, envData);
            const planPromise = (async () => {
                for (let i = 1; i < trajectory.length; i++) {
                    const oldCell = document.getElementById(`${uniqueId}-${trajectory[i - 1][0]}-${trajectory[i - 1][1]}`);
                    if (oldCell && !oldCell.classList.contains('start-cell')) oldCell.classList.add('path-cell');
                    const newCell = document.getElementById(`${uniqueId}-${trajectory[i][0]}-${trajectory[i][1]}`);
                    if (newCell) newCell.classList.add('current-pos-highlight');
                    await new Promise(r => setTimeout(r, animSpeed));
                    if (newCell) newCell.classList.remove('current-pos-highlight');
                }
                trajectory.forEach(p => {
                    const c = document.getElementById(`${uniqueId}-${p[0]}-${p[1]}`);
                    if (c && !c.classList.contains('start-cell') && !c.classList.contains('goal-cell')) c.classList.add('path-cell');
                });
            })();
            promises.push(planPromise);

            // ONLY set up and animate the execution maps IF they exist in the data.
            if (item.exec_safe_map) {
                const execSafeAgent = setupMap(execSafeWrapper, item.exec_safe_map.title, item.exec_safe_map.caption, 'exec-safe-cell', envData);
                const execSafePromise = (async () => {
                    let agent = execSafeAgent;
                    for (let i = 1; i < trajectory.length; i++) {
                        agent = animateAgentMove(agent, trajectory[i - 1], trajectory[i], { cellIdPrefix: 'exec-safe-cell', goalState: envData.goal_state, pathCellClass: 'path-cell' });
                        await new Promise(r => setTimeout(r, animSpeed));
                    }
                })();
                promises.push(execSafePromise);
            } else {
                // If the map data doesn't exist, hide its container.
                execSafeWrapper.style.display = 'none';
            }

            if (item.exec_slip_map) {
                const execSlipAgent = setupMap(execSlipWrapper, item.exec_slip_map.title, item.exec_slip_map.caption, 'exec-slip-cell', envData);
                const execSlipPromise = (async () => {
                    let agent = execSlipAgent;
                    agent = animateAgentMove(agent, trajectory[0], trajectory[1], { cellIdPrefix: 'exec-slip-cell', goalState: envData.goal_state, pathCellClass: 'path-cell' });
                    await new Promise(r => setTimeout(r, animSpeed));
                    agent = animateAgentMove(agent, trajectory[1], trajectory[2], { cellIdPrefix: 'exec-slip-cell', goalState: envData.goal_state, pathCellClass: 'path-cell' });
                    await new Promise(r => setTimeout(r, animSpeed));
                    const fallIntoCliffPos = [0, 2];
                    agent = updateAgentOnGrid(agent, fallIntoCliffPos, { oldPos: trajectory[2], spriteUrl: '/static/imgs/elf_right.png', cellIdPrefix: 'exec-slip-cell', pathCellClass: 'path-cell' });
                    await new Promise(r => setTimeout(r, animSpeed));
                    if (agent) agent.style.backgroundImage = `url('/static/imgs/mountain_cliff_skull.png')`;
                })();
                promises.push(execSlipPromise);
            } else {
                // If the map data doesn't exist, hide its container.
                execSlipWrapper.style.display = 'none';
            }

            // Wait for ONLY the promises that were actually started.
            await Promise.all(promises);

            setTimeout(renderAnimations, 1500);
        };

        // renderAnimations();
        setTimeout(renderAnimations, 0); // ADD THIS LINE
        return componentWrapper;

    } else if (item.type === "render_environment_statically") {
        const componentWrapper = document.createElement('div');
        componentWrapper.className = 'rendered-environment-wrapper instruction-item';

        // Immediately render the static map since all data is available.
        // This function does not make any network requests.
        renderStaticMap(componentWrapper, item);

        return componentWrapper;
    } else if (item.type === "render_comparison_statically") {
        const componentWrapper = document.createElement('div');
        componentWrapper.className = 'instruction-item';
        renderStaticComparison(componentWrapper, item);
        return componentWrapper;
    } else if (item.type === "likert_scale") {
        const likertContainer = document.createElement('div');
        likertContainer.className = 'likert-scale-container my-8';

        const questionP = document.createElement('p');
        questionP.className = 'text-center text-lg font-semibold text-gray-800 mb-4';
        questionP.innerHTML = parseSimpleMarkdown(item.question);
        questionP.id = `question-${item.name}`;
        likertContainer.appendChild(questionP);

        const scaleWrapper = document.createElement('div');
        scaleWrapper.className = 'flex items-start justify-center gap-x-2 sm:gap-x-4';
        scaleWrapper.setAttribute('role', 'radiogroup');
        scaleWrapper.setAttribute('aria-labelledby', questionP.id);

        for (let i = 1; i <= 5; i++) {
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'flex flex-col items-center gap-y-2';

            const radioLabel = document.createElement('label');
            radioLabel.className = 'cursor-pointer rounded-full';
            radioLabel.setAttribute('for', `${item.name}-${i}`);
            radioLabel.setAttribute('aria-label', `Rating ${i}`);

            const radioInput = document.createElement('input');
            radioInput.type = 'radio';
            radioInput.name = item.name;
            radioInput.value = i;
            radioInput.id = `${item.name}-${i}`;
            radioInput.className = 'peer sr-only';

            const radioDisplay = document.createElement('span');
            radioDisplay.className = `
            w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full
            border-2 border-gray-300 bg-white text-gray-500 font-semibold text-lg
            transition-all duration-200 ease-in-out
            hover:border-blue-500 hover:shadow-md
            peer-checked:bg-blue-600 peer-checked:border-blue-700 peer-checked:text-white peer-checked:scale-110 peer-checked:shadow-lg
            peer-focus:ring-2 peer-focus:ring-offset-2 peer-focus:ring-blue-500
        `;
            radioDisplay.textContent = i;

            radioLabel.appendChild(radioInput);
            radioLabel.appendChild(radioDisplay);
            buttonContainer.appendChild(radioLabel);

            const description = document.createElement('div');
            description.className = 'text-center text-xs sm:text-sm text-gray-600 w-24';

            // It now checks for a 'labels' object in the YAML item.
            // If not found, it falls back to the original hardcoded labels.
            const labels = item.labels || {};
            if (labels[i]) {
                description.innerHTML = parseSimpleMarkdown(labels[i]);
            } else {
                // Fallback for the free_form_question page
                if (i === 1) {
                    description.innerHTML = `Rough &<br>Stable`;
                } else if (i === 3) {
                    description.innerHTML = `Neutral`;
                } else if (i === 5) {
                    description.innerHTML = `Slick &<br>Slippery`;
                } else {
                    description.innerHTML = `&nbsp;`;
                }
            }
            buttonContainer.appendChild(description);

            scaleWrapper.appendChild(buttonContainer);
        }

        likertContainer.appendChild(scaleWrapper);
        itemDiv.appendChild(likertContainer);
    }

    else if (item.type === "render_animated_map") {
        const componentWrapper = document.createElement('div');
        componentWrapper.className = 'instruction-item rendered-environment-wrapper';

        // Helper to set up the map and agent
        const setupMap = (wrapper, captionText, id, envData, tile_type) => {
            wrapper.innerHTML = ''; // Clear wrapper
            const grid = document.createElement('div');
            grid.className = 'grid-container';
            grid.style.margin = '1rem auto';
            wrapper.appendChild(grid);

            // This function handles the animation's caption
            if (captionText) {
                const caption = document.createElement('p');
                caption.className = 'image-caption'; // Use 'image-caption' for consistent styling
                caption.innerHTML = parseSimpleMarkdown(captionText);
                wrapper.appendChild(caption);
            }

            // Draw the grid using the specified tile_type
            drawGrid(grid, envData, { cellIdPrefix: id, cellSize: 48, tile_type: tile_type });

            // Disable pointer events for all cells to prevent interaction.
            const allCells = grid.querySelectorAll('.grid-cell');
            allCells.forEach(cell => {
                cell.style.pointerEvents = 'none';
            });

            // Place the agent at the start and return the element
            return updateAgentOnGrid(null, envData.start_state, { cellIdPrefix: id });
        };

        // Main animation logic
        let shuffledTrajectories = [];
        let currentIndex = 0;

        const shuffleArray = (array) => {
            const newArray = [...array]; // Create a copy to avoid modifying the original
            for (let i = newArray.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArray[i], newArray[j]] = [newArray[j], newArray[i]]; // Swap elements
            }
            return newArray;
        };

        // Main animation logic
        const renderAnimation = async () => {
            const envData = item.map_data;
            let trajectory;

            // Check if a list of trajectories is provided.
            if (item.trajectories && Array.isArray(item.trajectories) && item.trajectories.length > 0) {
                // If the shuffled list is empty or we've played them all, re-shuffle.
                if (currentIndex >= shuffledTrajectories.length) {
                    shuffledTrajectories = shuffleArray(item.trajectories);
                    currentIndex = 0; // Reset to the start of the new shuffled list
                }
                trajectory = shuffledTrajectories[currentIndex];
                currentIndex++; // Move to the next trajectory for the next loop
            } else {
                // Fallback to the original single trajectory logic for backward compatibility.
                trajectory = item.trajectory;
            }


            const animSpeed = item.animation_speed || 400;

            if (!envData || !trajectory) {
                componentWrapper.innerHTML = "<p class='text-red-500 text-center'>Configuration error: map_data or trajectory missing.</p>";
                return;
            }

            const uniqueId = `anim-map-cell-${Math.random().toString(36).substring(2, 9)}`;
            const agentElement = setupMap(componentWrapper, item.caption, uniqueId, envData, item.tile_type);

            let agent = agentElement;
            for (let i = 1; i < trajectory.length; i++) {
                agent = animateAgentMove(agent, trajectory[i - 1], trajectory[i], {
                    cellIdPrefix: uniqueId,
                    goalState: envData.goal_state,
                    pathCellClass: 'path-cell',
                    forceMove: true, // This is the crucial flag to ensure Elfie moves
                    cliffStates: envData.cliff_states
                });
                await new Promise(r => setTimeout(r, animSpeed));
            }

            // After a pause, restart the animation for a continuous loop
            setTimeout(renderAnimation, 2000);
        };

        // Start the animation
        renderAnimation();

        return componentWrapper;
    }

    else {
        return null; // Don't create a div for unknown types
    }
    return itemDiv;
}

/**
 * Draws a grid in a specified container element based on environment data.
 * @param {HTMLElement} gridElement - The container element for the grid.
 * @param {object} envData - Data about the environment (rows, cols, etc.).
 * @param {object} [options={}] - Optional parameters.
 */
function drawGrid(gridElement, envData, options = {}) {
    if (!gridElement || !envData || !envData.grid_rows || !envData.grid_cols) return 0;

    gridElement.innerHTML = '';
    const { grid_rows, grid_cols, start_state, goal_state, cliff_states } = envData;

    // --- At the top of the function ---
    const { cellIdPrefix = 'cell', tile_type = null } = options;

    let cellSize = options.cellSize || 50;
    if (options.dynamicCellSize) {
        const { preferred, min, max, container } = options.dynamicCellSize;
        const availableWidth = (container && container.offsetWidth > 0) ? container.offsetWidth * 0.95 : 400;
        let calculated = preferred;
        if (grid_cols * calculated > availableWidth) {
            calculated = Math.floor(availableWidth / grid_cols);
        }
        cellSize = Math.min(max, Math.max(min, calculated));
    }

    gridElement.style.width = `${grid_cols * cellSize}px`;
    gridElement.style.height = `${grid_rows * cellSize}px`;
    gridElement.style.gridTemplateColumns = `repeat(${grid_cols}, ${cellSize}px)`;

    for (let r = 0; r < grid_rows; r++) {
        for (let c = 0; c < grid_cols; c++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.id = `${cellIdPrefix}-${r}-${c}`;
            cell.style.width = `${cellSize}px`;
            cell.style.height = `${cellSize}px`;

            cell.dataset.row = r;
            cell.dataset.col = c;

            // --- Conditional background logic ---
            let useIceTile = (USER_GROUP === 'group_a1b2' || USER_GROUP === 'group_a2b2');
            if (tile_type === 'slippery') {
                useIceTile = true;
            } else if (tile_type === 'stable') {
                useIceTile = false;
            }

            if (useIceTile) {
                cell.style.backgroundImage = "url('/static/imgs/ice.png')";
            } else {
                cell.style.backgroundImage = "url('/static/imgs/mountain_bg2.png')";
            }

            if (start_state && r === start_state[0] && c === start_state[1]) cell.classList.add('start-cell');
            if (goal_state && r === goal_state[0] && c === goal_state[1]) cell.classList.add('goal-cell');
            if (cliff_states && cliff_states.some(cliff => cliff[0] === r && cliff[1] === c)) cell.classList.add('cliff-cell');
            // // Commented out to keep them looking like normal cells. (Will edit to add cosmetic changes later.)
            // if (x_states && x_states.some(x => x[0] === r && x[1] === c)) cell.classList.add('x-cell');
            // if (o_states && o_states.some(o => o[0] === r && o[1] === c)) cell.classList.add('o-cell');
            // if (y_states && y_states.some(y => y[0] === r && y[1] === c)) cell.classList.add('y-cell');
            gridElement.appendChild(cell);
        }
    }
    return cellSize;
}

/**
 * Creates or moves an agent sprite on the grid.
 * @param {HTMLElement} agentDiv - The existing agent element (or null).
 * @param {number[]} newPos - The new [row, col] position for the agent.
 * @param {object} [options={}] - Optional parameters.
 * @param {number[]} [options.oldPos=null] - The previous [row, col] position to apply a path style.
 * @param {string} [options.spriteUrl='/static/imgs/elf_down.png'] - The image for the agent.
 * @param {string} [options.pathCellClass='path-cell'] - The CSS class for the traversed path.
 * @param {string} [options.cellIdPrefix='cell'] - The prefix for cell IDs.
 * @param {number[]} [options.goalState=null] - The goal position to check against.
 * @returns {HTMLElement} The new agent element.
 */
function updateAgentOnGrid(agentDiv, newPos, options = {}) {
    const {
        oldPos = null,
        spriteUrl = '/static/imgs/elf_down.png',
        pathCellClass = 'path-cell',
        cellIdPrefix = 'cell',
        goalState = null
    } = options;

    if (agentDiv && agentDiv.parentElement) {
        agentDiv.parentElement.classList.remove('cell-with-agent-at-goal');
        agentDiv.remove();
    }

    if (oldPos) {
        const oldCellElement = document.getElementById(`${cellIdPrefix}-${oldPos[0]}-${oldPos[1]}`);
        if (oldCellElement && !(goalState && oldPos[0] === goalState[0] && oldPos[1] === goalState[1])) {
            oldCellElement.classList.add(pathCellClass);
        }
    }

    const newCellElement = document.getElementById(`${cellIdPrefix}-${newPos[0]}-${newPos[1]}`);
    if (newCellElement) {
        newCellElement.classList.remove(pathCellClass, 'corrected-path-cell');
        const newAgentDiv = document.createElement('div');
        newAgentDiv.className = 'agent-sprite';
        newAgentDiv.style.backgroundImage = `url('${spriteUrl}')`;
        newCellElement.appendChild(newAgentDiv);

        if (goalState && newPos[0] === goalState[0] && newPos[1] === goalState[1]) {
            newCellElement.classList.add('cell-with-agent-at-goal');
        }
        return newAgentDiv;
    }
    return null;
}

/**
 * Determines sprite based on direction and moves the agent. This is the new central animation function.
 * @param {HTMLElement} agentElement - The existing agent DOM element (can be null).
 * @param {Array<number>} oldPos - The starting [row, col] of the move. Can be null for the first move.
 * @param {Array<number>} newPos - The destination [row, col] of the move.
 * @param {object} options - An object for additional parameters.
 * @param {string} [options.cellIdPrefix='cell'] - The ID prefix for grid cells.
 * @param {object} [options.goalState=null] - The coordinates of the goal state for styling.
 * @returns {HTMLElement} The new, updated agent DOM element.
 */
function animateAgentMove(agentElement, oldPos, newPos, options = {}) {
    if (!newPos) return agentElement;

    // Check if the animation is for the plan/execution explainer
    const isExecutionExample = (options.cellIdPrefix || '').startsWith('exec-');

    if (SHOW_ELF_MOVEMENT || isExecutionExample || options.forceMove) {
        // This block runs when the flag is TRUE or for our new component, moving the agent with directional sprites.
        let spriteUrl = '/static/imgs/elf_down.png';
        if (oldPos) {
            if (newPos[0] < oldPos[0]) spriteUrl = '/static/imgs/elf_up.png';
            else if (newPos[0] > oldPos[0]) spriteUrl = '/static/imgs/elf_down.png';
            else if (newPos[1] < oldPos[1]) spriteUrl = '/static/imgs/elf_left.png';
            else if (newPos[1] > oldPos[1]) spriteUrl = '/static/imgs/elf_right.png';
        }
        const newAgent = updateAgentOnGrid(agentElement, newPos, {
            oldPos: oldPos,
            spriteUrl: spriteUrl,
            cellIdPrefix: options.cellIdPrefix || 'cell',
            goalState: options.goalState || null
        });

        // Check if the new position is a cliff and change the sprite
        const isCliff = (options.cliffStates || []).some(cliff => cliff[0] === newPos[0] && cliff[1] === newPos[1]);
        if (isCliff && newAgent) {
            newAgent.style.backgroundImage = `url('/static/imgs/mountain_cliff_skull.png')`;
        }

        return newAgent;
        
    } else {
        // This block runs when the flag is FALSE. The agent sprite does not move,
        // but its current logical position is now highlighted in red.
        const highlightClass = 'current-pos-highlight';
        const cellIdPrefix = options.cellIdPrefix || 'cell';

        // 1. Update the previous cell
        if (oldPos) {
            const { pathCellClass = 'path-cell', goalState = null } = options;
            const oldCellElement = document.getElementById(`${cellIdPrefix}-${oldPos[0]}-${oldPos[1]}`);
            if (oldCellElement) {
                // Remove the red highlight from the previous position
                oldCellElement.classList.remove(highlightClass);
                // Add the gray path class to the previous position
                if (!(goalState && oldPos[0] === goalState[0] && oldPos[1] === goalState[1])) {
                    if (!oldCellElement.classList.contains('start-cell')) {
                        oldCellElement.classList.add(pathCellClass);
                    }
                }
            }
        }

        // 2. Highlight the new current cell in red
        const newCellElement = document.getElementById(`${cellIdPrefix}-${newPos[0]}-${newPos[1]}`);
        if (newCellElement) {
            newCellElement.classList.add(highlightClass);
        }

        // 3. Place the agent sprite at the start (only on the first call)
        if (!agentElement) {
            return updateAgentOnGrid(null, newPos, {
                oldPos: null,
                spriteUrl: '/static/imgs/elf_down.png',
                cellIdPrefix: options.cellIdPrefix || 'cell',
                goalState: options.goalState || null
            });
        }

        // 4. Return the stationary agent sprite
        return agentElement;
    }
}

/**
 * Handles standardized UI updates for practice vs. real task modes.
 * @param {boolean} isPractice - Whether it's practice mode.
 * @param {object} elements - DOM elements to update.
 * @param {string} elements.contentContainerId - The ID of the main content wrapper for the page.
 * @param {object} text - Text content for the elements.
 * @param {HTMLElement} elements.pageTitleEl - The main page title element.
 * @param {HTMLElement} elements.counterEl - The element displaying the count/status.
 * @param {HTMLElement} elements.counterLabelEl - The label for the counter.
 * @param {object} text - Text content for the elements.
 * @param {string} text.realTitle - The title for the real task.
 * @param {string} text.practiceTitle - The title for the practice task.
 * @param {string} text.practiceCounterText - The text for the counter in practice.
 * @param {string} text.realCounterText - The formatted text for the real counter (e.g., "1 of 10").
 */
function handlePracticeModeUI(isPractice, elements, text) {
    const { pageTitleEl, counterEl, counterLabelEl, contentContainerId } = elements;
    const { realTitle, practiceTitle, practiceCounterText, realCounterText } = text;
    const contentContainer = document.getElementById(contentContainerId);

    // First, remove any existing banner to prevent duplicates
    const existingBanner = document.getElementById('practice-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    if (isPractice) {
        // If in practice mode, create and add the new banner
        if (contentContainer) {
            const banner = document.createElement('div');
            banner.id = 'practice-banner';
            banner.className = 'practice-banner';
            banner.innerHTML = getUIString('practice_round_banner', 'common');
            // Prepend adds the banner as the first child of the container
            contentContainer.prepend(banner);
        }
        // --- END OF NEW BANNER LOGIC ---

        if (pageTitleEl) pageTitleEl.textContent = practiceTitle;
        if (counterEl) {
            counterEl.textContent = practiceCounterText;
            counterEl.classList.add('text-blue-600', 'font-semibold');
        }
        if (counterLabelEl) counterLabelEl.classList.add('hidden');
    } else {
        // Not in practice mode
        if (pageTitleEl) pageTitleEl.textContent = realTitle;
        if (counterEl) {
            counterEl.textContent = realCounterText;
            counterEl.classList.remove('text-blue-600', 'font-semibold');
        }
        if (counterLabelEl) counterLabelEl.classList.remove('hidden');
    }
}


/**
 * Builds and updates a standardized status bar for task pages.
 * @param {object} options - Configuration for the status bar.
 * @param {string} options.containerId - The ID of the container div.
 * @param {string} options.taskName - The name of the current task (e.g., "Demonstration").
 * @param {boolean} options.isPractice - Whether it's a practice round.
 * @param {number} options.currentNum - The current task number.
 * @param {number} options.maxNum - The total number of tasks.
 * @param {string|null} [options.statText=null] - Optional task-specific text (e.g., "Corrections Left: 3").
 */
function updateTaskStatusBar(options) {
    const { containerId, taskName, isPractice, currentNum, maxNum, statText = null } = options;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Build the HTML for each pill
    const counterText = isPractice ? 'Practice Round' : `Mini-Game ${currentNum} of ${maxNum}`;
    const counterPill = `<div class="status-pill task-counter">${taskName}: ${counterText}</div>`;

    const practicePill = '';

    const statPill = statText ? `<div class="status-pill task-stat">${statText}</div>` : '';

    // Combine them into the final status bar
    container.innerHTML = `
        <div class="task-status-bar">
            ${counterPill}
            ${practicePill}
            ${statPill}
        </div>
    `;
}

/**
 * Displays a prominent "PRACTICE ROUND" banner at the top of a given container.
 * @param {string} containerId - The ID of the element to prepend the banner to.
 */
function displayPracticeBanner(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.error(`Practice banner container with ID '${containerId}' not found.`);
        return;
    }

    // First, remove any old banner to be safe
    const oldBanner = document.getElementById('practice-banner');
    if (oldBanner) {
        oldBanner.remove();
    }

    // Create and add the new banner
    const banner = document.createElement('div');
    banner.id = 'practice-banner';
    banner.className = 'practice-banner'; // This uses the CSS style we created
    banner.textContent = getUIString('practice_round_banner', 'common');
    // Prepend adds the banner as the first child of the container
    container.prepend(banner);
}

/**
 * Checks if the user is on a mobile phone and shows a full-screen warning
 * overlay populated with text from the ui_strings.yaml file.
 */
function checkDeviceCompatibility() {
    const isMobilePhone = /Mobi/i.test(navigator.userAgent);
    if (isMobilePhone) {
        const warningOverlay = document.getElementById('mobile-warning-overlay');
        const warningTitle = document.getElementById('mobile-warning-title');
        const warningText = document.getElementById('mobile-warning-text');
        const warningAction = document.getElementById('mobile-warning-action');

        if (warningOverlay) {
            // Populate the text content from the UI strings cache
            if (warningTitle) warningTitle.textContent = getUIString('title', 'mobile_warning');
            if (warningText) warningText.textContent = getUIString('main_text', 'mobile_warning');
            if (warningAction) warningAction.textContent = getUIString('call_to_action', 'mobile_warning');

            // Show the fully populated overlay
            warningOverlay.classList.remove('hidden');
        }
    }
}

/**
 * Updates the entire progress bar, including milestone text, round text, and percentage.
 * This function calculates the final percentage based on progress within a mini-game.
 * @param {object} progressInfo - The progress_info object from the server.
 * @param {number|null} roundCurrent - The current round number for a task.
 * @param {number|null} roundTotal - The total number of rounds for a task.
 */
function updateProgressBar(progressInfo, roundCurrent, roundTotal) {
    const container = document.getElementById('progress-bar-container');
    const bar = document.getElementById('progress-bar');
    const milestoneText = document.getElementById('progress-milestone-text');
    const roundText = document.getElementById('progress-round-text');

    if (!container || !bar || !milestoneText || !roundText) return;

    if (!progressInfo) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    // Update text content
    const currentMilestoneText = progressInfo.milestone_text || '';
    milestoneText.textContent = currentMilestoneText;

    // Set the status text based on the page type
    if (progressInfo.base_percent >= 100) {
        // If progress is at 100%, show completion text.
        roundText.textContent = getUIString('progress_complete_notice', 'common');
    } else if (roundCurrent && roundTotal > 0) {
        // This is a real, numbered task round.
        roundText.textContent = getUIString('progress_round_template', 'common').replace('{current}', roundCurrent).replace('{total}', roundTotal);
    } else if (roundCurrent === null && roundTotal && roundTotal > 0) {
        // This is a practice round for a specific task (a total number of rounds is known).
        roundText.textContent = getUIString('progress_practice_notice', 'common');
    } else {
        // Handles instructional/setup phases. Differentiate the getting started page from others.
        const lowerMilestone = currentMilestoneText.toLowerCase();
        if (lowerMilestone.includes('getting started')) {
            roundText.textContent = getUIString('welcome_text', 'common');
        } else if (lowerMilestone.includes('instructions') || lowerMilestone.includes('planning vs. execution')) {
            // If the milestone text is self-explanatory, leave the round text blank.
            roundText.textContent = '';
        } else {
            // Fallback for other non-task pages.
            roundText.textContent = getUIString('instructions_title', 'common');
        }
    }

    // Calculate final percentage
    let finalPercent = progressInfo.base_percent;
    const hasRounds = roundCurrent && roundTotal > 0;

    if (hasRounds) {
        const base = progressInfo.base_percent;
        const next_base = progressInfo.next_base_percent;
        const taskSpan = next_base - base; // How much % this entire task is worth
        const roundProgress = (roundCurrent - 1) / roundTotal; // Progress within this task's rounds
        finalPercent = base + (roundProgress * taskSpan);
    }

    bar.style.width = `${finalPercent}%`;
}



/**
 * A simple Priority Queue implementation for A* search.
 * In a real-world, large-scale scenario, a more efficient heap-based
 * implementation would be better, but for our grid sizes, this is sufficient.
 */
class SimplePriorityQueue {
    constructor() {
        this.elements = [];
    }
    enqueue(item, priority) {
        this.elements.push({ item, priority });
        this.elements.sort((a, b) => a.priority - b.priority); // Keep sorted
    }
    dequeue() {
        return this.elements.shift().item;
    }
    isEmpty() {
        return this.elements.length === 0;
    }
}

/**
 * Finds the shortest path between two points on the grid using the A* algorithm.
 * @param {Array<number>} start - The starting [row, col].
 * @param {Array<number>} end - The ending [row, col].
 * @param {object} envData - Environment data including obstacles.
 * @returns {Array<Array<number>>|null} The path as an array of points, or null if no path is found.
 */
function aStarSearch(start, end, envData) {
    // console.log(`%c[A*] Starting search from [${start.join(',')}] to [${end.join(',')}]`, 'font-weight: bold; color: purple;');

    const { grid_rows, grid_cols, cliff_states } = envData;
    const impassableCells = new Set(cliff_states.map(p => p.join(',')));
    const startKey = start.join(',');
    const endKey = end.join(',');

    const openSet = new SimplePriorityQueue();
    openSet.enqueue(start, 0);

    // **THE FIX**: A closed set prevents reprocessing nodes, which is critical for performance
    // and was the likely cause of the freeze.
    const closedSet = new Set();

    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const fScore = new Map([[startKey, Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1])]]);

    let loopCount = 0;

    while (!openSet.isEmpty()) {
        loopCount++;
        // Safety break to prevent true infinite loops during debugging.
        if (loopCount > (grid_rows * grid_cols) * 2) {
            console.error('[A*] Aborting search: Exceeded maximum loop count.');
            return null;
        }

        const current = openSet.dequeue();
        const currentKey = current.join(',');

        // Log the current step in the search.
        // console.log(`[A*] Loop ${loopCount}: Dequeued [${currentKey}]. Queue size: ${openSet.elements.length}`);

        if (currentKey === endKey) {
            const path = [end];
            let tempKey = endKey;
            while (cameFrom.has(tempKey)) {
                const prevNode = cameFrom.get(tempKey);
                path.unshift(prevNode);
                tempKey = prevNode.join(',');
            }
            // console.log(`%c[A*] Path FOUND from [${start.join(',')}] to [${end.join(',')}] in ${loopCount} steps.`, 'font-weight: bold; color: green;');
            return path;
        }

        closedSet.add(currentKey); // Mark the current node as processed.

        const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]]
            .map(([dr, dc]) => [current[0] + dr, current[1] + dc])
            .filter(([r, c]) =>
                r >= 0 && r < grid_rows && c >= 0 && c < grid_cols && !impassableCells.has(`${r},${c}`)
            );

        for (const neighbor of neighbors) {
            const neighborKey = neighbor.join(',');
            // **THE FIX**: If the neighbor has already been processed, skip it.
            if (closedSet.has(neighborKey)) {
                continue;
            }

            const tentativeGScore = gScore.get(currentKey) + 1;
            if (tentativeGScore < (gScore.get(neighborKey) || Infinity)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeGScore);
                const hScore = Math.abs(neighbor[0] - end[0]) + Math.abs(neighbor[1] - end[1]);
                fScore.set(neighborKey, tentativeGScore + hScore);

                if (!openSet.elements.some(el => el.item.join(',') === neighborKey)) {
                    openSet.enqueue(neighbor, fScore.get(neighborKey));
                }
            }
        }
    }

    console.error(`[A*] Path NOT FOUND from [${start.join(',')}] to [${end.join(',')}] after ${loopCount} steps.`);
    return null; // No path found
}


/**
 * Calculates influence using a Gaussian function for smooth deformation.
 * @param {number} distance - The distance from the correction point.
 * @param {number} sigma - The width of the influence spread.
 * @returns {number} The influence factor (0 to 1).
 */
function _calculateInfluence(distance, sigma = 2.5) {
    return Math.exp(-(distance ** 2) / (2 * sigma ** 2));
}

/**
 * Deforms a trajectory smoothly based on a single correction point.
 * @param {Array<Array<number>>} trajectory - The original path.
 * @param {number} correctionIndex - The index of the point being dragged.
 * @param {Array<number>} correctionVector - The [d_row, d_col] of the drag.
 * @param {number} sigma - The spread of the deformation.
 * @returns {Array<Array<number>>} The new, deformed trajectory with floating-point coordinates.
 */
function deformTrajectory(trajectory, correctionIndex, correctionVector, sigma = 2.5) {
    if (trajectory.length < 3) return trajectory;

    const deformedTraj = [];
    for (let i = 0; i < trajectory.length; i++) {
        const point = trajectory[i];
        if (i === 0 || i === trajectory.length - 1) {
            deformedTraj.push([...point]); // Keep start and end points fixed
            continue;
        }
        const distance = Math.abs(i - correctionIndex);
        const influence = _calculateInfluence(distance, sigma);
        const displacement = [correctionVector[0] * influence, correctionVector[1] * influence];
        const newPoint = [point[0] + displacement[0], point[1] + displacement[1]];
        deformedTraj.push(newPoint);
    }
    return deformedTraj;
}

/**
 * Snaps a deformed, floating-point trajectory to a valid grid path.
 * @param {Array<Array<number>>} originalTrajectory - The path before deformation.
 * @param {Array<Array<number>>} deformedTrajectory - The floating-point path to fix.
 * @param {object} envData - Environment data with grid dimensions and obstacles.
 * @returns {Array<Array<number>>|null} A new, valid grid path or null if fixing fails.
 */
function fixDeformedTrajectory(originalTrajectory, deformedTrajectory, envData) {
    // console.log('%c[Pathfinder] fixDeformedTrajectory: Starting...', 'color: blue;');

    if (!deformedTrajectory || deformedTrajectory.length < 2) {
        console.warn('[Pathfinder] Trajectory too short to fix.');
        return { path: originalTrajectory, pruned: [] }; // Always return an object
    }

    const { grid_rows, grid_cols, cliff_states = [] } = envData;
    const impassableCells = new Set(cliff_states.map(p => p.join(',')));

    // 1. Round and validate waypoints
    const waypoints = deformedTrajectory.map((point, i) => {
        const r = Math.round(point[0]);
        const c = Math.round(point[1]);
        if (r < 0 || r >= grid_rows || c < 0 || c >= grid_cols || impassableCells.has(`${r},${c}`)) {
            return originalTrajectory[i];
        }
        return [r, c];
    });

    const uniqueWaypoints = waypoints.reduce((acc, p) => {
        if (!acc.length || acc[acc.length - 1].join(',') !== p.join(',')) acc.push(p);
        return acc;
    }, []);

    // console.log(`[Pathfinder] Validated waypoints: ${uniqueWaypoints.length} unique points.`);

    if (uniqueWaypoints.length < 2) return uniqueWaypoints;

    // 2. Reconstruct path between waypoints with A*
    // console.log(`[Pathfinder] Stitching ${uniqueWaypoints.length - 1} segments with A*.`);
    let pathWithCycles = [];
    for (let i = 0; i < uniqueWaypoints.length - 1; i++) {
        const segment = aStarSearch(uniqueWaypoints[i], uniqueWaypoints[i + 1], envData);
        if (segment === null) {
            console.error('[Pathfinder] A* segment failed. Aborting fix.');
            return originalTrajectory;
        }
        pathWithCycles.push(...(i === 0 ? segment : segment.slice(1)));
    }

    if (!pathWithCycles.length) {
        console.warn('[Pathfinder] A* stitching resulted in an empty path.');
        return originalTrajectory;
    }

    // 3. Prune the stitched path
    const finalPath = pruneTrajectory(pathWithCycles);

    // Calculate the difference to find the cells that were pruned by the algorithm.
    const finalPathKeys = new Set(finalPath.map(p => p.join(',')));
    const prunedCells = pathWithCycles.filter(p => !finalPathKeys.has(p.join(',')));

    // console.log(`%c[Pathfinder] fixDeformedTrajectory: Finished. Final path has ${finalPath.length} steps.`, 'color: blue; font-weight: bold;');

    // Return an object containing both the path and the cells that were just pruned.
    return { path: finalPath, pruned: prunedCells };
}

/**
 * Removes cycles and meanders from a trajectory.
 * @param {Array<Array<number>>} trajectory - The path to prune.
 * @returns {Array<Array<number>>} The pruned path.
 */
function pruneTrajectory(trajectory) {
    if (!trajectory || trajectory.length < 2) {
        return trajectory;
    }

    // 1. Prune simple cycles by removing loops
    const pathWithCycles = trajectory;
    const prunedPath = [];
    const visited = new Set();
    for (const point of pathWithCycles) {
        const key = point.join(',');
        if (visited.has(key)) {
            // If we've seen this point before, rewind the path
            while (prunedPath.length) {
                const lastPoint = prunedPath.pop();
                visited.delete(lastPoint.join(','));
                if (lastPoint.join(',') === key) break;
            }
        }
        prunedPath.push(point);
        visited.add(key);
    }

    if (prunedPath.length <= 1) {
        return prunedPath;
    }

    // 2. Prune meanders (inefficient U-turns)
    const finalPath = [prunedPath[0]];
    const finalPathSet = new Set([prunedPath[0].join(',')]);

    for (let i = 1; i < prunedPath.length; i++) {
        const point = prunedPath[i];
        let rewindTargetKey = null;
        const lastPointInFinalKey = finalPath[finalPath.length - 1].join(',');

        // Check if any neighbor of the current point is already in the final path,
        // unless it's the point we just came from.
        const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => [point[0] + dr, point[1] + dc]);
        for (const neighbor of neighbors) {
            const neighborKey = neighbor.join(',');
            if (neighborKey !== lastPointInFinalKey && finalPathSet.has(neighborKey)) {
                rewindTargetKey = neighborKey;
                break;
            }
        }

        if (rewindTargetKey) {
            // A meander was detected. Rewind the final path.
            while (finalPath.length > 0 && finalPath[finalPath.length - 1].join(',') !== rewindTargetKey) {
                const popped = finalPath.pop();
                finalPathSet.delete(popped.join(','));
            }
        }

        const lastKey = finalPath.length > 0 ? finalPath[finalPath.length - 1].join(',') : null;
        if (lastKey !== point.join(',')) {
            finalPath.push(point);
            finalPathSet.add(point.join(','));
        }
    }
    return finalPath;
}

/**
 * Checks if a path exists from a start to a goal on a grid, avoiding obstacles.
 * Uses Breadth-First Search (BFS).
 * @param {object} envData - The environment data, including rows, cols, and cliffs.
 * @param {Array<number>} startPos - The [row, col] of the start point.
 * @param {Array<number>} goalPos - The [row, col] of the goal point.
 * @param {Array<Array<number>>} tempObstacles - An array of temporary obstacle coordinates.
 * @returns {boolean} - True if a path exists, false otherwise.
 */
function isSolvable(envData, startPos, goalPos, tempObstacles = []) {
    const { grid_rows, grid_cols, cliff_states = [] } = envData;

    // Combine permanent cliffs and temporary obstacles into one set for easy lookup.
    const impassable = new Set(cliff_states.map(p => p.join(',')));
    tempObstacles.forEach(obs => impassable.add(obs.join(',')));

    // If start or goal is blocked, it's unsolvable.
    if (impassable.has(startPos.join(',')) || impassable.has(goalPos.join(','))) {
        return false;
    }

    const queue = [startPos];
    const visited = new Set([startPos.join(',')]);

    while (queue.length > 0) {
        const [r, c] = queue.shift();

        if (r === goalPos[0] && c === goalPos[1]) {
            return true; // Goal reached
        }

        // Check neighbors (Up, Down, Left, Right)
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
        for (const [nr, nc] of neighbors) {
            const neighborKey = `${nr},${nc}`;
            // Check if within bounds, not visited, and not impassable
            if (nr >= 0 && nr < grid_rows && nc >= 0 && nc < grid_cols &&
                !visited.has(neighborKey) && !impassable.has(neighborKey)) {
                visited.add(neighborKey);
                queue.push([nr, nc]);
            }
        }
    }

    return false; // Goal not reachable
}


/**
 * Types out text into an element character-by-character, preserving HTML tags.
 * @param {HTMLElement} element - The HTML element to type into.
 * @param {string} text - The text to type, can include markdown.
 * @param {number} [speed=20] - The delay between characters in milliseconds.
 */
async function typewriterEffect(element, text, speed = 20) {
    // Clear the element and use the existing markdown parser
    element.innerHTML = '';
    const parsedHtml = parseSimpleMarkdown(text);

    // Use a temporary div to correctly parse all nodes (text and elements like <strong>)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = parsedHtml;

    // Process each node from the temporary div
    for (const node of Array.from(tempDiv.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            // If it's plain text, type it out
            for (const char of node.textContent) {
                element.innerHTML += char;
                await new Promise(res => setTimeout(res, speed));
            }
        } else {
            // If it's an HTML element (like <strong>), append it instantly
            element.innerHTML += node.outerHTML;
        }
    }
}

/**
 * Finds a parent collapsible container and updates its height if it's open.
 * This is used to adjust the layout after async content (like maps) has loaded.
 * @param {HTMLElement} element - A child element within the collapsible content.
 */
function updateCollapsibleHeight(element) {
    const content = element.closest('.collapsible-content');
    // Check if a) a collapsible parent exists and b) it's currently open (has maxHeight set).
    if (content && content.style.maxHeight) {
        content.style.maxHeight = content.scrollHeight + "px";
    }
}


// --- PARALLEL LOADING HELPERS FOR INSTRUCTION ENVIRONMENTS ---
// These functions enable faster loading of multiple environment maps in parallel

/**
 * Fetches multiple environments in parallel with batching to avoid server overload
 */
async function fetchInstructionEnvironmentsInParallel(environmentItems) {
    const batchSize = 3; // Limit concurrent requests to avoid overwhelming server
    const results = [];

    for (let i = 0; i < environmentItems.length; i += batchSize) {
        const batch = environmentItems.slice(i, i + batchSize);
        const batchPromises = batch.map(async (item, batchIndex) => {
            const globalIndex = i + batchIndex;
            try {
                // Add a small delay to prevent server overwhelm
                await new Promise(resolve => setTimeout(resolve, globalIndex * 50));

                if (item.type === "render_environment_dynamically" && item.generate_trajectory) {
                    const payload = {
                        env_id: item.env_id,
                        instruction_group: USER_GROUP,
                        policy_type_request: item.generate_trajectory.policy_type,
                        path_style: item.generate_trajectory.path_style || 'demonstration',
                        intermediate_goal: item.generate_trajectory.intermediate_goal || null,
                        intervention_points: item.generate_trajectory.intervention_points || null,
                        request_id: `instr-${Date.now()}-${globalIndex}` // Unique identifier
                    };

                    const [trajectoryResponse, envResponse] = await Promise.all([
                        fetch(`${FLASK_SERVER_URL}/api/generate-instructional-trajectory`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            credentials: 'include'
                        }),
                        fetch(`${FLASK_SERVER_URL}/api/environment/${item.env_id}`)
                    ]);

                    if (!trajectoryResponse.ok || !envResponse.ok) {
                        throw new Error(`Failed to fetch data for ${item.env_id}`);
                    }

                    const trajectoryData = await trajectoryResponse.json();
                    const envData = await envResponse.json();

                    return { item, trajectoryData, envData, index: globalIndex, success: true };
                } else if (item.type === "render_environment") {
                    const envResponse = await fetch(`${FLASK_SERVER_URL}/api/environment/${item.env_id}`);
                    if (!envResponse.ok) throw new Error(`Environment '${item.env_id}' not found.`);
                    const envData = await envResponse.json();
                    return { item, envData, index: globalIndex, success: true };
                }
                return { item, index: globalIndex, success: true };
            } catch (error) {
                console.error(`Error fetching environment ${item.env_id}:`, error);
                return { item, error, index: globalIndex, success: false };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
    }

    return results;
}

/**
 * Renders environment data into a target DOM element safely
 */
function renderEnvironmentInPlaceholder(placeholderWrapper, item, envData, trajectoryData = null) {
    if (!placeholderWrapper || !item || !envData) return;

    // This function now just calls the complete, shared rendering function
    // with the data it received from the parallel loader.
    renderCompleteDynamicMap(placeholderWrapper, item, envData, trajectoryData);
}

async function renderCompleteDynamicMap(container, item, envData, trajectoryData) {
    try {
        // Clear the container
        container.innerHTML = '';
        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid-container';
        gridContainer.style.margin = '1rem auto';
        container.appendChild(gridContainer);

        const cellIdPrefix = `instr-cell-${item.env_id}-${Math.random()}`;
        drawGrid(gridContainer, envData, { cellIdPrefix });

        const { trajectory } = trajectoryData;
        const pathStyle = item.generate_trajectory.path_style;

        // --- All Path Styling Logic ---
        if (pathStyle === 'demonstration') {
            trajectory.slice(0, -1).forEach(pos => {
                const cell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                if (cell) cell.classList.add('path-cell');
            });
            const lastPos = trajectory[trajectory.length - 1];
            const lastCell = document.getElementById(`${cellIdPrefix}-${lastPos[0]}-${lastPos[1]}`);
            if (lastCell) lastCell.classList.add('current-pos-highlight');
            const trajectoryCells = new Set(trajectory.map(p => p.join(',')));
            const cliffCells = new Set((envData.cliff_states || []).map(p => p.join(',')));
            const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dr, dc]) => [lastPos[0] + dr, lastPos[1] + dc]);
            neighbors.forEach(([r, c]) => {
                const neighborKey = `${r},${c}`;
                if (r >= 0 && r < envData.grid_rows && c >= 0 && c < envData.grid_cols && !cliffCells.has(neighborKey) && !trajectoryCells.has(neighborKey)) {
                    const targetCell = document.getElementById(`${cellIdPrefix}-${r}-${c}`);
                    if (targetCell) targetCell.classList.add('correction-target-cell');
                }
            });
        } else if (pathStyle === 'off') {
            const prunedTrajectory = pruneTrajectory(trajectoryData.trajectory);
            const intervention_index = item.generate_trajectory.intervention_index || 0;
            if (prunedTrajectory && intervention_index !== null) {
                prunedTrajectory.forEach((pos, index) => {
                    const cell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                    if (!cell || index === 0) return;
                    if (intervention_index > 0 && index < intervention_index) {
                        cell.classList.add('path-cell');
                    } else {
                        cell.classList.add('trajectory-path-cell');
                    }
                });
                const interventionPoints = item.generate_trajectory.intervention_points;
                if (Array.isArray(interventionPoints)) {
                    interventionPoints.forEach(point => {
                        const mistakeCell = document.getElementById(`${cellIdPrefix}-${point[0]}-${point[1]}`);
                        if (mistakeCell) mistakeCell.classList.add('obstacle-cell');
                    });
                }
            }
        } else if (pathStyle === 'correction_initial') {
            (trajectory || []).forEach(pos => {
                const cell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                if (cell && !cell.classList.contains('start-cell')) {
                    cell.classList.add('trajectory-path-cell');
                }
            });
            const highlightCell = item.generate_trajectory.highlight_cell;
            if (highlightCell && Array.isArray(highlightCell)) {
                const cellToHighlight = document.getElementById(`${cellIdPrefix}-${highlightCell[0]}-${highlightCell[1]}`);
                if (cellToHighlight) cellToHighlight.classList.add('correction-target-cell');
            }
        } else if (pathStyle === 'correction_final' || pathStyle === 'correction_sequential') {
            let pathPromise;
            if (pathStyle === 'correction_final') {
                const fromCell = item.generate_trajectory.correction_from_cell;
                const toCell = item.generate_trajectory.correction_to_cell;
                pathPromise = fetch(`${FLASK_SERVER_URL}/api/deform-and-fix-trajectory`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // FIX: Changed envId to item.env_id
                    body: JSON.stringify({ trajectory, correctionIndex: trajectory.findIndex(p => p[0] === fromCell[0] && p[1] === fromCell[1]), correctionVector: [toCell[0] - fromCell[0], toCell[1] - fromCell[1]], env_id: item.env_id }),
                    credentials: 'include'
                }).then(res => res.json());
            } else { // sequential
                pathPromise = (async () => {
                    let currentPath = [...trajectory];
                    const corrections = item.generate_trajectory.corrections || [];
                    for (const correction of corrections) {
                        const response = await fetch(`${FLASK_SERVER_URL}/api/deform-and-fix-trajectory`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            // FIX: Changed envId to item.env_id
                            body: JSON.stringify({ trajectory: currentPath, correctionIndex: currentPath.findIndex(p => p[0] === correction.from[0] && p[1] === correction.from[1]), correctionVector: [correction.to[0] - correction.from[0], correction.to[1] - correction.from[1]], env_id: item.env_id }),
                            credentials: 'include'
                        });
                        const { new_trajectory } = await response.json();
                        currentPath = new_trajectory;
                    }
                    return { new_trajectory: currentPath };
                })();
            }

            const { new_trajectory: finalPath } = await pathPromise;
            (finalPath || []).forEach(pos => {
                const cell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                if (cell && !cell.classList.contains('start-cell')) cell.classList.add('trajectory-path-cell');
            });

            const highlightCell = item.generate_trajectory.highlight_cell;
            if (highlightCell && Array.isArray(highlightCell)) {
                const cellToHighlight = document.getElementById(`${cellIdPrefix}-${highlightCell[0]}-${highlightCell[1]}`);
                if (cellToHighlight) cellToHighlight.classList.add('correction-target-cell');
            }
        }

        // --- Agent, Overlays, and Classes ---
        updateAgentOnGrid(null, envData.start_state, { cellIdPrefix });
        if (item.overlays && Array.isArray(item.overlays)) {
            item.overlays.forEach(overlay => {
                const targetCell = document.getElementById(`${cellIdPrefix}-${overlay.position[0]}-${overlay.position[1]}`);
                if (targetCell) {
                    const overlayImg = document.createElement('img');
                    overlayImg.src = `/static/${overlay.image_path}`;
                    overlayImg.className = 'instruction-overlay-image';
                    if (overlay.styles) Object.assign(overlayImg.style, overlay.styles);
                    targetCell.appendChild(overlayImg);
                }
            });
        }
        if (item.cell_classes && Array.isArray(item.cell_classes)) {
            item.cell_classes.forEach(rule => {
                if (rule.positions && Array.isArray(rule.positions) && rule.classes) {
                    rule.positions.forEach(pos => {
                        const targetCell = document.getElementById(`${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                        if (targetCell) targetCell.classList.add(...rule.classes);
                    });
                }
            });
        }
        if (item.caption) {
            const caption = document.createElement('p');
            caption.className = 'image-caption';
            caption.innerHTML = parseSimpleMarkdown(item.caption);
            container.appendChild(caption);
        }

        updateCollapsibleHeight(container);

    } catch (error) {
        console.error("Error completing dynamic map render:", error);
        container.innerHTML = `<p class="image-caption text-red-500">Error: ${error.message}</p>`;
    }
}

function renderStaticMap(container, item) {
    try {
        // Consolidate map data from the item object.
        const mapData = { ...item, ...(item.map_data || {}) };

        if (!mapData.grid_rows || !mapData.grid_cols) {
            throw new Error("Static map is missing required grid dimensions.");
        }

        // 1. Setup the grid container.
        container.innerHTML = '';
        const gridContainer = document.createElement('div');
        gridContainer.className = 'grid-container';
        gridContainer.style.margin = '1rem auto';
        container.appendChild(gridContainer);
        const cellIdPrefix = `static-cell-${Date.now()}`;

        // 2. Draw the base grid (we know this part works).
        drawGrid(gridContainer, mapData, { cellIdPrefix, tile_type: item.tile_type });


        // Disable pointer events for all cells to prevent interaction.
        // I added this because Andrew thought the cells in instruction maps were clickable.
        const allCells = gridContainer.querySelectorAll('.grid-cell');
        allCells.forEach(cell => {
            cell.style.pointerEvents = 'none';
        });

        // 3. Apply CSS classes for highlights directly.
        if (item.path_data) {
            for (const className in item.path_data) {
                const positions = item.path_data[className] || [];
                positions.forEach(pos => {
                    // Search within the gridContainer, not the whole document.
                    const cell = gridContainer.querySelector(`#${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                    if (cell) {
                        cell.classList.add(className);
                    }
                });
            }
        }

        // 4. Add the Elf sprite directly.
        if (mapData.start_state) {
            const startCell = gridContainer.querySelector(`#${cellIdPrefix}-${mapData.start_state[0]}-${mapData.start_state[1]}`);
            if (startCell) {
                const elfSprite = document.createElement('div');
                elfSprite.className = 'agent-sprite';
                elfSprite.style.backgroundImage = `url('/static/imgs/elf_down.png')`;
                startCell.appendChild(elfSprite);
            }
        }

        // 5. Add overlays directly.
        if (item.overlays && Array.isArray(item.overlays)) {
            item.overlays.forEach(overlay => {
                const targetCell = gridContainer.querySelector(`#${cellIdPrefix}-${overlay.position[0]}-${overlay.position[1]}`);
                if (targetCell) {
                    const overlayImg = document.createElement('img');
                    overlayImg.src = `/static/${overlay.image_path}`;
                    overlayImg.className = 'instruction-overlay-image';
                    targetCell.appendChild(overlayImg);
                }
            });
        }

        // 6. Add the caption.
        if (item.caption) {
            const caption = document.createElement('p');
            caption.className = 'image-caption';
            caption.innerHTML = parseSimpleMarkdown(item.caption);
            container.appendChild(caption);
        }

        updateCollapsibleHeight(container);

    } catch (error) {
        console.error("Error rendering static map:", error);
        container.innerHTML = `<p class="image-caption text-red-500">Error: ${error.message}</p>`;
    }
}

/*
 * Renders a side-by-side comparison of two static maps for instructions.
 * @param {HTMLElement} container - The wrapper element for the whole component.
 * @param {object} item - The instruction item object from YAML, containing plan_a and plan_b.
 */
function renderStaticComparison(container, item) {
    container.innerHTML = ''; // Clear the main container

    // Create a flex container to hold the two maps side-by-side
    const flexContainer = document.createElement('div');
    flexContainer.style.display = 'flex';
    flexContainer.style.justifyContent = 'space-around';
    flexContainer.style.alignItems = 'flex-start';
    flexContainer.style.gap = '1rem';
    flexContainer.style.flexWrap = 'wrap';

    // Helper function to render a single plan (A or B)
    const renderPlan = (planData) => {
        const wrapper = document.createElement('div');
        wrapper.style.textAlign = 'center';

        const mapData = planData.map_data; // Get map data from the plan

        // Validate that map_data exists
        if (!mapData || !mapData.grid_rows) {
            const label = document.createElement('p');
            label.className = 'image-caption';
            label.textContent = `${planData.label || 'Plan'} (Error: Missing map_data)`;
            wrapper.appendChild(label);
            return wrapper;
        }

        const gridEl = document.createElement('div');
        gridEl.className = 'grid-container';
        const cellIdPrefix = `instr-comp-cell-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        // Draw the base grid with a smaller cell size for comparisons
        drawGrid(gridEl, mapData, { cellIdPrefix, cellSize: 25 });

        const allCells = gridEl.querySelectorAll('.grid-cell');
        allCells.forEach(cell => {
            cell.style.pointerEvents = 'none';
        });

        // Apply path styling directly
        if (planData.path_data) {
            for (const className in planData.path_data) {
                if (Object.hasOwnProperty.call(planData.path_data, className)) {
                    (planData.path_data[className] || []).forEach(pos => {
                        const cell = gridEl.querySelector(`#${cellIdPrefix}-${pos[0]}-${pos[1]}`);
                        if (cell) cell.classList.add(className);
                    });
                }
            }
        }

        // Add the Elf sprite directly
        if (mapData.start_state) {
            const startCell = gridEl.querySelector(`#${cellIdPrefix}-${mapData.start_state[0]}-${mapData.start_state[1]}`);
            if (startCell) {
                const elfSprite = document.createElement('div');
                elfSprite.className = 'agent-sprite';
                elfSprite.style.backgroundImage = `url('/static/imgs/elf_down.png')`;
                startCell.appendChild(elfSprite);
            }
        }

        // Add overlays directly
        if (planData.overlays && Array.isArray(planData.overlays)) {
            planData.overlays.forEach(overlay => {
                const targetCell = gridEl.querySelector(`#${cellIdPrefix}-${overlay.position[0]}-${overlay.position[1]}`);
                if (targetCell) {
                    const overlayImg = document.createElement('img');
                    overlayImg.src = `/static/${overlay.image_path}`;
                    overlayImg.className = 'instruction-overlay-image';
                    targetCell.appendChild(overlayImg);
                }
            });
        }

        wrapper.appendChild(gridEl);

        // Add the label (e.g., "Plan A")
        const label = document.createElement('p');
        label.className = 'image-caption';
        label.style.fontWeight = 'bold';
        label.textContent = planData.label || '';
        wrapper.appendChild(label);

        return wrapper;
    };

    // Render both plans if they exist in the YAML
    if (item.plan_a) flexContainer.appendChild(renderPlan(item.plan_a));
    if (item.plan_b) flexContainer.appendChild(renderPlan(item.plan_b));

    container.appendChild(flexContainer);

    // Add the overall caption for the comparison
    if (item.caption) {
        const caption = document.createElement('p');
        caption.className = 'image-caption';
        caption.style.marginTop = '1rem';
        caption.innerHTML = parseSimpleMarkdown(item.caption);
        container.appendChild(caption);
    }
}

/**
 * Scrolls to and temporarily highlights an HTML element.
 * @param {HTMLElement} element - The element to highlight.
 * @param {string} [color='red'] - The color of the glow ('red' or 'blue').
 * @param {boolean} [shouldScroll=true] - Whether to scroll the element into view.
 */
function highlightElement(element, color = 'red', shouldScroll = true) {
    if (!element) return;

    // Store the element's original styles before we change them.
    const originalPosition = element.style.position;
    const originalZIndex = element.style.zIndex;


    const colorMap = {
        red: 'rgba(255, 20, 20, 0.8)',
        blue: 'rgba(59, 130, 246, 0.7)'
    };

    if (shouldScroll) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    element.style.position = 'relative';
    element.style.zIndex = '20';

    // Apply a larger, more prominent glow effect.
    element.style.boxShadow = `0 0 30px 10px ${colorMap[color] || colorMap.red}`;
    element.style.borderRadius = '0.375rem';
    element.style.transition = 'box-shadow 0.3s ease-in-out';

    // Remove glow effect after a delay
    setTimeout(() => {
        element.style.boxShadow = '';

        // Reset the position and z-index to their original values.
        element.style.position = originalPosition;
        element.style.zIndex = originalZIndex;


    }, 2500);
}

// Add this function to utils.js

/**
 * Calculates the Dynamic Time Warping (DTW) distance between two trajectories.
 * Trajectories are arrays of [row, col] points.
 * @param {Array<Array<number>>} trajA The first trajectory.
 * @param {Array<Array<number>>} trajB The second trajectory.
 * @returns {number} The DTW distance.
 */
function dtw(trajA, trajB) {
    const n = trajA.length;
    const m = trajB.length;
    const dtwMatrix = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
    dtwMatrix[0][0] = 0;

    const cost = (pointA, pointB) => {
        return Math.sqrt(Math.pow(pointA[0] - pointB[0], 2) + Math.pow(pointA[1] - pointB[1], 2));
    };

    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const currentCost = cost(trajA[i - 1], trajB[j - 1]);
            dtwMatrix[i][j] = currentCost + Math.min(
                dtwMatrix[i - 1][j],      // Insertion
                dtwMatrix[i][j - 1],      // Deletion
                dtwMatrix[i - 1][j - 1]   // Match
            );
        }
    }
    return dtwMatrix[n][m];
}

/**
 * Counts the total number of times a hole/cliff cell is adjacent to any cell in a trajectory.
 * A single hole will be counted multiple times if it is a neighbor to multiple path cells.
 * @param {Array<Array<number>>} trajectory The path to check.
 * @param {object} envData The environment data containing cliff_states.
 * @returns {number} The total count of adjacencies.
 */
function countAdjacentHoles(trajectory, envData) {
    if (!trajectory || !envData.cliff_states) return 0;

    // Use a simple counter instead of a Set.
    let adjacencyCount = 0;
    const cliffCells = new Set(envData.cliff_states.map(p => p.join(',')));

    // Iterate through each cell in the provided trajectory.
    for (const point of trajectory) {
        const [r, c] = point;
        // Check all four neighbors for each point on the path.
        const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];

        for (const neighbor of neighbors) {
            const neighborKey = neighbor.join(',');
            // If the neighbor is a cliff, increment the counter.
            if (cliffCells.has(neighborKey)) {
                adjacencyCount++;
            }
        }
    }
    // Return the final total count.
    return adjacencyCount;
}


/**
 * Scales the game content to fit within the browser window.
 * Capped at 100% to prevent up-scaling.
 */
function adjustContentScale() {
    const content = document.getElementById('actual-game-content');
    if (!content) return;

    // --- CHANGE 1: Check if the content is hidden BEFORE we do anything ---
    const wasHidden = content.classList.contains('hidden');

    // Make content visible but off-screen to measure its true size
    content.style.position = 'absolute';
    content.style.visibility = 'hidden';
    content.classList.remove('hidden');

    const contentWidth = content.offsetWidth;
    const availableWidth = window.innerWidth * 0.95; // Use 95% of window width

    // Restore visibility and position after measuring
    content.style.position = '';
    content.style.visibility = '';

    // --- CHANGE 2: Only hide the content again if it was originally hidden ---
    if (wasHidden) {
        content.classList.add('hidden');
    }

    // Calculate scale and apply it, but don't scale up past 100%
    const scale = Math.min(availableWidth / contentWidth, 1);

    content.style.transformOrigin = 'top center';
    content.style.transform = `scale(${scale})`;
}


// In utils.js, replace the existing function with this one for debugging:
function generateTrajectoryFromPolicyJS(policy, envData) {
    // --- Start of Debugging Block ---
    console.groupCollapsed(`[Debug] generateTrajectoryFromPolicyJS for env: ${envData.id || 'Unknown'}`);
    console.log("Received envData:", JSON.parse(JSON.stringify(envData)));
    console.log(`Received policy with length: ${policy ? policy.length : 'null'}`);
    // --- End of Debugging Block ---

    const { grid_rows, grid_cols, start_state, goal_state } = envData;
    if (!policy || !start_state || !goal_state) {
        console.error("Path generation failed: Missing policy or start/goal state.");
        console.groupEnd();
        return [];
    }

    let trajectory = [Array.from(start_state)];
    let currentPos = Array.from(start_state);
    const maxSteps = grid_rows * grid_cols * 2;

    for (let i = 0; i < maxSteps; i++) {
        if (currentPos[0] === goal_state[0] && currentPos[1] === goal_state[1]) break;

        const stateIndex = currentPos[0] * grid_cols + currentPos[1];
        if (stateIndex >= policy.length) {
            console.warn(`Breaking loop: stateIndex ${stateIndex} is out of bounds for policy length ${policy.length}.`);
            break;
        }

        const action = policy[stateIndex];
        const oldPos = Array.from(currentPos);

        // --- Debug log for the first action ---
        if (i === 0) {
            const actionMap = { 0: 'LEFT', 1: 'DOWN', 2: 'RIGHT', 3: 'UP' };
            console.log(`First Step: At start state [${start_state.join(',')}] (index ${stateIndex}), policy action is ${action} (${actionMap[action]})`);
        }
        // ---

        if (action === 0 && currentPos[1] > 0) currentPos[1]--;
        else if (action === 1 && currentPos[0] < grid_rows - 1) currentPos[0]++;
        else if (action === 2 && currentPos[1] < grid_cols - 1) currentPos[1]++;
        else if (action === 3 && currentPos[0] > 0) currentPos[0]--;

        if (oldPos[0] === currentPos[0] && oldPos[1] === currentPos[1]) {
            console.warn(`Breaking loop: Agent is stuck at [${currentPos.join(',')}]`);
            break;
        }

        trajectory.push(Array.from(currentPos));
    }

    console.log(`Generated trajectory with ${trajectory.length} steps.`);
    console.groupEnd();
    return trajectory;
}

/**
 * Generates a number of candidate trajectories, each created via a sequence of perturbations,
 * and then selects the 2nd best option based on a scoring model.
 * Also uses an optional trajectory to compare against for the comparisons task.
 * @param {Array<number>} primaryPolicy - The policy to perturb.
 * @param {Array<number>} rivalPolicy - The policy to compare against.
 * @param {object} envData - The environment data (including cliffs).
 * @param {number} epsilon - The perturbation factor from the config.
 * @param {number} [holeWeight=50.0] - A factor to control the influence of the hole proximity penalty.
 * @param {number} [candidateCount=5] - The number of candidates to generate.
 * @param {Array<Array<number>>} [comparisonTrajectory=null] - An optional existing trajectory to maximize distance from.
 * @returns {Array<Array<number>>} The single 2nd best perturbed trajectory.
 */
function generateAndSelectBestPerturbation(primaryPolicy, rivalPolicy, envData, epsilon, holeWeight = 50.0, candidateCount = 5, comparisonTrajectory = null) {
    console.group(`%c[Perturbation Selection] Generating ${candidateCount} candidates...`, 'font-weight:bold; color: #007bff;');

    if (comparisonTrajectory) {
        console.log('%cMode: Ensuring difference from provided comparison trajectory.', 'color: #17a2b8;');
    }

    // 1. Generate the two "perfect" original trajectories.
    const originalPrimary = generateTrajectoryFromPolicyJS(primaryPolicy, envData);
    const originalRival = generateTrajectoryFromPolicyJS(rivalPolicy, envData);

    if (originalPrimary.length <= 2) {
        console.log('%cPath too short to perturb. Returning original.', 'color: #fd7e14;');
        console.groupEnd();
        return originalPrimary;
    }

    const holesOriginal = countAdjacentHoles(originalPrimary, envData);

    // --- Candidate Generation with Sequential Perturbations ---
    const candidates = [];
    const numToPerturb = Math.round(originalPrimary.length * epsilon);
    console.log(`Each of the ${candidateCount} candidates will be generated by attempting ${numToPerturb} sequential perturbations.`);

    // Outer Loop: Generate candidateCount candidates
    for (let i = 0; i < candidateCount; i++) {
        let currentCandidate = JSON.parse(JSON.stringify(originalPrimary));

        // Sample the indices from the original path that we will attempt to perturb.
        const sampleableIndices = Array.from({ length: originalPrimary.length - 2 }, (_, i) => i + 1);
        for (let j = sampleableIndices.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [sampleableIndices[j], sampleableIndices[k]] = [sampleableIndices[k], sampleableIndices[j]];
        }
        const indicesToTry = sampleableIndices.slice(0, numToPerturb);

        // Inner Loop: Apply perturbations sequentially to the current candidate
        for (const originalIndex of indicesToTry) {
            // Get the coordinate of the point we originally wanted to perturb
            const originalCoord = originalPrimary[originalIndex];

            // Find if that coordinate still exists on the *current, modified* path
            const currentIndex = currentCandidate.findIndex(p => p[0] === originalCoord[0] && p[1] === originalCoord[1]);

            // If the point was removed by a previous perturbation in this sequence, skip it.
            if (currentIndex === -1) {
                continue;
            }

            // If the point still exists, perturb it.
            const vectors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            const vec = vectors[Math.floor(Math.random() * vectors.length)];

            const deformed = deformTrajectory(currentCandidate, currentIndex, vec);
            const fixedResult = fixDeformedTrajectory(currentCandidate, deformed, envData);

            if (fixedResult && fixedResult.path) {
                // The path for this sequence is updated before the next perturbation attempt.
                currentCandidate = fixedResult.path;
            }
        }
        // After the inner loop, add the final multi-perturbed path to our list of candidates.
        candidates.push(currentCandidate);
    }

    // 3. Filter out any candidates that are identical to the original.
    let identicalCount = 0;
    const uniqueCandidates = candidates.filter(c => {
        const isIdentical = JSON.stringify(c) === JSON.stringify(originalPrimary);
        if (isIdentical) identicalCount++;
        return !isIdentical;
    });

    console.log(`Generated ${candidates.length} candidates. Discarded ${identicalCount} identical paths. ${uniqueCandidates.length} remaining.`);

    if (uniqueCandidates.length === 0) {
        console.warn('No unique candidates generated. Returning original path.');
        console.groupEnd();
        return originalPrimary;
    }

    // 4. Score all candidates and store them in an array.
    const scoredCandidates = [];
    console.log('%c--- Scoring Candidates ---', 'color: #28a745');

    for (const [i, candidate] of uniqueCandidates.entries()) {
        const dtwToPrimary = dtw(candidate, originalPrimary);
        const dtwToRival = dtw(candidate, originalRival);
        const holesCandidate = countAdjacentHoles(candidate, envData);
        const holesOriginal = countAdjacentHoles(originalPrimary, envData); // Recalculate for clarity
        const holeDifference = Math.abs(holesOriginal - holesCandidate);
        const holePenalty = holeWeight * holeDifference;

        // If a comparisonTrajectory is provided, calculate an additional DTW.
        // This value should be MAXIMIZED.
        let dtwToOtherGenerated = 0;
        let holeDifferenceTerm = 0;
        if (comparisonTrajectory && comparisonTrajectory.length > 0) {
            dtwToOtherGenerated = dtw(candidate, comparisonTrajectory);
            const holeDifferenceWeight = 1.0; // Weight for hole count difference
            const holesComparison = countAdjacentHoles(comparisonTrajectory, envData);
            holeDifferenceTerm = holeDifferenceWeight * Math.abs(holesCandidate - holesComparison);
        }

        // Add the new distance to the numerator. We give it a weight (e.g., 0.5)
        // to balance its influence with the dtwToRival.
        const comparisonWeight = 0.5;
        // const score = (dtwToRival + (comparisonWeight * dtwToOtherGenerated)) / (dtwToPrimary + holePenalty + 1e-6);
        // console.log(`Candidate #${i}: DTW-self=${dtwToPrimary.toFixed(2)}, DTW-rival=${dtwToRival.toFixed(2)}, DTW-comp=${dtwToOtherGenerated.toFixed(2)}, Score=${score.toFixed(2)}`);

        const score = (dtwToRival + dtwToOtherGenerated + holeDifferenceTerm) / (dtwToPrimary + holePenalty + 1e-6);

        console.log(`Candidate #${i}: DTW-self=${dtwToPrimary.toFixed(2)}, DTW-rival=${dtwToRival.toFixed(2)}, DTW-comp=${dtwToOtherGenerated.toFixed(2)}, HoleDiff=${holeDifferenceTerm.toFixed(2)}, Score=${score.toFixed(2)}`);

        scoredCandidates.push({ candidate, score });
    }

    // 5. Sort the candidates by score in descending order (best first).
    scoredCandidates.sort((a, b) => b.score - a.score);

    // 6. Select the 2nd best option.
    let finalSelection;
    if (scoredCandidates.length > 1) {
        // finalSelection = scoredCandidates[1];
        // console.log(`%cSelected 2nd best candidate with score ${finalSelection.score.toFixed(2)}.`, 'font-weight:bold; color: #20c997;');
        finalSelection = scoredCandidates[0];
        console.log(`%cSelected best candidate with score ${finalSelection.score.toFixed(2)}.`, 'font-weight:bold; color: #20c997;');
    } else {
        finalSelection = scoredCandidates[0];
        console.warn(`%cOnly one unique candidate available. Falling back to the best option with score ${finalSelection.score.toFixed(2)}.`, 'font-weight:bold; color: #fd7e14;');
    }

    console.groupEnd();
    return finalSelection.candidate;
}