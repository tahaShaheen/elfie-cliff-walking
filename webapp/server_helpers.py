import random
import json
from datetime import datetime
import pandas as pd
import os
from sqlalchemy import create_engine, inspect
import numpy as np
from collections import deque
import heapq

# Define the master list of all columns that can ever be saved to the database.\
ALL_DATABASE_COLUMNS = [
    "user_id_field", "instruction_group", "form_submission_time", "feedback_type",
    "session_id", "submission_time", "trial_number", "env_id",
    # Free form description column
    "free_form_description",
    # Demonstration columns
    "user_demonstrated_trajectory",
    # Comparison columns
    "chosen_trajectory_identifier", "chosen_trajectory", "unchosen_trajectory",
    # OFF Task columns
    "off_initial_trajectory", "off_interrupted_trajectory",
    # Correction columns
    "uncorrected_trajectory", "corrected_trajectory",
    # Policy shown in correction/off tasks
    "policy_type_served",
    # How many times the participant got each question wrong
    "manipulation_check_errors",
    # What the participant responded for each manipulation check
    "manipulation_check_responses",
]

def parse_map_layout(map_layout_strings):
    """Parses a list of strings into grid dimensions and feature coordinates."""
    if not map_layout_strings: raise ValueError("Map layout missing.")
    grid_rows = len(map_layout_strings); grid_cols = len(map_layout_strings[0])
    start_state, goal_state, cliff_states, x_states, o_states, y_states = None, None, [], [], [], []
    for r, row_str in enumerate(map_layout_strings):
        if len(row_str) != grid_cols: raise ValueError("Inconsistent row length.")
        for c, char_code in enumerate(row_str):
            if char_code == 'S': 
                if start_state: raise ValueError("Multiple start states 'S'.")
                start_state = [r, c]
            elif char_code == 'G': 
                goal_state = [r, c]
            elif char_code == 'H': cliff_states.append([r, c])
            elif char_code == 'X': x_states.append([r, c]) # Find X
            elif char_code == 'Y': y_states.append([r, c]) # Find Y
            elif char_code == 'O': o_states.append([r, c]) # Find O
            elif char_code != 'F': raise ValueError(f"Unknown char '{char_code}' at [{r},{c}].")
    if not start_state: raise ValueError("No start state 'S'.")
    if not goal_state: raise ValueError("No goal state 'G'.")

    # return grid_rows, grid_cols, start_state, goal_state, cliff_states, x_states, o_states

    parsed_map = {
        "grid_rows": grid_rows,
        "grid_cols": grid_cols,
        "start_state": start_state,
        "goal_state": goal_state,
        "cliff_states": cliff_states,
        "x_states": x_states,
        "y_states": y_states,
        "o_states": o_states
    }
    return parsed_map

# def generate_trajectory_from_policy(policy, grid_rows, grid_cols, start_state, goal_state):
#     """
#     Generates a trajectory (list of coordinates) from a policy map.
#     """
#     if not policy:
#         return []
#     trajectory = [list(start_state)]
#     current_pos = list(start_state)
#     goal_state = list(goal_state)
    
#     max_steps = grid_rows * grid_cols * 2

#     for _ in range(max_steps):
#         if current_pos == goal_state:
#             break
#         state_index = current_pos[0] * grid_cols + current_pos[1]
#         if state_index >= len(policy):
#             break
#         action = policy[state_index]
#         next_pos = list(current_pos)
#         if action == 0 and current_pos[1] > 0:
#             next_pos[1] -= 1
#         elif action == 1 and current_pos[0] < grid_rows - 1:
#             next_pos[0] += 1
#         elif action == 2 and current_pos[1] < grid_cols - 1:
#             next_pos[1] += 1
#         elif action == 3 and current_pos[0] > 0:
#             next_pos[0] -= 1
#         current_pos = next_pos
#         trajectory.append(current_pos)
#     return trajectory

def generate_trajectory_from_policy(policy, grid_rows, grid_cols, start_state, goal_state, map_layout=None, epsilon=0.0):
    """
    Generates a trajectory from a policy. If epsilon > 0, it then iteratively deforms
    the trajectory to make it imperfect.

    Args:
        policy (list): The policy map indicating the best action for each state.
        grid_rows (int): The number of rows in the grid.
        grid_cols (int): The number of columns in the grid.
        start_state (list): The [row, col] coordinates for the start.
        goal_state (list): The [row, col] coordinates for the goal.
        map_layout (list, optional): The list of strings representing the map. Required for deformation.
        epsilon (float, optional): The probability of deforming the trajectory at each point.
    """
    if not policy:
        return []

    # --- 1. First, generate the perfect trajectory from the policy ---
    perfect_trajectory = []
    trajectory = [list(start_state)]
    current_pos = list(start_state)
    goal_pos = list(goal_state)
    max_steps = grid_rows * grid_cols * 2

    for _ in range(max_steps):
        if current_pos == goal_pos:
            break
        state_index = current_pos[0] * grid_cols + current_pos[1]
        if state_index >= len(policy):
            break
        action = policy[state_index]
        old_pos = list(current_pos)
        next_pos = list(current_pos)
        if action == 0 and current_pos[1] > 0: next_pos[1] -= 1
        elif action == 1 and current_pos[0] < grid_rows - 1: next_pos[0] += 1
        elif action == 2 and current_pos[1] < grid_cols - 1: next_pos[1] += 1
        elif action == 3 and current_pos[0] > 0: next_pos[0] -= 1
        current_pos = next_pos
        
        # If agent is stuck at a non-goal state, break to prevent incorrect paths
        if old_pos == current_pos and current_pos != goal_pos:
            print(f"Warning: Agent is stuck at {current_pos} while not at goal {goal_pos}. Start position was {start_state}. Stopping trajectory generation.")
            break

        trajectory.append(current_pos)
    perfect_trajectory = trajectory

    # --- 2. If epsilon > 0, deform a fixed percentage of the points ---
    if epsilon > 0 and map_layout and len(perfect_trajectory) > 2:
        parsed_map = parse_map_layout(map_layout)
        impassable_cells = set(map(tuple, parsed_map.get('cliff_states', []) + parsed_map.get('o_states', [])))
        
        # MODIFIED: Pre-select a fixed number of points to deform
        num_to_change = int(len(perfect_trajectory) * epsilon)
        if num_to_change == 0 and epsilon > 0:
            num_to_change = 1 # Ensure at least one point is changed if epsilon > 0

        print(f"Deforming {num_to_change} points in the trajectory with epsilon {epsilon}.")
        
        possible_indices = list(range(1, len(perfect_trajectory) - 1))
        num_to_sample = min(num_to_change, len(possible_indices)) # Ensure we don't sample more than available points
        indices_to_deform = random.sample(possible_indices, num_to_sample)
        
        current_trajectory = list(perfect_trajectory)

        # MODIFIED: Loop through the pre-selected indices instead of every point
        for index in indices_to_deform:
            # MODIFIED: Safety check to ensure the index is still valid in the potentially shorter path
            if index >= len(current_trajectory) - 1:
                continue

            correction_index = index
            original_point = current_trajectory[correction_index]
            
            # Create a set of the current path coordinates for efficient lookup
            path_coords = set(map(tuple, current_trajectory))

            # Tier 1: Large jump vectors (2 cells away)
            large_vectors = [[2,0], [-2,0], [0,2], [0,-2], [1,1], [1,-1], [-1,1], [-1,-1]]
            random.shuffle(large_vectors)
            
            # Tier 2: Small step vectors (1 cell away)
            small_vectors = [[1,0], [-1,0], [0,1], [0,-1]]
            random.shuffle(small_vectors)

            legal_vector = None
            
            # Function to check if a move is valid
            def is_valid_move(vec):
                # The intermediate cell for a "jump" must also be valid
                if abs(vec[0]) > 1 or abs(vec[1]) > 1:
                    inter_r, inter_c = original_point[0] + vec[0]//2, original_point[1] + vec[1]//2
                    if (inter_r, inter_c) in impassable_cells:
                        return False

                # Check the final destination cell
                new_r, new_c = original_point[0] + vec[0], original_point[1] + vec[1]
                if not (0 <= new_r < grid_rows and 0 <= new_c < grid_cols):
                    return False # Out of bounds
                if (new_r, new_c) in impassable_cells:
                    return False # Hits a cliff
                return True

            # Try to find a valid vector that is NOT on the current path
            for vec in large_vectors + small_vectors:
                new_pos = (original_point[0] + vec[0], original_point[1] + vec[1])
                if is_valid_move(vec) and new_pos not in path_coords:
                    legal_vector = vec
                    break

            # FALLBACK: If all valid moves land on the path, just pick the first valid one
            if not legal_vector:
                for vec in large_vectors + small_vectors:
                    if is_valid_move(vec):
                        legal_vector = vec
                        break

            
            if legal_vector:
                deformed_path = deform_trajectory(
                    trajectory=current_trajectory,
                    correction_index=correction_index,
                    correction_vector=legal_vector,
                    sigma=2.5
                )
                
                fixed_path = fix_deformed_trajectory(
                    original_trajectory=current_trajectory,
                    deformed_trajectory=deformed_path,
                    env_data=parsed_map,
                    correction_vector=legal_vector
                )

                print(f"Deformed trajectory at index {correction_index} with vector {legal_vector}.")

                if perfect_trajectory == current_trajectory:
                    print("\033[93m[LOG] WARNING: The final perturbed path is identical to the original path.\033[0m")
                else:
                    print("\033[92m[LOG] SUCCESS: The final perturbed path is different from the original path.\033[0m")

                if fixed_path and len(fixed_path) > 2:
                    current_trajectory = fixed_path
        
        return current_trajectory
    
    return perfect_trajectory

def generate_task_scenarios(game_data, task_type, session, total_task_types):
    # This function remains the same as before...
    task_flow = session.get('task_flow_sequence', [])
    
    # 1. Filter the flow to only the main task pages we want to count.
    main_task_pages = [
        p for p in task_flow
        if p.endswith('.html') and p not in [
            'index.html', 'instructions.html', 'thank_you.html',
            'free_form_question.html', 'plan_vs_execution.html', 'manipulation_check.html'
        ]
    ]

    # This is the true total number of mini-games
    total_task_count = len(main_task_pages)

    # 2. Get the current task number and total from our reliable helper function.
    task_info = _get_current_task_info(session)
    overall_task_current_num = task_info['current_num']
    total_task_count = task_info['total_num']

    instruction_components = game_data.get('instruction_components', {})
    header_component_map = {
        'demonstration': 'demonstrations_common_header',
        'comparison': 'comparisons_common_header',
        'correction': 'corrections_common_header',
        'off': 'off_task_common_header'
    }
    task_title = ""
    component_id = header_component_map.get(task_type)
    if component_id and component_id in instruction_components:
        component_elements = instruction_components.get(component_id, [])
        if component_elements and isinstance(component_elements, list):
            header_element = next((el for el in component_elements if el.get('type') == 'header'), None)
            if header_element:
                task_title = header_element.get('content', '')

    task_config = game_data.get("task_config", {})
    environments = game_data.get("environments", {})
    available_env_ids = list(environments.keys())
    if not available_env_ids: return {"error": "No environments configured."}
    
    # num_key = f"num_{task_type}s"
    # practice_env_key = f"{task_type}_practice_env"
    # scenarios_key = f"{task_type}_scenarios"
    # max_key = f"max_{task_type}s"
    # practice_env_id = task_config.get(practice_env_key)

    num_key = f"num_{task_type}s"
    scenarios_key = f"{task_type}_scenarios"
    max_key = f"max_{task_type}s"
    # The practice map ID is now constant for all tasks
    practice_env_id = 'practice_env'


    practice_scenario = None

    if practice_env_id and practice_env_id in environments:
        env_data = environments.get(practice_env_id, {})
        # if task_type in ['correction', 'off']:
        #     policy1_str = env_data.get("policy_group_b1"); policy2_str = env_data.get("policy_group_b2")
        #     if policy1_str and policy2_str:
        #         instruction_group = session.get('instruction_group', '') # Get the user's group from the session.
        #         # print(f"Using instruction group: {instruction_group}")
        #         # use_slippery_policy = random.choice([True, False]); # Randomly choose which policy to use
        #         use_slippery_policy = False if 'a2' in instruction_group else True # use not slippery policy for slippery env
        #         policy_str_to_use = policy2_str if use_slippery_policy else policy1_str
        #         policy_type = "slippery" if use_slippery_policy else "non_slippery"
        #         parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
        #         rows = parsed_map_layout['grid_rows']
        #         cols = parsed_map_layout['grid_cols']
        #         start = parsed_map_layout['start_state']
        #         goal = parsed_map_layout['goal_state']
        #         policy = json.loads(policy_str_to_use)
        #         trajectory = generate_trajectory_from_policy(policy, rows, cols, start, goal)
        #         practice_scenario = {"env_id": practice_env_id, "name": env_data.get("name", practice_env_id), "trajectory": trajectory, "policy_type": policy_type}
        if task_type in ['correction', 'off']:
            policy1_str = env_data.get("policy_group_b1")
            policy2_str = env_data.get("policy_group_b2")
            if policy1_str and policy2_str:
                instruction_group = session.get('instruction_group', '')
                epsilon = game_data.get("task_config", {}).get("trajectory_generation_epsilon", 0.0)

                # Determine which policy is primary and which is rival for the practice round
                use_slippery_policy_for_practice = 'a2' not in instruction_group
                primary_policy_str = policy2_str if use_slippery_policy_for_practice else policy1_str
                rival_policy_str = policy1_str if use_slippery_policy_for_practice else policy2_str

                practice_scenario = {
                    "env_id": practice_env_id,
                    "name": env_data.get("name", practice_env_id),
                    "policy_to_use": json.loads(primary_policy_str),
                    "rival_policy": json.loads(rival_policy_str),
                    "policy_type_served": "slippery" if use_slippery_policy_for_practice else "non_slippery",
                    "epsilon": epsilon
                }
        elif task_type == 'comparison':
            policy1_str = env_data.get("policy_group_b1"); policy2_str = env_data.get("policy_group_b2")
            if policy1_str and policy2_str:
                parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
                rows = parsed_map_layout['grid_rows']
                cols = parsed_map_layout['grid_cols']
                start = parsed_map_layout['start_state']
                goal = parsed_map_layout['goal_state']
                policy1, policy2 = json.loads(policy1_str), json.loads(policy2_str)
                # # Get the epsilon value from config to send to the frontend
                epsilon = game_data.get("task_config", {}).get("trajectory_generation_epsilon", 0.0)
                # map_layout = env_data.get("map_layout")

                # # MODIFIED: Pass the new parameters to both function calls
                # traj1 = generate_trajectory_from_policy(policy1, rows, cols, start, goal, map_layout=map_layout, epsilon=epsilon)
                # traj2 = generate_trajectory_from_policy(policy2, rows, cols, start, goal, map_layout=map_layout, epsilon=epsilon)

                # The backend no longer generates the trajectories for comparisons.
                 # It just sends the raw policies to the frontend.
                policies = [policy1, policy2]
                random.shuffle(policies)

                # # Shuffle the trajectories to randomize which is A and B
                # trajectories = [traj1, traj2]; random.shuffle(trajectories)
                # practice_scenario = {"comparison_id": f"practice_{practice_env_id}", "name": env_data.get("name", practice_env_id), "env_id": practice_env_id, "trajectory_a": trajectories[0], "trajectory_b": trajectories[1]}

                practice_scenario = {
                    "comparison_id": f"practice_{practice_env_id}", 
                    "name": env_data.get("name", practice_env_id), 
                    "env_id": practice_env_id, 
                    "policy_a": policies[0], # Send policy_a
                    "policy_b": policies[1], # Send policy_b
                    "epsilon": epsilon       # Send epsilon
                }
    
        # # First, create a list of candidates by excluding the practice map.
        # real_env_candidates = [env for env in available_env_ids if env != practice_env_id]

        # # If the task type requires policies (e.g., comparison, correction, off-task),
        # # we must pre-filter the candidates to ensure they have the necessary data before we sample.
        # # This prevents the number of scenarios from shrinking unexpectedly.
        # if task_type in ['comparison', 'correction', 'off']:
        #     valid_candidates = []
        #     for env_id in real_env_candidates:
        #         # Check if the environment has the required policy groups.
        #         env_data = environments.get(env_id, {})
        #         if env_data.get("policy_group_b1") and env_data.get("policy_group_b2"):
        #             valid_candidates.append(env_id)
        # else:
        #     # For tasks like demonstrations, no policy pre-check is needed.
        #     valid_candidates = real_env_candidates

        # # Determine how many maps to select based on the config and the number of VALID candidates.
        # num_wanted_from_config = task_config.get(num_key, 1)
        # num_to_select = min(num_wanted_from_config, len(valid_candidates))
        # # print(f"Configured to select {num_wanted_from_config} {task_type}s from {len(valid_candidates)} valid candidates available.")

        # # Sample from the final, validated list of candidates.
        # selected_env_ids = random.sample(valid_candidates, num_to_select) if valid_candidates else []
        # # print(f"Selected {len(selected_env_ids)} environments for task type '{task_type}': {selected_env_ids}")

        # # If the task is a demonstration, use the pre-allocated maps and shuffle them
        # if task_type == 'demonstration':
        #     selected_env_ids = session.get('demonstration_maps', [])
        #     random.shuffle(selected_env_ids) # This shuffles the order each time
        # else:
        #     # For all other tasks, use the existing slicing logic from the remaining maps
        #     num_wanted_from_config = task_config.get(num_key, 1)
        #     shuffled_sequence = session.get('shuffled_map_sequence', [])
        #     current_index = session.get('map_sequence_index', 0)

        #     # Slice the next chunk of maps from the master list
        #     end_index = current_index + num_wanted_from_config
        #     selected_env_ids = shuffled_sequence[current_index:end_index]

        #     # Update the pointer in the session for the next task
        #     session['map_sequence_index'] = end_index
        #     if hasattr(session, 'modified'):
        #         session.modified = True

        #     # FALLBACK: If the session didn't provide a shuffled sequence or the slice
        #     # produced no env ids (as happens in unit tests), fall back to using all
        #     # available environments except the practice map.
        #     if not selected_env_ids:
        #         selected_env_ids = [env for env in available_env_ids if env != practice_env_id]

        # Fetch the pre-allocated list of maps for this specific task.
        task_allocations = session.get('task_map_allocations', {})

        if task_type == 'demonstration':
            # Determine if this is the first (pre) or second (main) demonstration task.
            current_idx = session.get('current_task_index', 0)
            current_page_url = task_flow[current_idx - 1] if current_idx > 0 else ""
            is_pre_task = 'task=pre' in current_page_url
            
            demo_key = 'demonstration_pre' if is_pre_task else 'demonstration_main'
            selected_env_ids = task_allocations.get(demo_key, [])

        else:
            # For all other tasks, just grab their dedicated list.
            selected_env_ids = task_allocations.get(task_type, [])

        # Shuffle the selected maps to randomize their order within the task.
        random.shuffle(selected_env_ids)

    real_scenarios = []

    policy_choices = []
    if task_type in ['correction', 'off']:
        num_trials = len(selected_env_ids)
        # Calculate how many disagreeing trials to show (the majority)
        # Ensure the "disagreeing" policy is the strict majority.
        # For any positive num_trials, make disagreeing > agreeing.
        if num_trials > 0:
            num_disagreeing = (num_trials // 2) + 1
        else:
            num_disagreeing = 0
        num_agreeing = num_trials - num_disagreeing

        # Determine what 'agreeing' means for the user's assigned group
        instruction_group = session.get('instruction_group', '')
        is_slippery_group = 'a2' in instruction_group
        
        # This boolean represents whether the slippery policy should be used.
        # For a slippery group (a2), the agreeing policy is slippery (True).
        # For a stable group (a1), the agreeing policy is stable (False).
        agreeing_policy_is_slippery = is_slippery_group
        disagreeing_policy_is_slippery = not agreeing_policy_is_slippery

        # Create the weighted list of which policy to use for each trial
        policy_choices = ([disagreeing_policy_is_slippery] * num_disagreeing) + \
                         ([agreeing_policy_is_slippery] * num_agreeing)
        
        # Shuffle the list to randomize the order of agreeing/disagreeing trials
        random.shuffle(policy_choices)

    for i, env_id in enumerate(selected_env_ids):
        env_data = environments.get(env_id, {})
        if task_type == 'demonstration': real_scenarios.append(env_id)
        # elif task_type in ['correction', 'off']:
        #     policy1_str = env_data.get("policy_group_b1"); policy2_str = env_data.get("policy_group_b2")
        #     if policy1_str and policy2_str:
        #         use_slippery_policy = policy_choices[i]
        #         policy_str_to_use = policy2_str if use_slippery_policy else policy1_str
        #         policy_type = "slippery" if use_slippery_policy else "non_slippery"
        #         parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
        #         rows = parsed_map_layout['grid_rows']
        #         cols = parsed_map_layout['grid_cols']
        #         start = parsed_map_layout['start_state']
        #         goal = parsed_map_layout['goal_state']
        #         policy = json.loads(policy_str_to_use)
        #         trajectory = generate_trajectory_from_policy(policy, rows, cols, start, goal)
        #         real_scenarios.append({"env_id": env_id, "name": env_data.get("name", env_id), "trajectory": trajectory, "policy_type": policy_type})
        elif task_type in ['correction', 'off']:
            policy1_str = env_data.get("policy_group_b1")
            policy2_str = env_data.get("policy_group_b2")
            if policy1_str and policy2_str:
                use_slippery_policy = policy_choices[i]

                primary_policy_str = policy2_str if use_slippery_policy else policy1_str
                rival_policy_str = policy1_str if use_slippery_policy else policy2_str
                policy_type_served = "slippery" if use_slippery_policy else "non_slippery"
                epsilon = game_data.get("task_config", {}).get("trajectory_generation_epsilon", 0.0)

                real_scenarios.append({
                    "env_id": env_id,
                    "name": env_data.get("name", env_id),
                    "policy_to_use": json.loads(primary_policy_str),
                    "rival_policy": json.loads(rival_policy_str),
                    "policy_type_served": policy_type_served,
                    "epsilon": epsilon
                })
        elif task_type == 'comparison':
            policy1_str = env_data.get("policy_group_b1"); policy2_str = env_data.get("policy_group_b2")
            if policy1_str and policy2_str:
                parsed_map_layout = parse_map_layout(env_data.get("map_layout"))
                rows = parsed_map_layout['grid_rows']
                cols = parsed_map_layout['grid_cols']
                start = parsed_map_layout['start_state']
                goal = parsed_map_layout['goal_state']
                policy1, policy2 = json.loads(policy1_str), json.loads(policy2_str)

                # # Get the epsilon value from config to send to the frontend
                epsilon = game_data.get("task_config", {}).get("trajectory_generation_epsilon", 0.0)
                # map_layout = env_data.get("map_layout")

                # Shuffle the policies to randomize which is A and B
                policies = [policy1, policy2]
                random.shuffle(policies)

                # # MODIFIED: Pass the new parameters to both function calls
                # traj1 = generate_trajectory_from_policy(policy1, rows, cols, start, goal, map_layout=map_layout, epsilon=epsilon)
                # traj2 = generate_trajectory_from_policy(policy2, rows, cols, start, goal, map_layout=map_layout, epsilon=epsilon)

                # # Shuffle the trajectories to randomize which is A and B
                # trajectories = [traj1, traj2]; random.shuffle(trajectories)
                # real_scenarios.append({"comparison_id": env_id, "name": env_data.get("name", env_id), "env_id": env_id, "trajectory_a": trajectories[0], "trajectory_b": trajectories[1]})

                real_scenarios.append({
                    "comparison_id": env_id, 
                    "name": env_data.get("name", env_id), 
                    "env_id": env_id, 
                    "policy_a": policies[0], # Send policy_a
                    "policy_b": policies[1], # Send policy_b
                    "epsilon": epsilon       # Send epsilon
                })

    response_data = {
        "practice_scenario": practice_scenario,
        max_key: len(real_scenarios),
        "overall_task_current_num": overall_task_current_num,
        "overall_task_total_num": total_task_count,
        "task_title": task_title
    }
    if task_type == 'demonstration':
        response_data["environment_sequence"] = real_scenarios; response_data["max_demonstrations"] = len(real_scenarios); response_data["practice_environment_id"] = practice_env_id
    else: response_data[scenarios_key] = real_scenarios
    if task_type == 'correction': response_data['num_correction_attempts'] = task_config.get('num_correction_attempts', 3)
    elif task_type == 'off': 
        response_data['animation_speed'] = task_config.get('off_task_animation_speed', 1400)
        response_data['num_off_attempts'] = task_config.get('num_off_attempts', 3)
    elif task_type == 'comparison': response_data['animation_speed'] = task_config.get('comparison_animation_speed', 350)
    
    return response_data

def save_trial_data(session, all_trial_data, feedback_type, data_mapper, engine=None):
    """
    Saves trial data to a PostgreSQL database on Render, or a local SQLite
    database for local development, ensuring the table schema is correct.
    """
    base_form_data = session.get('pending_form_data')
    if not base_form_data:
        return {"error": "Initial form data missing."}, 400

    # CHANGE 2: Only create a new engine if one isn't passed in.
    if engine is None:
        db_url = os.environ.get('DATABASE_URL')
        if db_url:
            if db_url.startswith("postgres://"):
                db_url = db_url.replace("postgres://", "postgresql://", 1)
            engine = create_engine(db_url)
        else:
            print("DATABASE_URL not found. Using local SQLite database 'local_database.db'")
            engine = create_engine("sqlite:///local_database.db")
    
    if not engine:
        return {"error": "Could not create database engine."}, 500


    # --- ROBUST TABLE CREATION LOGIC ---
    try:
        inspector = inspect(engine)
        if not inspector.has_table("participant_data"):
            print("Table 'participant_data' not found. Creating it with the full schema.")
            empty_df = pd.DataFrame(columns=ALL_DATABASE_COLUMNS)
            empty_df.to_sql('participant_data', con=engine, index=False)
            print("Table 'participant_data' created successfully.")
    except Exception as e:
        return {"error": f"Failed during table inspection or creation: {e}"}, 500
    
    # --- Data processing proceeds as before ---
    trial_counter = session.get('trial_counters', {})
    counter_key = 'off_intervention' if feedback_type == 'off' else feedback_type
    trial_num = trial_counter.get(counter_key, 0)
    
    records_to_add = []
    for trial_data in all_trial_data:
        trial_num += 1
        record = base_form_data.copy()
        record['feedback_type'] = feedback_type
        record['session_id'] = session.sid
        record['submission_time'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record['trial_number'] = trial_num
        specific_data = data_mapper(trial_data)
        record.update(specific_data)
        records_to_add.append(record)
    
    trial_counter[counter_key] = trial_num
    session['trial_counters'] = trial_counter
    if hasattr(session, 'modified'):
        session.modified = True

    if not records_to_add:
        return {"message": f"No {feedback_type} data received."}, 400

    try:
        new_entries_df = pd.DataFrame(records_to_add)
        new_entries_df = new_entries_df.reindex(columns=ALL_DATABASE_COLUMNS)

        # This 'with' block creates a transaction. It will automatically
        # COMMIT on success or ROLLBACK on failure.
        with engine.begin() as connection:
            # 1. Ensure table exists using the transaction's connection
            inspector = inspect(connection)
            if not inspector.has_table("participant_data"):
                print("Table 'participant_data' not found. Creating it...")
                empty_df = pd.DataFrame(columns=ALL_DATABASE_COLUMNS)
                empty_df.to_sql('participant_data', con=connection, index=False)
                print("Table 'participant_data' created successfully.")

            # 2. Append data using the same transaction connection
            new_entries_df.to_sql(
                'participant_data', 
                con=connection, # Use 'connection' here, NOT 'engine'
                if_exists='append',
                index=False
            )
    except Exception as e:
        return {"error": f"Failed to save data to database: {e}"}, 500

    # On success, create the message
    user_id = base_form_data.get('user_id_field', 'unknown')
    success_message = f"{feedback_type.capitalize()} data received and saved successfully for user {user_id}."

    # Print the message using ANSI escape codes for color
    print(f"\033[92m{success_message}\033[0m")

    # The return statement is unchanged
    return {"message": success_message}, 200

def get_progress_info(session):
    """
    Calculates the user's current overall progress percentage and text label
    based directly on their index in the task flow.
    """
    task_flow = session.get('task_flow_sequence', [])
    # current_task_index is the number of steps the user has *started*.
    current_task_idx = session.get('current_task_index', 0)
    
    if not task_flow or current_task_idx == 0:
        # This handles the state before the first page loads.
        return {"milestone_text": "Getting Started", "base_percent": 0, "next_base_percent": 0}

    total_milestones = len(task_flow)

    # If the index is beyond the end of the flow, it means we are on the thank you page.
    if current_task_idx > total_milestones:
        return {
            "milestone_text": "Complete!",
            "base_percent": 100,
            "next_base_percent": 100
        }
    
    # The percentage is now a direct calculation of steps taken vs. total steps.
    base_percent = ((current_task_idx - 1) / total_milestones) * 100
    next_base_percent = (current_task_idx / total_milestones) * 100

    # --- Determine the Milestone Text ---
    # The current page is the one at index - 1 from the next task index.
    current_page_url = task_flow[current_task_idx - 1]
    current_page_name = current_page_url.split('?')[0]
    
    milestone_text = "Task in Progress" # A sensible default
    task_info = _get_current_task_info(session)
    
    # Define the main mini-game pages
    main_task_pages_set = {"demonstrations.html", "comparisons.html", "corrections.html", "off.html"}
    
    # Determine which task we're on, even for instruction pages
    task_page_for_lookup = current_page_name
    is_task_instruction_page = 'instructions.html?task=' in current_page_url
    if is_task_instruction_page:
        task_type_from_url = current_page_url.split('=')[1]
        if f"{task_type_from_url}.html" in main_task_pages_set:
             task_page_for_lookup = f"{task_type_from_url}.html"

    # Set text for mini-games and their instructions
    if task_page_for_lookup in main_task_pages_set:
        task_num = task_info['current_num']
        total_tasks = task_info['total_num']
        base_text = f"Mini-Game {task_num} of {total_tasks}"
        milestone_text = f"Instructions for {base_text}" if is_task_instruction_page else base_text
    
    # Set text for all other specific pages
    elif current_page_name == 'instructions.html':
        milestone_text = "Main Instructions"
    elif current_page_name == 'free_form_question.html':
        milestone_text = "Initial Questions"
    elif current_page_name == 'plan_vs_execution.html':
        milestone_text = "Planning vs. Execution"
    elif current_page_name == 'manipulation_check.html':
        milestone_text = "Comprehension Check"
    elif current_page_name == 'thank_you.html':
        milestone_text = "Complete!"
        base_percent = 100
        next_base_percent = 100
            
    return {
        "milestone_text": milestone_text,
        "base_percent": round(base_percent),
        "next_base_percent": round(next_base_percent)
    }


def _get_current_task_info(session):
    """A single, reliable function to calculate the current task number and total."""
    task_flow = session.get('task_flow_sequence', [])
    current_task_idx = session.get('current_task_index', 0)

    # Define the base names of the main mini-games
    main_task_bases = ("demonstrations.html", "comparisons.html", "corrections.html", "off.html")
    
    # Get the ordered list of all mini-games by checking if the URL starts with a base name
    all_main_games_in_flow = [p for p in task_flow if any(p.startswith(base) for base in main_task_bases)]
    total_tasks = len(all_main_games_in_flow)

    # Count tasks in the same way for the current number
    flow_so_far = task_flow[:current_task_idx]
    current_task_num = sum(1 for page in flow_so_far if any(page.startswith(base) for base in main_task_bases))

    # If the current page is an instruction page for a task, the count is off by one
    # because the task itself isn't in the history yet. We increment the count to
    # show the number for the upcoming task.
    if current_task_idx > 0:
        current_page_url = task_flow[current_task_idx - 1]
        if 'instructions.html?task=' in current_page_url:
            current_task_num += 1

    return {"current_num": current_task_num, "total_num": total_tasks}


def create_temp_map(original_map, temp_x_states, temp_y_states, temp_o_states):
    """
    Creates a new map layout with temporary 'X' and 'O' tiles added.
    """

    def is_solvable(grid, start_pos, goal_pos):
        """
        Checks if a path exists from start_pos to goal_pos using Breadth-First Search (BFS).
        Holes ('H') and other obstacles are treated as impassable walls.
        """
        rows = len(grid)
        cols = len(grid[0])
        queue = deque([start_pos])
        visited = {tuple(start_pos)}
        impassable = {'H', 'O'}

        while queue:
            r, c = queue.popleft()

            if (r, c) == tuple(goal_pos):
                return True  # Path found

            for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:  # Right, Left, Down, Up
                nr, nc = r + dr, c + dc

                if 0 <= nr < rows and 0 <= nc < cols and (nr, nc) not in visited:
                    if grid[nr][nc] not in impassable:
                        visited.add((nr, nc))
                        queue.append((nr, nc))

        return False  # No path found
    if not original_map:
        return None

    modified_map = [list(row) for row in original_map]

    parsed_original = parse_map_layout(original_map)
    start_pos = tuple(parsed_original['start_state'])
    goal_pos = tuple(parsed_original['goal_state'])

    # Add all temporary 'X' states
    if temp_x_states:
        for x_pos in temp_x_states:
            if modified_map[x_pos[0]][x_pos[1]] not in ['S', 'G', 'H']:
                modified_map[x_pos[0]][x_pos[1]] = 'X'

    # Add all temporary 'Y' states
    if temp_y_states:
        for y_pos in temp_y_states:
            if modified_map[y_pos[0]][y_pos[1]] not in ['S', 'G', 'H']:
                modified_map[y_pos[0]][y_pos[1]] = 'Y'

    # Add all temporary 'O' obstacles
    if temp_o_states:
        for o_pos in temp_o_states:
            if modified_map[o_pos[0]][o_pos[1]] not in ['S', 'G', 'H']:
                modified_map[o_pos[0]][o_pos[1]] = 'O'

                # Check if this map is solvable
                if not is_solvable(modified_map, start_pos, goal_pos):
                    modified_map[o_pos[0]][o_pos[1]] = 'F' # Revert to free space if not solvable

    return ["".join(row) for row in modified_map]


def _calculate_influence(distance, sigma=2.5):
    """
    Calculates the influence of a correction at a given distance using a Gaussian function.
    This ensures the effect is strongest at the correction point and decays smoothly.

    Args:
        distance (float): The number of steps away from the correction point.
        sigma (float): Controls the "width" of the influence. A smaller value
                       makes the effect more localized and sharp.

    Returns:
        float: The influence factor, between 0 and 1.
    """
    influence = np.exp(-(distance**2) / (2 * sigma**2))
    return influence

def deform_trajectory(trajectory, correction_index, correction_vector, sigma=2.5):
    """
    Deforms a trajectory smoothly based on a user correction using a Gaussian decay model.
    This feels like dragging a point on a flexible line, where nearby points move most.

    Args:
        trajectory (list): The list of [row, col] coordinates for the original path.
        correction_index (int): The index of the point in the trajectory that the user wants to move.
        correction_vector (list): A [d_row, d_col] vector of the desired correction.
        sigma (float): A parameter that controls the "spread" of the deformation.
                       A larger value makes the deformation broader and gentler.

    Returns:
        list: A new list of [row, col] coordinates for the deformed trajectory.
    """
    # A path needs at least 3 points to be deformable.
    if len(trajectory) < 3:
        return trajectory

    deformed_traj = []
    correction_array = np.array(correction_vector, dtype=float)

    # Iterate through each point to calculate its new position.
    for i, point in enumerate(trajectory):
        # The start and end points of the trajectory are fixed anchors.
        if i == 0 or i == len(trajectory) - 1:
            deformed_traj.append(list(point))
            continue

        # Calculate the distance (number of steps) from the current point to the corrected point.
        distance = abs(i - correction_index)
        
        # Get the influence factor based on the distance.
        influence = _calculate_influence(distance, sigma)
        
        # Calculate the displacement for the current point, scaled by the influence factor.
        displacement = correction_array * influence
        
        # Apply the displacement to the original point's position.
        new_point = np.array(point) + displacement
        deformed_traj.append(new_point.tolist())

    return deformed_traj

def fix_deformed_trajectory(original_trajectory, deformed_trajectory, env_data, correction_vector):
    """
    Snaps a deformed trajectory to a valid grid path using a directional search for
    invalid points and pruning the result. Includes debugging prints.

    Args:
        original_trajectory (list): The trajectory before deformation.
        deformed_trajectory (list): The list of floating-point coordinates.
        env_data (dict): An object containing information about the map.
        correction_vector (list): The [d_row, d_col] vector of the correction.

    Returns:
        list or None: The final, corrected and pruned trajectory.
    """

    if not deformed_trajectory or len(deformed_trajectory) < 2:
        return original_trajectory

    # --- Setup ---
    impassable_cells = set(map(tuple, env_data.get('cliff_states', []) + env_data.get('o_states', [])))
    grid_rows, grid_cols = env_data['grid_rows'], env_data['grid_cols']

    # --- Helper Functions ---
    def _find_valid_cell_in_direction(start_point, original_point, vector, impassable, rows, cols):
        """
        Searches for a valid cell by following the vector. If none is found before
        the boundary, reverts to the original point.
        """
        # Make sure vector is not zero to prevent infinite loops
        if vector[0] == 0 and vector[1] == 0:
            return tuple(original_point)

        current_r, current_c = start_point
        while 0 <= current_r < rows and 0 <= current_c < cols:
            # Move one step in the vector's direction
            current_r, current_c = current_r + vector[0], current_c + vector[1]
            
            # Check if the new point is within bounds
            if not (0 <= current_r < rows and 0 <= current_c < cols):
                break # Hit the boundary

            # If the cell is valid, we've found our target
            if (current_r, current_c) not in impassable:
                return (current_r, current_c)
        
        # If the loop finishes without finding a valid cell, revert to the original
        # print(f"\033[93mDirectional search failed. Reverting to original point {original_point}\033[0m")
        return tuple(original_point)


    def a_star_search(start, end):
        # A* implementation remains the same
        open_set = [(0, start)]; came_from = {}; g_score = {start: 0}
        while open_set:
            _, current = heapq.heappop(open_set)
            if current == end:
                path = [];
                while current in came_from: path.append(current); current = came_from[current]
                path.append(start); return path[::-1]
            for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                neighbor = (current[0] + dr, current[1] + dc)
                if not (0 <= neighbor[0] < grid_rows and 0 <= neighbor[1] < grid_cols) or neighbor in impassable_cells: continue
                tentative_g_score = g_score[current] + 1
                if tentative_g_score < g_score.get(neighbor, float('inf')):
                    came_from[neighbor] = current; g_score[neighbor] = tentative_g_score
                    f_score = tentative_g_score + abs(neighbor[0] - end[0]) + abs(neighbor[1] - end[1])
                    heapq.heappush(open_set, (f_score, neighbor))
        # print(f"\033[91mA* search failed to find a path from {start} to {end}.\033[0m"); return None

    # --- 1. Validate Waypoints ---
    waypoints = []
    for i, deformed_point in enumerate(deformed_trajectory):
        r, c = map(round, deformed_point)
        current_point = (r, c)
        
        # Check if the deformed point is invalid (out of bounds or on an obstacle)
        if not (0 <= r < grid_rows and 0 <= c < grid_cols and current_point not in impassable_cells):
            # If invalid, perform the new directional search
            original_point = original_trajectory[i]
            valid_point = _find_valid_cell_in_direction(current_point, original_point, correction_vector, impassable_cells, grid_rows, grid_cols)
            waypoints.append(valid_point)
        else:
            # If valid, use the point as is
            waypoints.append(current_point)
    
    unique_waypoints = [waypoints[0]] if waypoints else []
    for point in waypoints[1:]:
        if point != unique_waypoints[-1]: unique_waypoints.append(point)
    # print(f'\033[92mValidated and unique waypoints (tuples): {unique_waypoints}\033[0m')

    # --- 2. Reconstruct Path with A* ---
    path_with_cycles = []
    for i in range(len(unique_waypoints) - 1):
        start_node, end_node = unique_waypoints[i], unique_waypoints[i+1]
        segment = a_star_search(start_node, end_node)
        if segment is None: return None
        path_with_cycles.extend(segment if not path_with_cycles else segment[1:])
    
    if not path_with_cycles: return None
    # print(f'\033[92mPath after A* stitching (before pruning): {path_with_cycles}\033[0m')


    # --- 3. OPTIMIZED Pruning Logic ---
    # The original logic was O(N^2). Using sets for lookups makes it O(N).
    
    # Part 1: Prune simple cycles
    # Remove simple cycles by keeping the first occurrence of each point.
    pruned_path_tuples = []
    visited_nodes = set()
    for point in path_with_cycles:
        if point in visited_nodes:
            # Cycle detected. Rewind path to the point where the cycle started.
            while pruned_path_tuples and pruned_path_tuples[-1] != point:
                visited_nodes.remove(pruned_path_tuples.pop())
        else:
            pruned_path_tuples.append(point)
            visited_nodes.add(point)
    # print(f'\033[92mPath after simple cycle removal: {pruned_path}\033[0m')

    # Part 2: Prune meanders (U-turns)
    # Remove meanders by checking neighbors
    final_pruned_path = [pruned_path_tuples[0]]
    final_path_set = {pruned_path_tuples[0]} # Use a set for fast O(1) lookups

    for point in pruned_path_tuples[1:]:
        rewind_target = None
        neighbors = [(point[0] + dr, point[1] + dc) for dr, dc in [(0, 1), (1, 0), (0, -1), [-1, 0]]]
        for neighbor in neighbors:
            if neighbor in final_path_set and neighbor != final_pruned_path[-1]:
                rewind_target = neighbor
                break
        
        if rewind_target:
            # Meander detected. Rewind the final path back to the neighbor.
            while final_pruned_path and final_pruned_path[-1] != rewind_target:
                final_path_set.remove(final_pruned_path.pop())
        
        # Add the current point if it's not a duplicate of the last one.
        if not final_pruned_path or final_pruned_path[-1] != point:
            final_pruned_path.append(point)
            final_path_set.add(point)
    # print(f'\03g[92mFinal pruned path: {final_pruned_path}\033[0m')

    # final_pruned_path = path_with_cycles
    
    # Convert back to list of lists for the final output format
    return [list(p) for p in final_pruned_path]