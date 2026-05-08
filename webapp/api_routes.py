# webapp/api_routes.py

from flask import Blueprint, jsonify, request, session
import pandas as pd
import random
import yaml
import json
from datetime import datetime
import os
from sqlalchemy import create_engine, text, inspect
from itertools import permutations

# Import from our new and existing helper modules
from .data_loader import load_game_data
from .server_helpers import parse_map_layout, generate_task_scenarios, save_trial_data, generate_trajectory_from_policy, get_progress_info, create_temp_map, deform_trajectory, fix_deformed_trajectory, _get_current_task_info

from .policy_manager import run_policy_iteration 

# Note: We add a url_prefix so we don't have to type '/api' in every route
api_bp = Blueprint('api', __name__, url_prefix='/api')

USER_GROUPS_YAML_FILE = "user_groups.yaml"
# USER_DATA_FILE and the global user_data_df are no longer needed here.

# The list of tasks to be shuffled for the user flow
TASK_TYPES = ["demonstrations", "comparisons", "corrections", "off"]
# TASK_TYPES = ["comparisons"]

# List of legal instruction groups
ALLOWED_GROUPS = {"group_a1b1", "group_a1b2", "group_a2b1", "group_a2b2"}

def _assign_task_order_from_queue(connection, user_id):
    """
    Gets the next available task order from the queue, prioritizing by
    priority then ID. If the queue is empty, it restocks it with a new
    shuffled batch before assigning.
    """
    # Step 1: Find the next available order.
    find_order_query = text("""
        SELECT id, order_name FROM task_order_queue
        WHERE is_available = TRUE ORDER BY priority DESC, id ASC
        LIMIT 1 FOR UPDATE;
    """) # 'FOR UPDATE' is for PostgreSQL to prevent race conditions

    available_order = connection.execute(find_order_query).fetchone()

    # Step 2: Handle an empty queue by restocking it.
    if not available_order:
        print("INFO: Task order queue is empty. Repopulating with a shuffled list.")
        tasks_to_permute = ['comparisons', 'corrections', 'off']
        base_orders = ["-".join(p) for p in permutations(tasks_to_permute)]
        random.shuffle(base_orders)
        
        insert_query = text("INSERT INTO task_order_queue (order_name, is_available, priority) VALUES (:name, TRUE, 0)")
        for order_name in base_orders:
            connection.execute(insert_query, {"name": order_name})
        
        # Try to get an order again now that the queue is refilled
        available_order = connection.execute(find_order_query).fetchone()

    if not available_order:
        raise Exception("Failed to assign a task order even after repopulating the queue.")

    # Step 3: Assign the found order to the user.
    order_to_assign = available_order.order_name
    update_queue_query = text("""
        UPDATE task_order_queue SET is_available = FALSE, assigned_to_user_id = :user
        WHERE id = :queue_id
    """)
    connection.execute(update_queue_query, {"user": user_id, "queue_id": available_order.id})

    return order_to_assign

def _reclaim_abandoned_groups(engine):
    """
    Finds users who have been 'in_progress' for too long, marks them as 'abandoned',
    and returns their group to the queue. Also ensures the group queue is populated
    if it's empty.
    """
    # Define the timeout period (e.g., 1.5 hours)
    timeout_hours = 1.5
    print("INFO: Checking for abandoned user sessions and queue status...")
    
    try:
        # Establish a single connection for all operations in this function
        with engine.connect() as connection:
            with connection.begin(): # Start a transaction
                # --- Check if group_assignment_queue exists and create if not ---
                inspector = inspect(engine)
                if not inspector.has_table("group_assignment_queue"):
                    print("INFO: 'group_assignment_queue' table not found. Creating it now...")
                    # Dialect-specific SQL for auto-incrementing primary key
                    if engine.dialect.name == 'postgresql':
                        create_table_query = text("""
                            CREATE TABLE group_assignment_queue (
                                id SERIAL PRIMARY KEY,
                                group_name VARCHAR(255) NOT NULL,
                                is_available BOOLEAN DEFAULT TRUE NOT NULL,
                                assigned_to_user_id VARCHAR(255),
                                priority INTEGER DEFAULT 0 NOT NULL
                            );
                        """)
                    else:  # Assuming SQLite otherwise
                        create_table_query = text("""
                            CREATE TABLE group_assignment_queue (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                group_name TEXT NOT NULL,
                                is_available BOOLEAN DEFAULT 1 NOT NULL,
                                assigned_to_user_id TEXT,
                                priority INTEGER DEFAULT 0 NOT NULL
                            );
                        """)
                    connection.execute(create_table_query)
                    print("INFO: 'group_assignment_queue' table created successfully.")
                
                # --- LOGIC TO RECLAIM ABANDONED GROUPS ---
                # This logic is now correctly placed to run on every login.
                
                # Step 1: Find all user_ids that are stale
                find_stale_users_query = text(f"""
                    SELECT user_id FROM user_access
                    WHERE completion_status = 'in_progress'
                    AND first_logged_in < NOW() - INTERVAL '{timeout_hours} hours'
                """)
                stale_users = connection.execute(find_stale_users_query).fetchall()
                stale_user_ids = [user.user_id for user in stale_users]

                if not stale_user_ids:
                    print("INFO: No abandoned sessions found to reclaim.")
                    return
                else:
                    print(f"INFO: Found {len(stale_user_ids)} abandoned session(s): {stale_user_ids}")

                    # Step 2a: Reclaim their TASK ORDER by setting it to available and high priority.
                    reclaim_task_orders_query = text("""
                        UPDATE task_order_queue
                        SET is_available = TRUE, assigned_to_user_id = NULL, priority = 1
                        WHERE assigned_to_user_id IN :user_ids
                    """)
                    connection.execute(reclaim_task_orders_query, {"user_ids": tuple(stale_user_ids)})

                    # Step 2: Return their groups to the queue with high priority
                    reclaim_groups_query = text("""
                        UPDATE group_assignment_queue
                        SET is_available = TRUE, assigned_to_user_id = NULL, priority = 1
                        WHERE assigned_to_user_id IN :user_ids
                    """)
                    connection.execute(reclaim_groups_query, {"user_ids": tuple(stale_user_ids)})

                    # Step 3: Mark the users as 'abandoned'
                    mark_abandoned_query = text("""
                        UPDATE user_access
                        SET completion_status = 'abandoned'
                        WHERE user_id IN :user_ids
                    """)
                    connection.execute(mark_abandoned_query, {"user_ids": tuple(stale_user_ids)})
                    
                    print(f"INFO: Successfully reclaimed groups and task orders for {len(stale_user_ids)} user(s).")
    except Exception as e:
        print(f"ERROR: Automatic group reclamation/population failed: {e}")

def _process_elements_recursively(elements, components):
    """
    Recursively processes a list of instruction elements, resolving all nested
    'include' types.
    """
    if not elements:
        return []

    resolved_elements = []
    for item in elements:
        if item.get('type') == 'include' and item.get('id') in components:
            component_elements = components.get(item['id'], [])
            nested_elements = _process_elements_recursively(
                component_elements, components)
            resolved_elements.extend(nested_elements)
        else:
            resolved_elements.append(item)
    return resolved_elements


@api_bp.route('/all-ui-strings', methods=['GET'])
def get_all_ui_strings():
    game_data = load_game_data()
    return jsonify(game_data.get("ui_strings", {}))


@api_bp.route('/form-config', methods=['GET'])
def get_form_config():
    game_data = load_game_data()
    return jsonify(game_data.get("form_field_config", {}))


@api_bp.route('/submit-user-data', methods=['POST'])
def submit_user_data():
    """
    Endpoint to verify user ID and set up the session.
    This endpoint checks if the user ID exists in either the database or a local YAML file,
    and sets up the session with the appropriate instruction group.
    """
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    user_id = data.get('user_id_field')

    if not user_id:
        return jsonify({"error": "User ID field cannot be empty."}), 400

    instruction_group = None
    shuffled_main_tasks = None
    notes = None 
    completion_status = None
    db_url = os.environ.get('DATABASE_URL')
    
    # Flag to track if we successfully got data from DB
    db_success = False

    # --- CONDITIONAL LOGIC ---
    # If running on Render (DATABASE_URL is set)
    if db_url:
        print("INFO: DATABASE_URL found, connecting to PostgreSQL...")
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)

        try:
            engine = create_engine(db_url)
            _reclaim_abandoned_groups(engine)

            with engine.connect() as connection:
                with connection.begin():

                    # === STEP 2: Get the user's status from the main user table ===
                    user_query = text(
                        "SELECT instruction_group, completion_status, notes FROM user_access WHERE user_id = :user_id"
                    )
                    user = connection.execute(user_query, {"user_id": user_id}).fetchone()

                    if not user:
                        # If DB connects but user is missing, strictly return error (don't fallback to YAML for unknown IDs if DB is live)
                        # NOTE: If you want to allow YAML users even if DB is live but user missing, remove this block.
                        # However, typically if DB is live, we expect users to be there. 
                        # To align with "fallback only on CRASH", we keep this.
                        # But if you want "Try DB, then Try YAML for ID", remove this return. 
                        # For safety, I will assume if DB is active, we rely on it unless it crashes.
                        pass # We will handle "user not found" by falling through or returning error at end.
                    
                    if user:
                        user_status = user.completion_status
                        notes = user.notes

                        # === STEP 3: Enforce login rules ===
                        if user_status in ['completed', 'abandoned', 'in_progress', 'removed']:
                            # removed users have been manually removed by admin and cannot log in again.
                            if user_status in ['in_progress']:
                                # This user logging in again while a previous session was left unfinished.
                                # We will mark the old session as 'abandoned' and reclaim its group.
                                print(f"INFO: User '{user_id}' with 'in_progress' status is logging in again. Abandoning old session.")

                                # Reclaim the group, making it available again with high priority
                                reclaim_group_query = text("""
                                    UPDATE group_assignment_queue
                                    SET is_available = TRUE, assigned_to_user_id = NULL, priority = 1
                                    WHERE assigned_to_user_id = :user_id
                                """)
                                connection.execute(reclaim_group_query, {"user_id": user_id})

                                # Reclaim the task order as well
                                reclaim_task_order_query = text("""
                                    UPDATE task_order_queue
                                    SET is_available = TRUE, assigned_to_user_id = NULL, priority = 1
                                    WHERE assigned_to_user_id = :user_id
                                """)
                                connection.execute(reclaim_task_order_query, {"user_id": user_id})

                                # Mark the user's old session as 'abandoned'
                                mark_abandoned_query = text("""
                                    UPDATE user_access
                                    SET completion_status = 'abandoned'
                                    WHERE user_id = :user_id
                                """)
                                connection.execute(mark_abandoned_query, {"user_id": user_id})

                            # This check now correctly applies only to regular users found in the DB.
                            # Special users with 'special_user_override' status will bypass this.
                            return jsonify({"error": "This User ID has already been used. Each participant can only complete the experiment once."}), 403
                        
                        # Concurrency check to limit active users
                        count_query = text("SELECT COUNT(*) FROM user_access WHERE completion_status = 'in_progress'")
                        in_progress_count = connection.execute(count_query).scalar_one()

                        if in_progress_count >= 5:
                            return jsonify({
                                "status": "info_full",
                                "message": "The study is currently at full capacity. Please try again in a few minutes."
                            }), 200

                        # === STEP 4: Assign a group to a new regular user ===
                        if user_status == 'not_started':
                            # 1. Define the query to get an available group
                            get_group_query = text("""
                                SELECT id, group_name FROM group_assignment_queue
                                WHERE is_available = TRUE ORDER BY priority DESC, id ASC LIMIT 1 FOR UPDATE
                            """)
                            available_group = connection.execute(get_group_query).fetchone()

                            # 2. Handle empty queue by repopulating it
                            if not available_group:
                                print("INFO: Group queue is empty. Repopulating with a shuffled list.")
                                groups = list(ALLOWED_GROUPS)
                                random.shuffle(groups)
                                for group in groups:
                                    repopulate_query = text("INSERT INTO group_assignment_queue (group_name, is_available, priority) VALUES (:group, TRUE, 0)")
                                    connection.execute(repopulate_query, {"group": group})
                                # Try to get a group again now that the queue is refilled
                                available_group = connection.execute(get_group_query).fetchone()

                            # 3. If still no group, it's a server error.
                            if not available_group:
                                raise Exception("Failed to assign a group even after repopulating the queue.")

                            # 4. If a group was found, assign it and update the DB tables
                            group_to_assign = available_group.group_name

                            # Mark group as unavailable in queue
                            update_queue_query = text("UPDATE group_assignment_queue SET is_available = FALSE, assigned_to_user_id = :user_id WHERE id = :queue_id")
                            connection.execute(update_queue_query, {"user_id": user_id, "queue_id": available_group.id})

                            # Update user's main record to 'in_progress' and set their assigned group
                            update_user_query = text("""
                                UPDATE user_access 
                                SET instruction_group = :group, 
                                completion_status = 'in_progress', 
                                first_logged_in = NOW()
                                WHERE user_id = :user_id
                            """)
                            connection.execute(update_user_query, {"group": group_to_assign, "user_id": user_id})

                            # The group for the session is the one we just assigned
                            instruction_group = group_to_assign

                            assigned_order_str = _assign_task_order_from_queue(connection, user_id)
                            print(f"INFO: Assigned task order for user '{user_id}' from queue: {assigned_order_str}")

                            # The final task, "demonstrations", is always last
                            shuffled_main_tasks = assigned_order_str.split('-') + ["demonstrations"]
                        
                        else:
                            # For special users (test, psych) who can log in multiple times,
                            # assign their instruction group directly from their database record.
                            instruction_group = user.instruction_group

                            main_tasks_to_shuffle = [t for t in TASK_TYPES if t != "demonstrations"]
                            random.shuffle(main_tasks_to_shuffle)
                            shuffled_main_tasks = main_tasks_to_shuffle + ["demonstrations"] # <-- Demonstration #2 (Main task) is last

                        # === STEP 6: Final session setup (for all valid logins) ===
                        session.clear()
                        session['is_psych_user'] = (user.notes == 'psych')
                        session['instruction_group'] = instruction_group
                        
                        # Mark DB success so we skip YAML
                        db_success = True

        except Exception as e:
            # CHANGED: Instead of returning 500, we log the error and set db_success to False
            # so it falls through to the YAML logic.
            print(f"WARNING: Database connection failed ({e}). Falling back to local YAML.")
            db_success = False

    # Else, if running locally (DATABASE_URL is not set) OR if DB connection failed
    if not db_success:
        # The local YAML logic will also be updated if you structure your YAML to include notes
        print("INFO: Using fallback strategy (user_groups.yaml)...")
        try:
            with open(USER_GROUPS_YAML_FILE, 'r') as f:
                user_groups_from_file = yaml.safe_load(f) or []

            user_data = None
            
            # CHECK 1: If YAML is a LIST (as provided in your file)
            if isinstance(user_groups_from_file, list):
                # We must iterate to find the matching user_id
                for entry in user_groups_from_file:
                    if str(entry.get('user_id')) == str(user_id):
                        user_data = entry
                        break
            
            # CHECK 2: If YAML is a DICT (old legacy format support)
            elif isinstance(user_groups_from_file, dict):
                 user_data = user_groups_from_file.get(user_id)
            
            # Extract data if user found
            if user_data:
                if isinstance(user_data, dict):
                    instruction_group = user_data.get('instruction_group') or user_data.get('group')
                    notes = user_data.get('notes')
                    completion_status = user_data.get('completion_status')
                elif isinstance(user_data, str): # Legacy format: user: group_str
                    instruction_group = user_data

            # Since the DB queue logic didn't run, we must generate a random shuffle here
            if instruction_group:
                 print(f"INFO: Generating local shuffle for user {user_id}")
                 main_tasks_to_shuffle = [t for t in TASK_TYPES if t != "demonstrations"]
                 random.shuffle(main_tasks_to_shuffle)
                 shuffled_main_tasks = main_tasks_to_shuffle + ["demonstrations"]

        except Exception as e:
            print(f"ERROR: Failed to read or parse YAML file: {e}")
            # We return JSON error here instead of crashing so frontend doesn't get HTML
            return jsonify({"error": "Server configuration error (YAML load failed)."}), 500

    # --- COMMON LOGIC ---
    # If no instruction_group was found by either method, the user is invalid.
    if not instruction_group:
        return jsonify({"error": "Invalid User ID provided."}), 403
    
    if instruction_group not in ALLOWED_GROUPS:
        error_message = "User ID assigned to invalid group. Please contact the researcher."
        print(f"FATAL: User '{user_id}' has invalid group '{instruction_group}'.")
        # You can add email sending logic here if desired.
        # For now, we return the error to the frontend.
        return jsonify({"error": error_message}), 403

    # If we found a group, proceed with setting up the session.
    print(
        f"SUCCESS: User '{user_id}' verified for group '{instruction_group}'.")
    session.clear()

    session['is_testing_user'] = (completion_status == 'testing')
    if session['is_testing_user']:
        print(f"INFO: User '{user_id}' identified as TESTING user. Errors will be suppressed.")

    # is_psych_user = (notes == 'psych') # Old logic

    # New logic: Any notes field starting with 'psych' indicates a psych user. This notes field includes SONA IDs now.
    is_psych_user = (notes and notes.startswith('psych'))

    # Extract and store the Sona ID separately
    if is_psych_user:
        try:
            session['sona_id'] = notes.split('_')[1]
        except IndexError:
            return jsonify({"error": "Invalid SONA ID format."}), 403
    else:
        session['sona_id'] = None


    session['is_psych_user'] = is_psych_user
    print(f"INFO: User '{user_id}' is_psych_user status set to: {is_psych_user}")

    session['instruction_group'] = instruction_group
    session['trial_counters'] = {
        'demonstration': 0, 'comparison': 0, 'off_intervention': 0, 'correction': 0,
        'free_form_description': 0
        }
    session['pending_form_data'] = {'user_id_field': user_id, 'instruction_group': session['instruction_group'],
                                    'form_submission_time': datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    session['form_completed'] = True

    game_data = load_game_data()
    all_envs = list(game_data.get("environments", {}).keys())

    # Define the unique ID for the single practice map
    practice_map_id = 'practice_env'

    # Create the list of main game maps by excluding the practice map.
    # This list will contain your 20 main maps.
    main_game_maps = [env_id for env_id in all_envs if env_id != practice_map_id]

    # Shuffle this list once for the user's entire session
    random.shuffle(main_game_maps)

    print(f"INFO: Shuffled map sequence for user '{user_id}': {main_game_maps}")

    # # Pre-allocate maps for demonstration tasks to ensure consistency
    # game_data = load_game_data()
    # print("DEBUG (task_config):", json.dumps(game_data.get("task_config"), indent=2))
    
    # num_demo_maps = game_data.get("task_config", {}).get("num_demonstrations", 1)
    # session['demonstration_maps'] = main_game_maps[:num_demo_maps]
    
    # # The remaining maps are used for other tasks
    # remaining_maps = main_game_maps[num_demo_maps:]

    # # Store the remaining shuffled sequence and a starting pointer in the session
    # session['shuffled_map_sequence'] = remaining_maps
    # session['map_sequence_index'] = 0

    # Pre-allocate a dedicated set of maps for each task type at login.
    game_data = load_game_data()
    task_config = game_data.get("task_config", {})
    map_pool = list(main_game_maps)

    task_map_allocations = {}
    map_pool_idx = 0

    # This dictionary now maps the singular task_type to the plural key in config.yaml
    task_map_config = {
        "demonstration": "num_demonstrations",
        "comparison": "num_comparisons",
        "correction": "num_corrections",
        "off": "num_offs"
    }

    # Allocate a SINGLE set of 5 maps to be shared by both demonstration tasks.
    num_demos = task_config.get(task_map_config["demonstration"], 0)
    demonstration_maps = map_pool[map_pool_idx : map_pool_idx + num_demos]
    map_pool_idx += num_demos  # IMPORTANT: Only advance the index once.

    # Assign the SAME list of maps to both keys. They will be shuffled independently later.
    task_map_allocations['demonstration_pre'] = demonstration_maps
    task_map_allocations['demonstration_main'] = demonstration_maps

    # Pre-allocate for all other main tasks using their singular keys
    for task_key in ["comparison", "correction", "off"]:
        num_maps = task_config.get(task_map_config[task_key], 0)
        task_map_allocations[task_key] = map_pool[map_pool_idx : map_pool_idx + num_maps]
        map_pool_idx += num_maps

    # Store the correctly keyed dictionary in the session.
    session['task_map_allocations'] = task_map_allocations
    print("DEBUG (task_map_allocations):", json.dumps(task_map_allocations, indent=2))

    # 1. The introductory sequence is defined in its own list.
    intro_sequence = [
        'free_form_question.html',
        'plan_vs_execution.html',
        'manipulation_check.html?task=pre', # pre check
        'instructions.html?task=demonstrations_pre',
        'demonstrations.html?task=pre', # <-- Demonstration #1 (Pre-task)
        'instructions.html',
        'manipulation_check.html' # post belief update check
    ]

    # 3. The pages for the main tasks are generated.
    main_tasks_sequence = []
    
    # Ensure shuffled_main_tasks exists (it should by now from either DB or YAML)
    if not shuffled_main_tasks:
        # Final safety fallback just in case
        main_tasks_to_shuffle = [t for t in TASK_TYPES if t != "demonstrations"]
        random.shuffle(main_tasks_to_shuffle)
        shuffled_main_tasks = main_tasks_to_shuffle + ["demonstrations"]

    for task_type in shuffled_main_tasks:
        main_tasks_sequence.append(f'instructions.html?task={task_type}')
        main_tasks_sequence.append(f'{task_type}.html')

    # 4. The final flow is created by combining the two lists in the correct order.
    full_task_flow = intro_sequence + main_tasks_sequence

    print(full_task_flow)

    session['task_flow_sequence'] = full_task_flow
    session['current_task_index'] = 0
    session.modified = True

    return jsonify({"message": "User ID verified successfully!"}), 200

@api_bp.route('/manipulation-check-setup', methods=['GET'])
def manipulation_check_setup():
    """Provides the content and correct answers for the manipulation check page."""
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403

    # 1. Read the new 'task' parameter from the request URL.
    task_type = request.args.get('task', 'main')

    game_data = load_game_data()
    instruction_group = session.get('instruction_group', 'group_a1b1')

    # 2. Select the instruction key based on the task type.
    instruction_key = (
        'manipulation_check_instructions_pre'
        if task_type == 'pre'
        else 'manipulation_check_instructions'
    )
    all_instructions = game_data.get(instruction_key, {})

    # The rest of the function works as before, loading the selected content.
    instructions_to_send = all_instructions.get(instruction_group, {})

    if not instructions_to_send:
        return jsonify({"error": f"Manipulation check configuration for '{instruction_key}' not found."}), 404

    # Recursively process includes
    final_instructions = instructions_to_send.copy()
    instruction_components = game_data.get('instruction_components', {})
    original_elements = final_instructions.get('elements', [])
    final_instructions['elements'] = _process_elements_recursively(
        original_elements, instruction_components)

    if session.get('is_psych_user', False):
        elements = final_instructions.get('elements', [])
        for el in elements:
            if el.get('type') == 'emphasis_box' and "Comprehension Check" in el.get('title', ''):
                # This finds the comprehension check box and removes the specific line about payment
                items = el.get('items', [])
                el['items'] = [item for item in items if "You will be paid" not in item]
                break # Stop after finding and modifying the box

    # --- Shuffle questions ---
    all_elements = final_instructions['elements']

    # Find where the questions start. They follow the "Comprehension Check" box.
    start_index = -1
    for i, element in enumerate(all_elements):
        if element.get('type') == 'emphasis_box' and "Comprehension Check" in element.get('title', ''):
            start_index = i + 1
            break

    if start_index != -1 and start_index < len(all_elements):
        intro_elements = all_elements[:start_index]
        question_elements_raw = all_elements[start_index:]

        # Group elements into question blocks (each block starts with 'new_card')
        question_blocks = []
        current_block = []
        if question_elements_raw:
            for element in question_elements_raw:
                if element.get('type') == 'new_card' and current_block:
                    question_blocks.append(current_block)
                    current_block = []
                current_block.append(element)
            if current_block:
                question_blocks.append(current_block)

        # Randomize the order of the question blocks
        random.shuffle(question_blocks)

        # Rebuild the list, re-numbering headers
        shuffled_question_elements = []
        for i, block in enumerate(question_blocks, 1):
            for element in block:
                if element.get('type') == 'section_header' and 'Question' in element.get('content', ''):
                    parts = element['content'].split(':', 1)
                    if len(parts) == 2:
                        element['content'] = f"Question {i}:{parts[1]}"
                    break  # Header found and updated
            shuffled_question_elements.extend(block)
        
        final_instructions['elements'] = intro_elements + shuffled_question_elements

    # Determine the correct answers based on the user's group
    is_belief_slippery_group = 'a2' in instruction_group
    is_ground_truth_slippery_group = 'b2' in instruction_group

    # correct_answers = {
    #     'slippery_outcome_q': "She might **slip and fall**." if is_slippery_group else "She would be **completely safe**.",
    #     'slippery_outcome_q_2': "She would be **completely safe**.",
    #     'execution_q': "**No**, the games are only for planning. During the mini-games, Elfie will not follow those plans.",
    #     'what_is_task_q': "To act as a **planner** and help create the best possible plans for Elfie."
    # }

    correct_answers = {
        'slippery_outcome_q': [4, 5] if is_belief_slippery_group else [1, 2],
        'slippery_outcome_q_2': [1, 2],
        'execution_q': [4, 5],      # Correct Answer: Agree (Elfie does NOT move)
        'what_is_task_q': [1, 2]       # Correct Answer: Disagree (The user IS NOT an observer)
    }

    # critical_questions = [
    #     "execution_q",
    #     "what_is_task_q"
    # ]

    critical_questions = []

    if task_type == 'pre':

        # Changing the correct answers based on the user's group (in pre it is based on ground truth)
        correct_answers['slippery_outcome_q'] = [4, 5] if is_ground_truth_slippery_group else [1, 2]
        
        # For the first check, these questions are critical
        critical_questions = [
            "execution_q",
            "what_is_task_q"
            ]
    else:
        # For the "post" check, remove the answers for the questions that are not displayed.
        del correct_answers['execution_q']
        del correct_answers['what_is_task_q']

    final_instructions['critical_questions'] = critical_questions

    final_instructions['correct_answers'] = correct_answers
    final_instructions['progress_info'] = get_progress_info(session)
    final_instructions['user_group'] = instruction_group

    return jsonify(final_instructions)

@api_bp.route('/check-form-status', methods=['GET'])
def check_form_status():
    return jsonify({
        "form_completed": session.get('form_completed', False),
        "instruction_group": session.get('instruction_group', 'a1')
    })

@api_bp.route('/submit-manipulation-check-data', methods=['POST'])
def submit_manipulation_check_data():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    payload = request.get_json() # The payload now contains 'errors' and 'responses'

    # Determine if this is the "pre" manipulation check
    task_flow = session.get('task_flow_sequence', [])
    current_idx = session.get('current_task_index', 0)
    is_pre_task = False

    # The first check is the one that immediately follows 'plan_vs_execution.html'.
    # We check the page at index-2 because current_idx points to the *next* task.
    if current_idx > 1 and task_flow[current_idx - 2] == 'plan_vs_execution.html':
        is_pre_task = True

    feedback_type = 'manipulation_check_pre' if is_pre_task else 'manipulation_check'

    def mapper(trial_data):
        # trial_data is the full payload from the frontend
        return {
            # Save the error counters
            'manipulation_check_errors': json.dumps(trial_data.get('errors', {})),
            # Save the actual user responses to a different column
            'manipulation_check_responses': json.dumps(trial_data.get('responses', {}))
        }

    # Uses the helper to suppress errors if testing
    return jsonify(*_attempt_save_data(session, [payload], feedback_type, mapper))


@api_bp.route('/get-next-task', methods=['POST'])
def get_next_task():
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    current_task_idx = session.get('current_task_index', 0)
    task_flow = session.get('task_flow_sequence', [])
    if current_task_idx < len(task_flow):
        next_task_url = task_flow[current_task_idx]
    else:
        next_task_url = 'thank_you.html'
    session['current_task_index'] = current_task_idx + 1
    session.modified = True
    return jsonify({"next_task_url": next_task_url})


@api_bp.route('/instructions', methods=['GET'])
def get_instructions():
    task_type = request.args.get('task', 'main')
    game_data = load_game_data()
    instruction_group = session.get('instruction_group')

    instruction_key_map = {
        'main': 'main_instructions',
        'demonstrations': 'demonstrations_task_instructions',
        'demonstrations_pre': 'demonstrations_task_instructions_pre',
        'comparisons': 'comparisons_task_instructions',
        'corrections': 'corrections_task_instructions',
        'off': 'off_task_instructions',
        'plan_vs_execution': 'plan_vs_execution_instructions',
    }
    instructions_source = game_data.get(
        instruction_key_map.get(task_type, 'main_instructions'), {})

# Check if the loaded instruction data is generic (has 'elements' at the top level)
    if 'elements' in instructions_source:
        instructions_to_send = instructions_source
    # Otherwise, use the existing logic to find the data based on the user's group
    elif not instruction_group or instruction_group not in instructions_source:
        default_group_key = next(iter(instructions_source), None)
        instructions_to_send = instructions_source.get(
            default_group_key, {}) if default_group_key else {}
    else:
        instructions_to_send = instructions_source.get(instruction_group, {})

    if not instructions_to_send:
        return jsonify({"error": "Instruction data is empty."}), 404

    final_instructions = instructions_to_send.copy()
    instruction_components = game_data.get('instruction_components', {})
    original_elements = final_instructions.get('elements', [])
    final_instructions['elements'] = _process_elements_recursively(
        original_elements, instruction_components)

    if session.get('is_psych_user', False):
        elements = final_instructions.get('elements', [])
        # This removes the "Payment is contingent on" box by its title
        final_instructions['elements'] = [
            el for el in elements if 'Payment is contingent on' not in el.get('title', '')
        ]
    
    # Logic to identify if this is the user's third mini-game
    is_third_game = False
    if task_type != 'main':
        task_flow = session.get('task_flow_sequence', [])
        main_task_pages = [
            p for p in task_flow if p.endswith('.html') and p not in [
                'index.html', 'instructions.html',
                'thank_you.html', 'free_form_question.html',
                'plan_vs_execution.html'
            ]
        ]
        current_task_page_name = f"{task_type}.html"
        try:
            task_index = main_task_pages.index(current_task_page_name)
            if task_index == 2:  # 0-indexed, so 2 is the third game
                is_third_game = True
        except ValueError:
            pass

    if is_third_game:
        elements = final_instructions['elements']
        divider_index_to_remove = -1  # Use -1 to indicate nothing found yet

        for i, element in enumerate(elements):
            # Heuristic to find the "Remember!" card
            if element.get('type') == 'new_card' and (i + 1) < len(elements):
                # The element right after 'new_card' should be our divider
                divider_candidate_index = i + 1
                if elements[divider_candidate_index].get('type') == 'divider':
                    # And the element after the divider should be the 'Remember!' box
                    if (divider_candidate_index + 1) < len(elements):
                        next_element = elements[divider_candidate_index + 1]
                        if (next_element.get('type') == 'emphasis_box' and
                                'Remember!' in next_element.get('title', '')):
                            
                            # Match found!
                            # 1. Change the card's visibility
                            element['display_mode'] = 'main_only'
                            
                            # 2. Mark the divider's index for removal
                            divider_index_to_remove = divider_candidate_index
                            
                            # 3. Stop searching
                            break

        # After the loop, if we marked a divider, remove it from the list
        if divider_index_to_remove != -1:
            del elements[divider_index_to_remove]

    if task_type == 'demonstrations_pre':
        elements = final_instructions.get('elements', [])
        # Find the 'new_card' element that introduces the "Remember!" box
        for i in range(len(elements) - 1):
            # Check if the current element is a 'new_card' and the next one is the 'Remember!' box
            # (or a divider before it)
            if elements[i].get('type') == 'new_card':
                # Look ahead to see if the 'Remember!' box is in this card's content
                next_element_index = i + 1
                # Skip over an optional divider
                if elements[next_element_index].get('type') == 'divider':
                    next_element_index += 1
                
                if next_element_index < len(elements):
                    next_element = elements[next_element_index]
                    if (next_element.get('type') == 'emphasis_box' and 
                        'Remember!' in next_element.get('title', '')):
                        
                        # Mark this card to be hidden in the collapsible view
                        elements[i]['display_mode'] = 'main_only'
                        break # Found it, stop searching

    if task_type != 'main':
        task_flow = session.get('task_flow_sequence', [])
        
        # Filter the flow to only include the main task pages we want to count
        main_task_pages = [
            p for p in task_flow
            if p in ["demonstrations.html", "comparisons.html", "corrections.html", "off.html"]
        ]

        
        total_tasks = len(main_task_pages)
        current_task_page_name = f"{task_type}.html"

        task_info = _get_current_task_info(session)
        if task_info['current_num'] > 0:
            final_instructions['total_tasks'] = task_info['total_num']
            final_instructions['current_task_num'] = task_info['current_num']
    
    # Add progress info to the instructions
    final_instructions['progress_info'] = get_progress_info(session)

    # Determine the next task to inform the frontend button text
    current_task_idx = session.get('current_task_index', 0)
    task_flow = session.get('task_flow_sequence', [])
    next_task_url = 'thank_you.html' # Default
    if current_task_idx < len(task_flow):
        next_task_url = task_flow[current_task_idx]
    final_instructions['next_task_url'] = next_task_url

    # Include the user's group so the frontend knows which visuals to display.
    final_instructions['user_group'] = session.get('instruction_group')

    return jsonify(final_instructions)

@api_bp.route('/free-form-question-setup', methods=['GET'])
def free_form_question_setup():
    """
    Provides the configuration for the free-form question page,
    with the stable/slippery sections served in a random order.
    """
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    
    game_data = load_game_data()
    instruction_group = session.get('instruction_group', 'group_a1b1')
    
    all_configs = game_data.get("free_form_question_config", {})
    config = all_configs.get('default')

    if not config:
        return jsonify({"error": "The 'default' free-form question configuration was not found."}), 404
    
    # --- NEW RANDOMIZATION LOGIC ---
    elements = config.get('elements', [])
    
    # 1. Define the component IDs that we want to shuffle
    shufflable_ids = {"ffq_stable_section", "ffq_slippery_section"}

    # 2. Separate the static elements from the shufflable ones
    static_elements = []
    shufflable_elements = []
    for el in elements:
        if el.get('type') == 'include' and el.get('id') in shufflable_ids:
            shufflable_elements.append(el)
        else:
            static_elements.append(el)

    # 3. Shuffle the list of components
    random.shuffle(shufflable_elements)

    # 4. Recombine the lists and update the config for this request
    config['elements'] = static_elements + shufflable_elements
    # --- END OF NEW LOGIC ---

    # The existing recursive function will now expand the shuffled includes
    final_elements = _process_elements_recursively(
        config.get('elements', []),
        game_data.get('instruction_components', {})
    )

    # The rest of the function continues as before...
    if session.get('is_psych_user', False):
        final_elements = [el for el in final_elements if 'Payment is contingent on' not in el.get('title', '')]

    config['elements'] = final_elements

    response_data = config.copy()
    response_data['user_group'] = instruction_group
    response_data['progress_info'] = get_progress_info(session)

    return jsonify(response_data)

# --- TASK SETUP ROUTES ---
# These routes remain unchanged.
@api_bp.route('/demonstration-setup', methods=['GET'])
def demonstration_setup():
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403

    # Check if the previous page was plan_vs_execution, indicating the pre-task
    task_flow = session.get('task_flow_sequence', [])
    current_idx = session.get('current_task_index', 0)
    
    # The current page is at index - 1 of the upcoming task index
    current_page_url = task_flow[current_idx - 1] if current_idx > 0 else ""
    is_pre_task = 'task=pre' in current_page_url

    game_data = load_game_data()
    # return jsonify(generate_task_scenarios(game_data, 'demonstration', session, len(TASK_TYPES)))
    response_data = generate_task_scenarios(game_data, 'demonstration', session, len(TASK_TYPES))
    response_data['is_pre_task'] = is_pre_task
    response_data['progress_info'] = get_progress_info(session)
    return jsonify(response_data)


@api_bp.route('/comparison-setup', methods=['GET'])
def comparison_setup():
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    game_data = load_game_data()
    # return jsonify(generate_task_scenarios(game_data, 'comparison', session, len(TASK_TYPES)))
    response_data = generate_task_scenarios(game_data, 'comparison', session, len(TASK_TYPES))
    response_data['progress_info'] = get_progress_info(session)
    return jsonify(response_data)


@api_bp.route('/corrections-setup', methods=['GET'])
def corrections_setup():
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    game_data = load_game_data()
    
    # First, generate the scenarios as before
    response_data = generate_task_scenarios(game_data, 'correction', session, len(TASK_TYPES))
    
    # Now, get the animation speed from the loaded config data
    animation_speed = game_data.get("task_config", {}).get("correction_animation_speed")
    
    # Add the speed to the data we send to the frontend
    if animation_speed:
        response_data['animation_speed'] = animation_speed
        
    response_data['progress_info'] = get_progress_info(session)

    return jsonify(response_data)


@api_bp.route('/off-setup', methods=['GET'])
def off_setup():
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    game_data = load_game_data()
    # return jsonify(generate_task_scenarios(game_data, 'off', session, len(TASK_TYPES)))
    response_data = generate_task_scenarios(game_data, 'off', session, len(TASK_TYPES))
    response_data['progress_info'] = get_progress_info(session)
    return jsonify(response_data)


@api_bp.route('/recalculate-trajectory', methods=['POST'])
def recalculate_trajectory():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json()
    env_id, new_start_state, policy_type = data.get(
        'env_id'), data.get('new_start_state'), data.get('policy_type')

    if not all([env_id, new_start_state, policy_type]):
        return jsonify({"error": "Missing 'env_id', 'new_start_state', or 'policy_type'"}), 400

    game_data = load_game_data()
    env_data = game_data.get("environments", {}).get(env_id)
    if not env_data:
        return jsonify({"error": "Environment not found"}), 404

    policy_key = 'policy_group_b2' if policy_type == 'slippery' else 'policy_group_b1'
    policy_str = env_data.get(policy_key)
    if not policy_str:
        return jsonify({"error": f"Policy '{policy_key}' not found for env {env_id}"}), 500

    try:
        policy = json.loads(policy_str)

        parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
        rows = parsed_map_layout['grid_rows']
        cols = parsed_map_layout['grid_cols']
        goal = parsed_map_layout['goal_state']

        new_trajectory = generate_trajectory_from_policy(
            policy, rows, cols, new_start_state, goal)
        return jsonify({"new_trajectory_segment": new_trajectory[1:]})
    except Exception as e:
        return jsonify({"error": "Failed to recalculate trajectory."}), 500

@api_bp.route('/retrain-and-replan', methods=['POST'])
def retrain_and_replan():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    env_id = data.get('env_id')
    policy_type = data.get('policy_type')
    temp_x_states = data.get('temp_x_states', [])
    temp_y_states = data.get('temp_y_states', [])
    temp_o_states = data.get('temp_o_states', [])

    # --- FIX 1: Correct the validation check ---
    # The original check failed if a list was empty. This is now correct.
    if not env_id or not policy_type:
        return jsonify({"error": "Missing required data 'env_id' or 'policy_type'."}), 400

    try:
        game_data = load_game_data()
        env_data = game_data.get("environments", {}).get(env_id)
        if not env_data:
            return jsonify({"error": "Environment not found"}), 404

        original_map = env_data.get("map_layout")

        # --- FIX 2: Remove redundant and incorrect code ---
        # The create_temp_map helper already returns the final string list.
        # The lines that tried to modify the map again have been removed.
        modified_map_str = create_temp_map(original_map, temp_x_states, temp_y_states, temp_o_states)

        policy_config = game_data.get('policy_generation_config', {})
        is_slippery = (policy_type == 'slippery')
        new_policy = run_policy_iteration(
            cliff_map=modified_map_str,
            slippery=is_slippery,
            discount_factor=policy_config.get('DISCOUNT_FACTOR', 0.9),
            probability_denominator=policy_config.get('PROBABILITY_DENOMINATOR', 3),
            rewards=policy_config.get('REWARDS', [-10, 0, -1, -1, -1]),
            print_converged_message=True 
        )

        # Generate a new trajectory from the start state using the new policy
        parsed_map = parse_map_layout(original_map)
        rows, cols, start, goal = parsed_map['grid_rows'], parsed_map['grid_cols'], parsed_map['start_state'], parsed_map['goal_state']
        new_trajectory = generate_trajectory_from_policy(new_policy, rows, cols, start, goal)

        return jsonify({"new_trajectory": new_trajectory})

    except Exception as e:
        print(f"ERROR in /retrain-and-replan: {e}")
        import traceback
        traceback.print_exc() # Adds more detailed error logging
        return jsonify({"error": "Failed to retrain policy and generate new path."}), 500

@api_bp.route('/deform-and-fix-trajectory', methods=['POST'])
def deform_and_fix_trajectory_route():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    data = request.get_json()
    trajectory = data.get('trajectory')
    # print(f'\033[92mReceived trajectory: {trajectory}\033[92m')  # Debugging line
    # print(f'Length of trajectory: {len(trajectory)}')  # Debugging line
    correction_index = data.get('correctionIndex')
    # print(f'Received correction index: {correction_index}')  # Debugging line
    correction_vector = data.get('correctionVector')
    # print(f'Received correction vector: {correction_vector}')  # Debugging line
    env_id = data.get('env_id')

    if not all([trajectory, isinstance(correction_index, int), correction_vector, env_id]):
        return jsonify({"error": "Missing required data"}), 400

    game_data = load_game_data()
    env_data = game_data.get("environments", {}).get(env_id)
    if not env_data:
        return jsonify({"error": "Environment not found"}), 404

    # Deform the trajectory smoothly
    deformed_traj = deform_trajectory(trajectory=trajectory, correction_index=correction_index, correction_vector=correction_vector, sigma=3)
    # deformed_traj = deform_trajectory_local(trajectory, correction_index, correction_vector, window_size=5)
    if not deformed_traj:
        return jsonify({"error": "Failed to deform trajectory"}), 500

    # print(f'\033[92mDeformed trajectory: {deformed_traj}\033[92m')  # Debugging line

    # Fix the trajectory to snap to the grid and avoid obstacles
    parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
    fixed_traj = fix_deformed_trajectory(
        original_trajectory=trajectory,
        deformed_trajectory=deformed_traj,
        env_data=parsed_map_layout,
        correction_vector=correction_vector)

    # print(f'\033[92mFixed trajectory: {fixed_traj}\033[92m')  # Debugging line

    if not fixed_traj:
        # If fixing fails (e.g., path goes through a wall), fall back to full replanning
        print("Deformation fixing failed. Falling back to server-side replanning.")
        # This part reuses your existing logic as a robust fallback
        # It's simplified here for clarity
        return jsonify({"error": "Could not generate a valid path for this correction. Please try a different correction."}), 500

    return jsonify({"new_trajectory": fixed_traj})

@api_bp.route('/generate-instructional-trajectory', methods=['POST'])
def generate_instructional_trajectory():
    """
    Generates a trajectory for an instructional example based on a policy.
    IMPORTANT: This function will return a trajectory based on whether the user's BELIEF should agree or disagree with the GROUND TRUTH.
    This will not give you the trajectory for A POLICY to compare it to another trajectory and calculate some distance measure.
    """
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    env_id = data.get('env_id')
    instruction_group = data.get('instruction_group')
    path_style = data.get('path_style', 'demonstration')  # Default to 'demonstration'
    intermediate_goal = data.get('intermediate_goal') # for demonstrations
    intervention_points = data.get('intervention_points') # for off interventions
    policy_type_request = data.get('policy_type_request')

    # The validation checks for the required fields
    if not all([env_id, instruction_group, policy_type_request]):
        return jsonify({"error": "Missing required data for instructional trajectory."}), 400

    try:
        game_data = load_game_data()
        env_data = game_data.get("environments", {}).get(env_id)
        if not env_data:
            return jsonify({"error": f"Environment '{env_id}' not found."}), 404

        # Determine which policy to use based on the request
        is_user_in_slippery_group = 'a2' in instruction_group

        if policy_type_request == 'match':
            # Match the user's group: a2 -> slippery, a1 -> stable
            use_slippery_policy = is_user_in_slippery_group
        elif policy_type_request == 'mismatch':
            # Mismatch the user's group: a2 -> stable, a1 -> slippery
            use_slippery_policy = not is_user_in_slippery_group
        else:
            # Default or fallback case
            use_slippery_policy = False
        
        policy_key = 'policy_group_b2' if use_slippery_policy else 'policy_group_b1'
        
        policy_str = env_data.get(policy_key)
        if not policy_str:
            return jsonify({"error": f"Policy key '{policy_key}' not found for env '{env_id}'."}), 404

        policy = json.loads(policy_str)
        
        # Parse the map to get dimensions and the real start state
        parsed_map = parse_map_layout(env_data.get("map_layout"))
        start_state = parsed_map['start_state']
        rows = parsed_map['grid_rows']
        cols = parsed_map['grid_cols']
        goal_state = parsed_map['goal_state']
        policy_config = game_data.get('policy_generation_config', {})
        
        if path_style == 'off':
            if intervention_points and isinstance(intervention_points, list):
                try:
                    # Start with the trajectory from the base policy
                    current_trajectory = generate_trajectory_from_policy(policy, rows, cols, start_state, goal_state)
                    
                    accumulated_obstacles = []
                    last_split_index = 0 # This will be the final index for styling

                    # --- ITERATIVE PROCESSING LOGIC ---
                    for point_to_add in intervention_points:
                        accumulated_obstacles.append(point_to_add)

                        try:
                            # Find where the new obstacle lies on the *current* path
                            split_index = current_trajectory.index(point_to_add)
                        except ValueError:
                            # The point is not on the current path, which can happen if a
                            # previous intervention already routed the path away from it.
                            # We keep the obstacle and continue to the next iteration.
                            continue

                        # Preserve the path up to the point of intervention
                        preserved_path = current_trajectory[:split_index]
                        replan_start_node = preserved_path[-1] if preserved_path else start_state
                        
                        # The split index for the *last* point is what we'll return for styling
                        last_split_index = len(preserved_path)

                        # Retrain the policy with ALL accumulated obstacles so far
                        policy_config = game_data.get('policy_generation_config', {})
                        modified_map_str = create_temp_map(env_data.get("map_layout"), [], [], accumulated_obstacles)
                        
                        new_policy = run_policy_iteration(
                            cliff_map=modified_map_str,
                            slippery=('b2' in policy_key),
                            discount_factor=policy_config.get('DISCOUNT_FACTOR', 0.9),
                            probability_denominator=policy_config.get('PROBABILITY_DENOMINATOR', 3),
                            rewards=policy_config.get('REWARDS', [-10, 0, -1, -1, -1])
                        )
                        
                        # Generate the new path segment from the end of the preserved path
                        new_segment = generate_trajectory_from_policy(new_policy, rows, cols, replan_start_node, goal_state)
                        
                        # Update the current_trajectory for the next iteration of the loop
                        current_trajectory = preserved_path + (new_segment[1:] if new_segment and len(new_segment) > 1 else [])

                    # After the loop, current_trajectory is the final, fully modified path
                    return jsonify({
                        "trajectory": current_trajectory,
                        "intervention_index": last_split_index
                    })

                except Exception as e:
                    print(f"ERROR in 'off' task instruction generation: {e}")
                    import traceback
                    traceback.print_exc()
                    return jsonify({"error": "Failed to generate 'off' task instruction"}), 500
            else:
                # No intervention points, so return the full, unmodified trajectory.
                full_trajectory = generate_trajectory_from_policy(policy, rows, cols, start_state, goal_state)
                return jsonify({"trajectory": full_trajectory, "intervention_index": 0})

        elif path_style in ['demonstration', 'comparison', 'correction_initial', 'correction_final', 'correction_sequential', 'demonstration_pre']:
            # If an intermediate_goal is provided, use it. Otherwise, default to the map's main goal_state.
            target_goal = intermediate_goal if intermediate_goal else goal_state
            
            trajectory = generate_trajectory_from_policy(policy, rows, cols, start_state, target_goal)
            return jsonify({"trajectory": trajectory})
        
        # Fallback for any unexpected path_style
        return jsonify({"error": f"Invalid path_style '{path_style}' provided."}), 400

    except Exception as e:
        print(f"ERROR in /generate-instructional-trajectory: {e}")
        return jsonify({"error": "Failed to generate instructional trajectory."}), 500

# --- DATA SUBMISSION ROUTES (ALL UPDATED) ---

@api_bp.route('/submit-free-form-answer', methods=['POST'])
def submit_free_form_answer():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    data = request.get_json()

    def mapper(trial_data):
        # 'description' is now a list received from the frontend.
        description_list = trial_data.get('description', [])
        return {
            'env_id': trial_data.get('env_id'),
            # Convert the list into a JSON formatted string for storage.
            'free_form_description': json.dumps(description_list)
        }

    return jsonify(*_attempt_save_data(session, [data], 'free_form_description', mapper))


@api_bp.route('/submit-demonstrations', methods=['POST'])
def submit_demonstrations():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    
    # The payload will be a dictionary containing the data and our new flag
    payload = request.get_json()
    all_demos_data = payload.get('data', [])
    is_pre_task = payload.get('is_pre_task', False)

    feedback_type = 'demonstration_pre' if is_pre_task else 'demonstration'

    def mapper(demo_data):
        return {
            'env_id': demo_data.get('env_id'),
            'user_demonstrated_trajectory': json.dumps(demo_data.get('trajectory', []))
        }

    return jsonify(*_attempt_save_data(session, all_demos_data, feedback_type, mapper))



@api_bp.route('/submit-comparison-choices', methods=['POST'])
def submit_comparison_choices():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    choices_data = request.get_json()

    def mapper(choice):
        return {
            'env_id': choice.get('comparison_id'),
            'chosen_trajectory_identifier': choice.get('choice'),
            'chosen_trajectory': json.dumps(choice.get('trajectory_a') if choice.get('choice') == 'A' else choice.get('trajectory_b')),
            'unchosen_trajectory': json.dumps(choice.get('trajectory_b') if choice.get('choice') == 'A' else choice.get('trajectory_a'))
        }

    return jsonify(*_attempt_save_data(session, choices_data, 'comparison', mapper))


@api_bp.route('/submit-corrections-data', methods=['POST'])
def submit_corrections_data():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    corrections_data = request.get_json()

    def mapper(data):
        return {
            'env_id': data.get('env_id'),
            'uncorrected_trajectory': json.dumps(data.get('original_trajectory', [])),
            'corrected_trajectory': json.dumps(data.get('corrected_trajectory', [])),
            'policy_type_served': data.get('policy_type')
        }

    return jsonify(*_attempt_save_data(session, corrections_data, 'correction', mapper))


@api_bp.route('/submit-off-data', methods=['POST'])
def submit_off_data():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
    interventions_data = request.get_json()

    def mapper(intervention):
        # NEW: We will store the obstacles inside the 'interrupted' field along with the final trajectory.
        # This avoids needing to change the database schema.
        final_data_package = {
            'trajectory': intervention.get('final_trajectory', []),
            'obstacles': intervention.get('obstacles', [])
        }
        return {
            'env_id': intervention.get('env_id'),
            'policy_type_served': intervention.get('policy_type'),
            'off_initial_trajectory': json.dumps(intervention.get('original_trajectory', [])),
            'off_interrupted_trajectory': json.dumps(final_data_package)
        }

    return jsonify(*_attempt_save_data(session, interventions_data, 'off_intervention', mapper))

@api_bp.route('/replan-from-point', methods=['POST'])
def replan_from_point():
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    env_id = data.get('env_id')
    policy_type = data.get('policy_type')
    temp_o_states = data.get('temp_o_states', [])
    new_start_state = data.get('new_start_state')

    if not all([env_id, policy_type, new_start_state]):
        return jsonify({"error": "Missing required data: 'env_id', 'policy_type', or 'new_start_state'."}), 400

    try:
        game_data = load_game_data()
        env_data = game_data.get("environments", {}).get(env_id)
        if not env_data:
            return jsonify({"error": "Environment not found"}), 404

        # 1. Retrain policy with the new obstacle map
        original_map = env_data.get("map_layout")
        modified_map_str = create_temp_map(original_map, [], [], temp_o_states)
        
        policy_config = game_data.get('policy_generation_config', {})
        is_slippery = (policy_type == 'slippery')
        new_policy = run_policy_iteration(
            cliff_map=modified_map_str,
            slippery=is_slippery,
            discount_factor=policy_config.get('DISCOUNT_FACTOR', 0.9),
            probability_denominator=policy_config.get('PROBABILITY_DENOMINATOR', 3),
            rewards=policy_config.get('REWARDS', [-10, 0, -1, -1, -1])
        )

        # 2. Generate a new trajectory from the specified intermediate start state
        parsed_map = parse_map_layout(original_map)
        rows, cols, goal = parsed_map['grid_rows'], parsed_map['grid_cols'], parsed_map['goal_state']
        
        # We only need the rest of the trajectory
        new_trajectory_segment = generate_trajectory_from_policy(new_policy, rows, cols, new_start_state, goal)

        # The first element of the segment is the start state itself, so we can skip it
        # when concatenating on the frontend to avoid a duplicate point.
        return jsonify({"new_trajectory_segment": new_trajectory_segment})

    except Exception as e:
        print(f"ERROR in /replan-from-point: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "Failed to replan from the specified point."}), 500
    
# --- UTILITY AND MISC ROUTES ---

@api_bp.route('/environment/<env_id>', methods=['GET'])
def get_environment_data(env_id):
    game_data = load_game_data()
    environment = game_data.get("environments", {}).get(env_id)

        # If not found there, check under the new 'free_form_questions_environments' tag
    if not environment:
        all_ffq_envs = game_data.get("free_form_questions_environments", {})
        environment = all_ffq_envs.get(env_id)

    if not environment:
        return jsonify({"error": "Environment not found"}), 404
    try:
        parsed_map_layout = parse_map_layout(environment.get("map_layout"))
        rows = parsed_map_layout['grid_rows']
        cols = parsed_map_layout['grid_cols']
        start = parsed_map_layout['start_state']
        goal = parsed_map_layout['goal_state']
        cliffs = parsed_map_layout.get('cliff_states')
        x_states = parsed_map_layout.get('x_states')
        y_states = parsed_map_layout.get('y_states')
        o_states = parsed_map_layout.get('o_states')

        return jsonify({
            "id": env_id, "name": environment.get("name", env_id),
            "grid_rows": rows, "grid_cols": cols,
            "start_state": start, "goal_state": goal, "cliff_states": cliffs,
            "x_states": x_states,   
            "y_states": y_states,
            "o_states": o_states,   
        })
    except ValueError as e:
        return jsonify({"error": f"Map parsing error: {str(e)}"}), 500

@api_bp.route('/verify-submission-counts', methods=['GET'])
def verify_submission_counts():
    """
    Verifies that the number of submitted trials for each task type
    matches the numbers specified in the configuration by querying the database directly.
    """
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    
    # Bypass for testing users
    if session.get('is_testing_user', False):
        print("TESTING LOG: Skipping submission verification (simulated success).")
        return jsonify({
            "status": "success", 
            "message": "Testing mode: Verification skipped.",
            "progress_info": get_progress_info(session),
            "is_psych_user": session.get('is_psych_user', False),
            "sona_id": session.get('sona_id', None)
        }), 200

    try:
        # --- Get User Info and Config ---
        user_id = session.get('pending_form_data', {}).get('user_id_field')
        if not user_id:
            return jsonify({"error": "User ID not found in session."}), 400

        game_data = load_game_data()
        task_config = game_data.get("task_config", {})
        task_flow = session.get('task_flow_sequence', [])

        # --- Build Expected Counts from the user's task flow ---
        expected_counts = {}
        if 'instructions.html?task=demonstrations_pre' in task_flow:
            expected_counts['demonstration_pre'] = task_config.get('num_demonstrations', 0)
        if 'instructions.html?task=demonstrations' in task_flow:
            expected_counts['demonstration'] = task_config.get('num_demonstrations', 0)
        if 'comparisons.html' in task_flow:
            expected_counts['comparison'] = task_config.get('num_comparisons', 0)
        if 'corrections.html' in task_flow:
            expected_counts['correction'] = task_config.get('num_corrections', 0)
        if 'off.html' in task_flow:
            expected_counts['off_intervention'] = task_config.get('num_offs', 0)
        
        # Added later
        if 'free_form_question.html' in task_flow:
            expected_counts['free_form_description'] = 1
        if 'manipulation_check.html?task=pre' in task_flow:
            expected_counts['manipulation_check_pre'] = 1
        if 'manipulation_check.html' in task_flow:
            expected_counts['manipulation_check'] = 1

        # --- NEW: Query the Database for Actual Counts ---
        actual_counts = {}
        db_url = os.environ.get('DATABASE_URL')
        engine = None
        if db_url:
            if db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql://", 1)
            engine = create_engine(db_url)
        else:
            engine = create_engine("sqlite:///local_database.db")

        with engine.connect() as connection:
            query = text(
                """
                SELECT feedback_type, COUNT(*) as count
                FROM participant_data
                WHERE user_id_field = :user_id
                GROUP BY feedback_type
                """
            )
            result = connection.execute(query, {"user_id": user_id})
            for row in result.mappings():
                actual_counts[row['feedback_type']] = row['count']
        
        # --- Compare actual DB counts with expected counts ---
        discrepancies = {}
        for task_key, expected in expected_counts.items():
            actual = actual_counts.get(task_key, 0)
            if actual < expected:
                discrepancies[task_key] = {"expected": expected, "actual": actual}

        # Build the final response
        response_data = {}
        if not discrepancies:
            response_data["status"] = "success"
            response_data["message"] = "All data appears to be submitted successfully."
        else:
            response_data["status"] = "error"
            response_data["message"] = "Some data may be missing."
            response_data["details"] = discrepancies

            print(f"--- Data submission discrepancies for user {user_id} ---")
            for task, counts in discrepancies.items():
                # print in RED for visibility
                print(f"\033[91mTask '{task}': expected {counts['expected']}, found {counts['actual']}\033[0m")
        
        response_data['progress_info'] = get_progress_info(session)
        response_data['is_psych_user'] = session.get('is_psych_user', False)
        response_data['sona_id'] = session.get('sona_id', None)

        return jsonify(response_data), 200

    except Exception as e:
        print(f"--- CRITICAL ERROR in /verify-submission-counts ---")
        import traceback
        traceback.print_exc()
        return jsonify({"error": "A critical server error occurred during verification."}), 500

# webapp/api_routes.py

@api_bp.route('/debrief-info', methods=['GET'])
def get_debrief_info():
    """
    Generates a personalized "Key Facts" debriefing message for the user
    based on their assigned group and their submitted data.
    """
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403

    user_id = session.get('pending_form_data', {}).get('user_id_field')
    instruction_group = session.get('instruction_group')

    if not user_id or not instruction_group:
        return jsonify({"error": "User information not found in session."}), 400

    user_description = ""  # Default to empty string
    db_url = os.environ.get('DATABASE_URL')
    engine = None

    # --- Database Connection ---
    if db_url:
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        engine = create_engine(db_url)
    else:
        engine = create_engine("sqlite:///local_database.db")

    # --- Query for User's Description ---
    if engine:
        try:
            with engine.connect() as connection:
                query = text(
                    """
                    SELECT free_form_description FROM participant_data
                    WHERE user_id_field = :user_id AND feedback_type = 'free_form_description'
                    ORDER BY submission_time DESC
                    LIMIT 1
                    """
                )
                # result = connection.execute(query, {"user_id": user_id}).fetchone()
                # if result and result[0]:
                #     desc_list = json.loads(result[0])
                #     if isinstance(desc_list, list) and desc_list:
                #         # Un-quote and join the list for a clean display
                #         user_description = ", ".join(desc_list)

                result = connection.execute(query, {"user_id": user_id}).fetchone()
                user_rating_text = "" # Use a new variable for the rating text
                if result and result[0]:
                    ratings_data = json.loads(result[0])
                    if isinstance(ratings_data, dict):
                        # Check which realm the user was assigned to and get the rating
                        if 'b1' in instruction_group: # Stable Realm
                            rating = ratings_data.get("stable_rating")
                            if rating:
                                user_rating_text = f"You rated the stable realm a **{rating}/5** on the rough-to-slick scale."
                        elif 'b2' in instruction_group: # Slippery Realm
                            rating = ratings_data.get("slippery_rating")
                            if rating:
                                user_rating_text = f"You rated the slippery realm a **{rating}/5** on the rough-to-slick scale."

        except Exception as e:
            print(f"ERROR: Could not fetch debrief data from DB: {e}")

    # --- FIXED: Corrected group names for the check ---
    was_misled = (instruction_group in ['group_a1b2', 'group_a2b1'])

    # Explicitly check for 'b1' and 'b2'
    if 'b1' in instruction_group:
        shown_condition_visual = "**stable, grassy terrain** 🌱"
    elif 'b2' in instruction_group:
        shown_condition_visual = "**slippery, icy terrain** 🧊"
    else:
        # Fallback for safety, in case the group is malformed
        shown_condition_visual = "[Condition Not Found]"

    # Explicitly check for 'a1' and 'a2'
    if 'a1' in instruction_group:
        told_condition = "**stable and non-slippery**"
    elif 'a2' in instruction_group:
        told_condition = "**slippery and unpredictable**"
    else:
        # Fallback for safety
        told_condition = "[Information Not Found]"


    # --- Construct the "Key Facts" message with new formatting ---
    user_setup_details = ""
    final_summary = ""
    # NEW: Add the user's perception text in a separate line with custom markdown `~~...~~`
    # perception_text = f"You described this world as:\n~~{user_description}~~" if user_description else ""
    perception_text = f"You described this world as:\n~~{user_rating_text}~~" if user_rating_text else ""


    if was_misled:
        user_setup_details = (
            f"✅ **Visuals:** You were shown a world that looked like {shown_condition_visual}.\n"
            f"{perception_text}\n"
            f"❗ **Information:** You were told the world's physics were {told_condition}."
        )
        final_summary = "You were randomly assigned to a **'mismatched'** group where the visuals and information did not align. Comparing results from this group with those from a 'matched' group is essential for our research."
    else:
        user_setup_details = (
            f"✅ **Visuals:** You were shown a world that looked like {shown_condition_visual}.\n"
            f"{perception_text}\n"
            f"✅ **Information:** You were told the world's physics were {told_condition}."
        )
        final_summary = "You were randomly assigned to a **'matched'** group where the visuals and information aligned. This provides an important baseline for comparison in our study."

    debrief_data = {
        "title": "About Our Study's Design",
        "main_goal": "Our primary goal is to understand how beliefs influence the guidance people provide. Here is a summary of your session:",
        "user_specific_info": user_setup_details.strip(), # Use strip to remove potential trailing newlines
        "condition_summary": final_summary,
        "conclusion": "Thank you for your valuable contribution!"
    }

    return jsonify(debrief_data)

@api_bp.route('/end-session', methods=['POST'])
def end_session():
    session.clear()
    return jsonify({"message": "Session cleared successfully."}), 200

@api_bp.route('/get-participant-data', methods=['GET'])
def get_participant_data():
    """
    Reads and returns the contents of the participant data CSV file as JSON.
    This is for use by the trajectory visualizer tool.
    """
    # Using a specific, recent data file for visualization.
    # This can be changed to a different file or made dynamic if needed.
    data_file = 'experiment_data/processed_participant_data.csv'
    try:
        if os.path.exists(data_file):
            df = pd.read_csv(data_file)
            # Replace NaN with None (which becomes null in JSON) for cleaner data
            df = df.where(pd.notnull(df), None)
            return jsonify(df.to_dict(orient='records'))
        else:
            return jsonify({"error": f"Data file not found: {data_file}"}), 404
    except Exception as e:
        print(f"ERROR reading participant data for visualizer: {e}")
        return jsonify({"error": "Failed to read or process participant data."}), 500


@api_bp.route('/mark-completion', methods=['POST'])
def mark_completion():
    """Updates the user's status to 'completed' in the database."""
    # Check if a user session exists
    if not session.get('form_completed', False):
        return jsonify({"error": "Session not initialized."}), 403
    
    # Get the user ID from the session data
    user_id = session.get('pending_form_data', {}).get('user_id_field')
    if not user_id:
        return jsonify({"error": "User not found in session."}), 400
    
    # Safeguard for testing users
    if session.get('is_testing_user', False):
        print(f"TESTING LOG: Skipping DB update for 'mark_completion' (simulated success).")
        return jsonify({"message": "Testing mode: Completion marked."}), 200

    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        if db_url.startswith("postgres://"):
            db_url = db_url.replace("postgres://", "postgresql://", 1)
        
        try:
            engine = create_engine(db_url)
            with engine.connect() as connection:
                with connection.begin(): # Use a transaction
                    # Find the user and update their status to 'completed' ONLY IF they are 'in_progress'
                    query = text("UPDATE user_access SET completion_status = 'completed' WHERE user_id = :user_id AND completion_status = 'in_progress'")
                    result = connection.execute(query, {"user_id": user_id})
            
            if result.rowcount > 0:
                print(f"INFO: User '{user_id}' marked as completed.")
            else:
                print(f"INFO: User '{user_id}' status not updated (was not 'in_progress').")

            return jsonify({"message": "User completion status processed."}), 200
        except Exception as e:
            print(f"ERROR: Could not mark user as complete. {e}")
            return jsonify({"error": "Database error during completion marking."}), 500
    
    # Fallback for local development without a database
    return jsonify({"message": "Completion marked (local)."})

@api_bp.route('/register-new-user', methods=['POST'])
def register_new_user():
    """
    Secure endpoint for Google Apps Script to add a new user.
    Group assignment is handled by the /submit-user-data endpoint on first login.
    """
    secret_key = os.environ.get('APPS_SCRIPT_SECRET_KEY')
    if not secret_key:
        return jsonify({"error": "Server not configured for registration."}), 500

    auth_token = request.headers.get('X-Auth-Token')
    if not auth_token or auth_token != secret_key:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json()
    user_id = data.get('user_id')
    notes = data.get('notes')

    if not user_id:
        return jsonify({"error": "Invalid user_id provided."}), 400

    db_url = os.environ.get('DATABASE_URL').replace("postgres://", "postgresql://", 1)
    try:
        engine = create_engine(db_url)
        with engine.connect() as connection:
            with connection.begin():
                # Inserts the new user with status 'not_started' and a NULL group.
                # The login logic will populate the group later.
                query = text("""
                    INSERT INTO user_access (user_id, completion_status, notes, instruction_group)
                    VALUES (:user_id, 'not_started', :notes, NULL)
                    ON CONFLICT (user_id) DO NOTHING;
                """)
                connection.execute(query, {"user_id": user_id, "notes": notes})
        
        print(f"SUCCESS: Auto-registered user '{user_id}' with no group.")
        return jsonify({"message": "User registered successfully."}), 201
    except Exception as e:
        print(f"ERROR: Failed to auto-register user '{user_id}'. Reason: {e}")
        return jsonify({"error": "Database operation failed."}), 500
    

def _attempt_save_data(session, data, feedback_type, mapper):
    """
    Wrapper for save_trial_data that suppresses errors for users with 
    'completion_status: testing'.
    """
    is_testing = session.get('is_testing_user', False)
    try:
        # Attempt the actual save
        message, status_code = save_trial_data(session, data, feedback_type, mapper)
        
        # If DB returned an error (e.g. 500) but we are testing, mask it
        if status_code >= 400 and is_testing:
            print(f"TESTING LOG: Database returned {status_code} for '{feedback_type}'. Ignoring failure.")
            return {"message": "Testing mode: Data save skipped/failed (simulated success)."}, 200
            
        return message, status_code

    except Exception as e:
        # If an exception crashed the save (e.g. ConnectionRefused), mask it for testers
        if is_testing:
            print(f"TESTING LOG: Exception during save for '{feedback_type}': {str(e)}. Ignoring failure.")
            return {"message": "Testing mode: Exception ignored."}, 200
        
        # For real users, re-raise the error so the server handles it normally
        raise e