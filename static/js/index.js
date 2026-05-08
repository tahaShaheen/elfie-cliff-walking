// --- DOM Elements ---
const pregameForm = document.getElementById('pregame-form');
const formFieldsContainer = document.getElementById('form-fields-container');
const continueButton = document.getElementById('continueToGameButton');
const formTitleElement = document.getElementById('form-title');

let FORM_CONFIG = {};

// --- Functions ---
async function initializePage() {
    await fetchAndCacheUIStrings();
    checkDeviceCompatibility(); // Ensure the device is compatible before proceeding
    
    document.title = getUIString('title', 'form_page');
    if (formTitleElement) formTitleElement.textContent = getUIString('title', 'form_page');
    if (continueButton) continueButton.textContent = getUIString('button_continue', 'form_page');
    await fetchFormConfigAndBuild();
}

async function fetchFormConfigAndBuild() {
    showAppMessage('message-box', getUIString('message_fill_required', 'form_page'), "muted");
    continueButton.disabled = true;
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/form-config`);
        if (!response.ok) {
            throw new Error(`HTTP error fetching form config! Status: ${response.status}`);
        }
        FORM_CONFIG = await response.json();
        if (Object.keys(FORM_CONFIG).length === 0) {
            showAppMessage('message-box', getUIString('error_config_missing', 'form_page'), "error");
            return;
        }
        buildFormFields(FORM_CONFIG);
        showAppMessage('message-box', getUIString('message_fill_required', 'form_page'), "muted");
    } catch (error) {
        console.error("Error fetching or building form config:", error);
        showAppMessage('message-box', `${getUIString('error_submission_failed', 'form_page')} ${error.message}`, "error");
    } finally {
        continueButton.disabled = false;
    }
}

function buildFormFields(config) {
    formFieldsContainer.innerHTML = '';
    if (config.name) addTextField('name', getUIString('label_full_name', 'form_page'), getUIString('placeholder_full_name', 'form_page'), 'text', config.name);
    if (config.user_id_field) addTextField('user_id_field', getUIString('label_user_id', 'form_page'), getUIString('placeholder_user_id', 'form_page'), 'text', config.user_id_field);
    if (config.email) addTextField('email', getUIString('label_email', 'form_page'), getUIString('placeholder_email', 'form_page'), 'email', config.email);
    if (config.phone) addTextField('phone', getUIString('label_phone', 'form_page'), getUIString('placeholder_phone', 'form_page'), 'tel', config.phone);
    if (config.age) addTextField('age', getUIString('label_age', 'form_page'), getUIString('placeholder_age', 'form_page'), 'number', config.age);

    if (config.gender) {
        addRadioGroup('gender', getUIString('label_gender', 'form_page'), [
            { value: 'male', label: getUIString('gender_male', 'form_page') },
            { value: 'female', label: getUIString('gender_female', 'form_page') },
            { value: 'other', label: getUIString('gender_other', 'form_page') },
            { value: 'prefer_not_to_say', label: getUIString('gender_prefer_not_to_say', 'form_page') }
        ], config.gender);
    }

    if (config.familiarity && typeof config.familiarity === 'object') {
        if (config.familiarity.is_played) {
            addCheckboxField('familiarity_is_played', getUIString('label_familiarity_played_before', 'form_page'), 'familiarity_is_played_checkbox');
            if (config.familiarity.level) {
                const levelContainer = document.createElement('div');
                levelContainer.id = 'familiarity_level_container';
                levelContainer.classList.add('form-field', 'hidden');
                addSelectField('familiarity_level', getUIString('label_familiarity_level', 'form_page'), [
                    { value: '', label: getUIString('select_level_placeholder', 'form_page') },
                    { value: 'low', label: getUIString('familiarity_low', 'form_page') },
                    { value: 'medium', label: getUIString('familiarity_medium', 'form_page') },
                    { value: 'high', label: getUIString('familiarity_high', 'form_page') }
                ], config.familiarity.level, levelContainer);
                formFieldsContainer.appendChild(levelContainer);
                const isPlayedCheckbox = formFieldsContainer.querySelector('#familiarity_is_played_checkbox');
                if (isPlayedCheckbox) {
                    isPlayedCheckbox.addEventListener('change', (e) => {
                        const isChecked = e.target.checked;
                        const levelSelectContainer = document.getElementById('familiarity_level_container');
                        const levelSelect = document.getElementById('familiarity_level');
                        if (levelSelectContainer) levelSelectContainer.classList.toggle('hidden', !isChecked);
                        if (levelSelect) {
                            levelSelect.required = isChecked && FORM_CONFIG.familiarity && FORM_CONFIG.familiarity.level === true;
                        }
                    });
                }
            }
        }
    }
}

function addTextField(id, labelText, placeholder, type = 'text', isRequiredByConfig) {
    const fieldDiv = document.createElement('div'); fieldDiv.classList.add('form-field');
    const label = document.createElement('label'); label.htmlFor = id; label.textContent = labelText + (isRequiredByConfig ? '*' : '');
    const input = document.createElement('input'); input.type = type; input.id = id; input.name = id; input.placeholder = placeholder;
    if (isRequiredByConfig) input.required = true;
    if (type === 'number' && id === 'age') { input.min = "0"; input.max = "120"; }
    fieldDiv.appendChild(label); fieldDiv.appendChild(input); formFieldsContainer.appendChild(fieldDiv);
}

function addRadioGroup(id, labelText, options, isRequiredByConfig) {
    const fieldDiv = document.createElement('div'); fieldDiv.classList.add('form-field');
    const legend = document.createElement('legend'); legend.textContent = labelText + (isRequiredByConfig ? '*' : '');
    fieldDiv.appendChild(legend);
    const radioGroupDiv = document.createElement('div'); radioGroupDiv.classList.add('radio-group', 'flex', 'flex-wrap', 'mt-1');
    options.forEach((opt, index) => {
        const wrapper = document.createElement('div'); const input = document.createElement('input');
        input.type = 'radio'; input.id = `${id}_${opt.value}`; input.name = id; input.value = opt.value;
        if (isRequiredByConfig && index === 0) input.required = true;
        const label = document.createElement('label'); label.htmlFor = `${id}_${opt.value}`; label.textContent = opt.label;
        wrapper.appendChild(input); wrapper.appendChild(label); radioGroupDiv.appendChild(wrapper);
    });
    fieldDiv.appendChild(radioGroupDiv); formFieldsContainer.appendChild(fieldDiv);
}

function addSelectField(id, labelText, options, isRequiredByConfig, container = formFieldsContainer) {
    const fieldDiv = document.createElement('div'); fieldDiv.classList.add('form-field');
    const label = document.createElement('label'); label.htmlFor = id; label.textContent = labelText + (isRequiredByConfig ? '*' : '');
    const select = document.createElement('select'); select.id = id; select.name = id;
    if (isRequiredByConfig && id !== 'familiarity_level') {
        select.required = true;
    }
    options.forEach(opt => {
        const optionEl = document.createElement('option'); optionEl.value = opt.value; optionEl.textContent = opt.label;
        select.appendChild(optionEl);
    });
    fieldDiv.appendChild(label); fieldDiv.appendChild(select); container.appendChild(fieldDiv);
}

function addCheckboxField(id, labelText, checkboxId) {
    const fieldDiv = document.createElement('div'); fieldDiv.classList.add('form-field', 'checkbox-group', 'flex', 'items-center');
    const input = document.createElement('input'); input.type = 'checkbox'; input.id = checkboxId; input.name = id;
    const label = document.createElement('label'); label.htmlFor = checkboxId; label.textContent = labelText;
    label.classList.add('ml-2');
    fieldDiv.appendChild(input); fieldDiv.appendChild(label); formFieldsContainer.appendChild(fieldDiv);
}

async function handleFormSubmit(event) {
    event.preventDefault();
    let firstInvalidElement = null;
    const elements = pregameForm.elements;
    for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const isVisible = !(element.offsetWidth === 0 && element.offsetHeight === 0) && !element.closest('.hidden');
        if (element.required && isVisible && !element.checkValidity()) {
            if (!firstInvalidElement) firstInvalidElement = element;
        }
    }
    if (firstInvalidElement) {
        firstInvalidElement.focus();
        showAppMessage('message-box', getUIString('error_missing_fields', 'form_page'), "error");
        return;
    }

    showAppMessage('message-box', getUIString('message_submitting', 'form_page'), "muted");
    continueButton.disabled = true;

    const formData = new FormData(pregameForm);
    const data = {};
    formData.forEach((value, key) => {
        data[key] = value;
    });
    if (!formData.has('familiarity_is_played')) { 
        data['familiarity_is_played'] = false;
        delete data['familiarity_level'];
    } else {
        data['familiarity_is_played'] = true;
    }
    
    try {
        const response = await fetch(`${FLASK_SERVER_URL}/api/submit-user-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            credentials: 'include'
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.error || `HTTP error! Status: ${response.status}`);
        }
        if (result.status === 'info_full') {
            showAppMessage('message-box', result.message, "info"); // Display as an info message
            continueButton.disabled = false; // Re-enable the continue button
            return; // Halt further execution and do not proceed
        }

        showAppMessage('message-box', result.message || getUIString('message_submission_success', 'form_page'), "success");
        setTimeout(() => {
            // This function (which should be in utils.js) gets the next page from the backend.
            navigateToNextTask('message-box'); 
        }, 1500);

    } catch (error) {
        console.error("Error submitting form data:", error);
        showAppMessage('message-box', getUIString('message_fill_required', 'form_page'), "muted");
        showAppMessage('message-box', `${getUIString('error_submission_failed', 'form_page')} ${error.message}`, "error");
        continueButton.disabled = false;
    }
}

// --- Event Listeners & Initial Load ---
pregameForm.addEventListener('submit', handleFormSubmit);
initializePage();