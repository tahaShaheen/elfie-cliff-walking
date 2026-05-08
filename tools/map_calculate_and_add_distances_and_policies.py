# calculate_and_add_distances_and_policies.py

# TO use python map_calculate_and_add_distances_and_policies.py <path_to_yaml_file> <path_to_output_file>

import yaml
import argparse
import os
import random
import numpy as np
import json
from shapely.geometry import LineString
from shapely import frechet_distance
from dtw import dtw
from scipy.spatial.distance import euclidean

# --- Assumed Imports from your project ---
try:
    from policy_manager import run_policy_iteration
    from server_helpers import generate_trajectory_from_policy
    from tools.map_sorter import sort_environments # NEW: Import the sorter function
except ImportError:
    print("Error: Make sure 'policy_manager.py', 'server_helpers.py', and 'map_sorter.py' are accessible.")
    exit()


def find_start_goal(grid):
    """Finds the (row, col) coordinates of the Start ('S') and Goal ('G') cells."""
    start_pos, goal_pos = None, None
    for r, row_str in enumerate(grid):
        for c, char in enumerate(row_str):
            if char == 'S':
                start_pos = (r, c)
            elif char == 'G':
                goal_pos = (r, c)
    return start_pos, goal_pos

def calculate_frechet_distance(path_a, path_b):
    """Calculates the continuous Fréchet distance between two paths."""
    if not path_a or len(path_a) < 2 or not path_b or len(path_b) < 2:
        return None
    line_a = LineString(path_a)
    line_b = LineString(path_b)
    return frechet_distance(line_a, line_b)

def calculate_dtw_distance(path_a, path_b):
    """Calculates the Dynamic Time Warping distance between two trajectories."""
    if not path_a or not path_b:
        return None
    t1 = np.array(path_a)
    t2 = np.array(path_b)
    alignment = dtw(t1, t2, dist_method=euclidean)
    return alignment.distance

def process_maps(input_file, output_file, policy_config):
    """
    Loads a YAML file, filters for unique maps, calculates data, sorts, and saves.
    """
    print(f"Loading maps from: {input_file}")
    try:
        with open(input_file, 'r') as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"Error: Input file not found at '{input_file}'")
        return

    if 'environments' not in data or not data['environments']:
        print("Error: No 'environments' found in the YAML file.")
        return

    original_environments = data['environments']
    
    print("\n--- Checking for duplicate map layouts... ---")
    seen_layouts = {}
    unique_environments = {}
    for map_id, map_data in original_environments.items():
        grid = map_data.get('map_layout')
        if not grid:
            print(f"INFO: Skipping '{map_id}' because it has no map_layout.")
            continue
        
        layout_as_tuple = tuple(grid)
        
        if layout_as_tuple in seen_layouts:
            original_map_id = seen_layouts[layout_as_tuple]
            print(f"INFO: Skipping duplicate map '{map_id}'. It is identical to '{original_map_id}'.")
        else:
            seen_layouts[layout_as_tuple] = map_id
            unique_environments[map_id] = map_data
    
    total_original = len(original_environments)
    total_unique = len(unique_environments)
    print(f"--- Found {total_unique} unique maps out of {total_original} total maps. ---\n")

    total_maps_to_process = len(unique_environments)
    print(f"Processing {total_maps_to_process} unique maps.")

    for i, (map_id, map_data) in enumerate(unique_environments.items()):
        print(f"Processing map {i+1}/{total_maps_to_process}: {map_id}...", end='', flush=True)

        grid = map_data.get('map_layout')
        start_pos, goal_pos = find_start_goal(grid)
        if not start_pos or not goal_pos:
            print(f" -> SKIPPED (Start/Goal not found)")
            continue
        
        map_data['map_height'] = len(grid)
        map_data['map_width'] = len(grid[0])
        # NEW: Add the number of holes
        map_data['hole_count'] = sum(row.count('H') for row in grid)

        try:
            np.random.seed(42)
            random.seed(42)

            rewards_list = policy_config.get('REWARDS', [-100, 10, -1, -1, -1])
            if len(rewards_list) < 5:
                rewards_list.extend([-1] * (5 - len(rewards_list)))

            common_args = {
                "cliff_map": grid,
                "discount_factor": policy_config.get('DISCOUNT_FACTOR'),
                "probability_denominator": policy_config.get('PROBABILITY_DENOMINATOR'),
                "rewards": rewards_list,
                "print_converged_message": False,
            }
            policy_nonslippery = run_policy_iteration(slippery=False, **common_args)
            policy_slippery = run_policy_iteration(slippery=True, **common_args)

            traj_nonslippery = generate_trajectory_from_policy(policy_nonslippery, len(grid), len(grid[0]), start_pos, goal_pos)
            traj_slippery = generate_trajectory_from_policy(policy_slippery, len(grid), len(grid[0]), start_pos, goal_pos)

            frechet_dist = calculate_frechet_distance(traj_nonslippery, traj_slippery)
            dtw_dist = calculate_dtw_distance(traj_nonslippery, traj_slippery)

            if frechet_dist is not None:
                map_data['frechet_distance'] = float(f"{frechet_dist:.2f}")
            if dtw_dist is not None:
                map_data['dtw_distance'] = float(f"{dtw_dist:.2f}")
            
            map_data['policy_group_b1'] = json.dumps(policy_nonslippery, separators=(',', ':'))
            map_data['policy_group_b2'] = json.dumps(policy_slippery, separators=(',', ':'))

            print(f" -> Done (Frechet: {frechet_dist:.2f}, DTW: {dtw_dist:.2f}, Policies Saved)")

        except Exception as e:
            print(f" -> ERROR ({e})")
            continue

    data['environments'] = unique_environments
    
    # NEW: Sort the processed data before saving
    print("\n--- Sorting the processed maps... ---")
    sorted_data = sort_environments(data)
    print("Sorting complete.")
    
    try:
        output_dir = os.path.dirname(output_file)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        with open(output_file, 'w') as f:
            yaml.dump(sorted_data, f, default_flow_style=False, sort_keys=False)
        print(f"\nSuccessfully processed and sorted all unique maps. Results saved to: {output_file}")

    except Exception as e:
        print(f"\nError saving output file: {e}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description="Calculate data for maps, check for duplicates, sort them, and save."
    )
    parser.add_argument(
        "input_file", type=str, help="Path to the input YAML file."
    )
    parser.add_argument(
        "output_file", type=str, help="Path to save the new sorted YAML file."
    )
    args = parser.parse_args()

    policy_config = {}
    try:
        with open('game_data.yaml', 'r') as f:
            game_data = yaml.safe_load(f)
            policy_config = game_data.get('policy_generation_config', {})
        print("Loaded policy configuration from game_data.yaml")
    except FileNotFoundError:
        print("Warning: game_data.yaml not found. Using default policy config.")
        policy_config = {
            'DISCOUNT_FACTOR': 0.9,
            'PROBABILITY_DENOMINATOR': 3,
            'REWARDS': [-100, 10, -1, -1, -1]
        }

    process_maps(args.input_file, args.output_file, policy_config)