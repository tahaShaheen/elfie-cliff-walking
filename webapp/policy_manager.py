import numpy as np
import yaml
import os
import json

def _map_breakdown(cliff_map):
    """
    A helper to parse the map layout.
    """
    height = len(cliff_map)
    width = len(cliff_map[0])
    flattened_map = [item for sublist in cliff_map for item in sublist]
    
    HOLE_STATES = [i for i, x in enumerate(flattened_map) if x == "H"]
    GOAL_STATES = [i for i, x in enumerate(flattened_map) if x == "G"]
    X_STATES = [i for i, x in enumerate(flattened_map) if x == "X"]
    Y_STATES = [i for i, x in enumerate(flattened_map) if x == "Y"]
    O_STATES = [i for i, x in enumerate(flattened_map) if x == "O"]
    
    left_most = [i for i in range(len(flattened_map)) if i % width == 0]
    right_most = [i for i in range(len(flattened_map)) if i % width == width - 1]
    top_most = [i for i in range(width)]
    bottom_most = [i for i in range(len(flattened_map)) if i >= (height - 1) * width]

    map_breakdown = {
        "flattened_map": flattened_map,
        "height": height,
        "width": width,
        "hole_states": HOLE_STATES,
        "goal_states": GOAL_STATES,
        "x_states": X_STATES,
        "y_states": Y_STATES,
        "o_states": O_STATES,
        "left_most": left_most,
        "right_most": right_most,
        "top_most": top_most,
        "bottom_most": bottom_most,
    }

    return map_breakdown

def run_policy_iteration(cliff_map, slippery, discount_factor, probability_denominator, rewards, print_converged_message=True):
    """
    A new, standard implementation of the Policy Iteration algorithm.
    It alternates between Policy Evaluation and Policy Improvement until the optimal policy is found.
    """
    map_breakdown = _map_breakdown(cliff_map)
    n_states = len(map_breakdown['flattened_map'])
    n_actions = 5 # 0: Left, 1: Down, 2: Right, 3: Up, -1: Stay

    GOAL_STATES = map_breakdown['goal_states']
    HOLE_STATES = map_breakdown['hole_states']
    left_most = map_breakdown['left_most']
    right_most = map_breakdown['right_most']
    top_most = map_breakdown['top_most']
    bottom_most = map_breakdown['bottom_most']
    MAP_HEIGHT = map_breakdown['height']
    MAP_WIDTH = map_breakdown['width']
    X_STATES = map_breakdown['x_states']
    Y_STATES = map_breakdown['y_states']
    O_STATES = map_breakdown['o_states']

    # Identify all states that are adjacent to any hole or 'O' obstacle.
    adjacent_to_hole_states = set()
    for state_idx in range(n_states):
        if state_idx in GOAL_STATES or state_idx in HOLE_STATES: # Use combined set
            continue

        r, c = state_idx // MAP_WIDTH, state_idx % MAP_WIDTH
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = r + dr, c + dc

            if 0 <= nr < MAP_HEIGHT and 0 <= nc < MAP_WIDTH:
                neighbor_state = nr * MAP_WIDTH + nc
                if neighbor_state in HOLE_STATES: # Use combined set
                    adjacent_to_hole_states.add(state_idx)
                    break 

    # 1. Initialization
    policy = np.random.randint(0, n_actions, size=n_states)
    # --- CHANGE: Ensure policy does not assign actions to any obstacle ---
    for state in GOAL_STATES + HOLE_STATES:
        policy[state] = -1 
    V = np.zeros(n_states)

    policy_iteration_count = 0
    while True:
        policy_iteration_count += 1

        # --- Step 1: Policy Evaluation ---
        V_old = V.copy()
        eval_iteration_count = 1000
        for i in range(eval_iteration_count):
            V_prev = V.copy()
            for state in range(n_states):
                # --- CHANGE: Check against combined obstacles ---
                if state in GOAL_STATES or state in HOLE_STATES:
                    continue

                action = policy[state]
                expected_value = 0
                if slippery and state in adjacent_to_hole_states:
                    # ... (slippery logic remains the same, but will now use the updated OBSTACLE_STATES implicitly)
                    intended_next_state = state
                    if action == 0 and state not in left_most: intended_next_state -= 1
                    elif action == 1 and state not in bottom_most: intended_next_state += MAP_WIDTH
                    elif action == 2 and state not in right_most: intended_next_state += 1
                    elif action == 3 and state not in top_most: intended_next_state -= MAP_WIDTH
                    elif action == -1: intended_next_state = state

                    if intended_next_state in O_STATES:
                        intended_next_state = state # Revert move if it's into an obstacle

                    reward_intended_direction = rewards[2]
                    if intended_next_state in GOAL_STATES: reward_intended_direction = rewards[1]
                    elif intended_next_state in HOLE_STATES: reward_intended_direction = rewards[0]
                    elif intended_next_state in X_STATES: reward_intended_direction = rewards[3]

                    prob_intended_direction = 1.0 - (1.0 / probability_denominator)
                    expected_value += prob_intended_direction * (reward_intended_direction + discount_factor * V_prev[intended_next_state])

                    r, c = state // MAP_WIDTH, state % MAP_WIDTH
                    adjacent_holes = [s for s in [(r-1,c),(r+1,c),(r,c-1),(r,c+1)] if 0<=s[0]<MAP_HEIGHT and 0<=s[1]<MAP_WIDTH and (s[0]*MAP_WIDTH+s[1]) in HOLE_STATES] # Use combined set
                    if adjacent_holes:
                        prob_slip_per_hole = (1.0 / probability_denominator) / len(adjacent_holes)
                        for hole_r, hole_c in adjacent_holes:
                            hole_state = hole_r * MAP_WIDTH + hole_c
                            reward_slip = rewards[0]
                            expected_value += prob_slip_per_hole * (reward_slip + discount_factor * V_prev[hole_state])
                else:
                    next_state = state
                    if action == 0 and state not in left_most: next_state -= 1
                    elif action == 1 and state not in bottom_most: next_state += MAP_WIDTH
                    elif action == 2 and state not in right_most: next_state += 1
                    elif action == 3 and state not in top_most: next_state -= MAP_WIDTH
                    elif action == -1: next_state = state

                    if next_state in O_STATES:
                        next_state = state # Revert move if it's into an obstacle

                    reward_val = rewards[2]
                    if next_state in GOAL_STATES: reward_val = rewards[1]
                    elif next_state in HOLE_STATES: reward_val = rewards[0]
                    elif next_state in X_STATES: reward_val = rewards[3]
                    elif next_state in Y_STATES: reward_val = rewards[4]

                    expected_value = reward_val + discount_factor * V_prev[next_state]

                V[state] = expected_value

            if np.max(np.abs(V - V_prev)) < 1e-6:
                break

        # --- Step 2: Policy Improvement (Logic mirrors changes from Policy Evaluation) ---
        policy_stable = True
        for state in range(n_states):
            # --- CHANGE: Check against combined obstacles ---
            if state in GOAL_STATES or state in HOLE_STATES:
                continue

            old_action = policy[state]
            q_values = np.zeros(n_actions)
            for action in range(n_actions):
                expected_value = 0
                if slippery and state in adjacent_to_hole_states:
                    # ... (slippery logic is updated implicitly by using OBSTACLE_STATES)
                    intended_next_state = state
                    if action == 0 and state not in left_most: intended_next_state -= 1
                    elif action == 1 and state not in bottom_most: intended_next_state += MAP_WIDTH
                    elif action == 2 and state not in right_most: intended_next_state += 1
                    elif action == 3 and state not in top_most: intended_next_state -= MAP_WIDTH
                    elif action == -1: intended_next_state = state

                    if intended_next_state in O_STATES:
                        intended_next_state = state # Revert move if it's into an obstacle

                    reward_intended_direction = rewards[2]
                    if intended_next_state in GOAL_STATES: reward_intended_direction = rewards[1]
                    elif intended_next_state in HOLE_STATES: reward_intended_direction = rewards[0]
                    elif intended_next_state in X_STATES: reward_intended_direction = rewards[3]

                    prob_intended_direction = 1.0 - (1.0 / probability_denominator)
                    expected_value += prob_intended_direction * (reward_intended_direction + discount_factor * V[intended_next_state])

                    r, c = state // MAP_WIDTH, state % MAP_WIDTH
                    adjacent_holes = [s for s in [(r-1,c),(r+1,c),(r,c-1),(r,c+1)] if 0<=s[0]<MAP_HEIGHT and 0<=s[1]<MAP_WIDTH and (s[0]*MAP_WIDTH+s[1]) in HOLE_STATES] # Use combined set
                    if adjacent_holes:
                        prob_slip_per_hole = (1.0 / probability_denominator) / len(adjacent_holes)
                        for hole_r, hole_c in adjacent_holes:
                            hole_state = hole_r * MAP_WIDTH + hole_c
                            reward_slip = rewards[0]
                            expected_value += prob_slip_per_hole * (reward_slip + discount_factor * V[hole_state])
                else:
                    next_state = state
                    if action == 0 and state not in left_most: next_state -= 1
                    elif action == 1 and state not in bottom_most: next_state += MAP_WIDTH
                    elif action == 2 and state not in right_most: next_state += 1
                    elif action == 3 and state not in top_most: next_state -= MAP_WIDTH
                    elif action == -1: next_state = state

                    if next_state in O_STATES:
                        next_state = state # Revert move if it's into an obstacle

                    reward_val = rewards[2]
                    if next_state in GOAL_STATES: reward_val = rewards[1]
                    elif next_state in HOLE_STATES: reward_val = rewards[0]
                    elif next_state in X_STATES: reward_val = rewards[3]
                    elif next_state in Y_STATES: reward_val = rewards[4]

                    expected_value = reward_val + discount_factor * V[next_state]

                q_values[action] = expected_value

            policy[state] = np.argmax(q_values)

            if old_action != policy[state]:
                policy_stable = False

        if policy_stable:
            if print_converged_message:
                print(f"  - Policy converged after {policy_iteration_count} iterations (slippery={slippery}).")
            break

    # --- CHANGE: Call the new print function before returning ---
    if print_converged_message:
        _print_policy_to_terminal(policy, map_breakdown)

    return policy.tolist()

# --- The rest of the policy_manager.py file remains the same ---
def check_and_generate_policies():
    yaml_file_path = 'game_data.yaml'
    print("\n--- Policy Manager ---")
    if not os.path.exists(yaml_file_path):
        print(f"[policy_manager.py] Warning: {yaml_file_path} not found. Skipping policy generation.")
        return
    with open(yaml_file_path, 'r') as f:
        game_data = yaml.safe_load(f)
    policy_config = game_data.get('policy_generation_config', {})
    DISCOUNT_FACTOR = policy_config.get('DISCOUNT_FACTOR', 0.9)
    PROBABILITY_DENOMINATOR = policy_config.get('PROBABILITY_DENOMINATOR', 3)
    REWARDS = policy_config.get('REWARDS', [-100, 10, -1])
    environments = game_data.get('environments', {})
    if not environments:
        print("No environments found in YAML file. Nothing to do.")
        return
    yaml_changed = False
    for env_id, env_data in environments.items():
        print(f"Checking policies for environment: '{env_id}' ({env_data.get('name', '')})")
        map_layout = env_data.get('map_layout')
        if not map_layout:
            print(f"  - Skipping '{env_id}' due to missing 'map_layout'.")
            continue
        common_args = {
            "cliff_map": map_layout,
            "discount_factor": DISCOUNT_FACTOR,
            "probability_denominator": PROBABILITY_DENOMINATOR,
            "rewards": REWARDS
        }
        if 'policy_group_b1' not in env_data:
            print(f"  - Missing non-slippery policy (policy_group_b1). Generating...")
            policy_b1 = run_policy_iteration(slippery=False, **common_args)
            game_data['environments'][env_id]['policy_group_b1'] = json.dumps(policy_b1, separators=(',', ':'))
            yaml_changed = True
        else:
            print(f"  - Non-slippery policy found.")
        if 'policy_group_b2' not in env_data:
            print(f"  - Missing slippery policy (policy_group_b2). Generating...")
            policy_b2 = run_policy_iteration(slippery=True, **common_args)
            game_data['environments'][env_id]['policy_group_b2'] = json.dumps(policy_b2, separators=(',', ':'))
            yaml_changed = True
        else:
            print(f"  - Slippery policy found.")
    if yaml_changed:
        print("\nSaving updated policies to game_data.yaml...")
        with open(yaml_file_path, 'w') as f:
            yaml.dump(game_data, f, default_flow_style=False, sort_keys=False)
        print("Save complete.")
    else:
        print("\nAll policies are up to date. No changes made.")
    print("--- Policy Manager Finished ---\n")

def delete_all_policies():
    yaml_file_path = 'game_data.yaml'
    print("\n--- Deleting All Policies ---")
    if not os.path.exists(yaml_file_path):
        print(f"Warning: {yaml_file_path} not found. Nothing to delete.")
        return
    with open(yaml_file_path, 'r') as f:
        game_data = yaml.safe_load(f)
    environments = game_data.get('environments', {})
    if not environments:
        print("No environments found in YAML file. Nothing to do.")
        return
    policies_deleted = False
    policy_keys_to_remove = ['policy_group_a1', 'policy_group_a2', 'policy_group_b1', 'policy_group_b2']
    for env_id, env_data in environments.items():
        keys_found = [key for key in policy_keys_to_remove if key in env_data]
        if keys_found:
            for key in keys_found:
                del env_data[key]
                print(f"  - Removed '{key}' from environment: '{env_id}'")
            policies_deleted = True
    if policies_deleted:
        print("\nSaving file with policies removed...")
        with open(yaml_file_path, 'w') as f:
            yaml.dump(game_data, f, default_flow_style=False, sort_keys=False)
        print("Save complete.")
    else:
        print("\nNo policies found to delete.")
    print("--- Policy Deletion Finished ---\n")


def _print_policy_to_terminal(policy, map_data):
    """Visualizes the policy as arrows in the terminal."""
    action_to_arrow = {0: "←", 1: "↓", 2: "→", 3: "↑", 4: "#", -1: "*"}
    width = map_data['width']
    height = map_data['height']
    flat_map = map_data['flattened_map']

    print("\n" + "="*36)
    print("Generated Policy:")

    grid = []
    for r in range(height):
        row_str = []
        for c in range(width):
            state_index = r * width + c
            char = flat_map[state_index]
            action = policy[state_index]

            # For special tiles, just show the tile character
            if char in ['K']: #'G', 'H', 'O', 'S']: #, 'X', 'Y']:
                # row_str.append(f'{char}({action_to_arrow.get(action, "?")})') # Trying to show action with tile but it throws off the layout
                row_str.append(char)
            # For all other tiles, show the policy's action
            else:
                row_str.append(action_to_arrow.get(action, "?"))
        grid.append(" ".join(row_str))

    print("\n".join(grid))
    print("="*36 + "\n")