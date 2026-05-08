# map_generator.py


import yaml
import random
import os
import numpy as np
from collections import deque
from shapely.geometry import LineString
import time
from shapely import frechet_distance
from dtw import dtw
from scipy.spatial.distance import euclidean
import json
import multiprocessing
from tqdm import tqdm

# Import functions from your existing project files
from policy_manager import run_policy_iteration
from server_helpers import generate_trajectory_from_policy

# --- Configuration ---
MAP_ROWS = 6
MAP_COLS = 12
MIN_HOLES = 12
MAX_HOLES = 25
NUM_MAPS_TO_GENERATE = 20 # 50 maps + 1 practice map (unchanging and always the same)
STEPS_MATCH_THRESHOLD = 3 # Number of steps that each policy's optimal trajectory must initially have in common (start + 2 more steps)
DIVERSITY_DIFFERENCE = 1.5 # The difference from the maximum possible Fréchet distance to consider a map diverse
DTW_DIVERSITY_DIFFERENCE = 50.0 # The difference from the maximum possible DTW to consider a map diverse (smaller number means more diverse maps)
OUTPUT_YAML_PATH = os.path.join('yamls', 'generated_environments.yaml')

game_data = None
POLICY_CONFIG = {}

def is_solvable(grid, start_pos, goal_pos):
    """
    Checks if a path exists from start_pos to goal_pos using Breadth-First Search (BFS).
    Holes ('H') are treated as impassable walls.
    """
    queue = deque([start_pos])
    visited = {start_pos}

    while queue:
        r, c = queue.popleft()

        if (r, c) == goal_pos:
            return True  # Path found

        for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:  # Right, Left, Down, Up
            nr, nc = r + dr, c + dc

            if 0 <= nr < MAP_ROWS and 0 <= nc < MAP_COLS and (nr, nc) not in visited:
                if grid[nr][nc] != 'H':
                    visited.add((nr, nc))
                    queue.append((nr, nc))

    return False  # No path found

def calculate_jaccard_distance(path_a, path_b):
    """
    Calculates a diversity score based on the number of non-overlapping cells.
    Returns a float between 0.0 (identical paths) and 1.0.
    Uses Jaccard distance as a measure of diversity.
    Jaccard distance = 1 - (intersection / union)
    """
    set_a = set(tuple(p) for p in path_a)
    set_b = set(tuple(p) for p in path_b)
    
    union_size = len(set_a.union(set_b))
    intersection_size = len(set_a.intersection(set_b))
    
    if union_size == 0:
        return 0.0
        
    # Jaccard distance: 1 - (intersection / union)
    return 1.0 - (intersection_size / union_size)


# same_length_trajs = 0
# different_length_trajs = 0
def calculate_frechet_distance(path_a, path_b):
    """
    Calculates the continuous Fréchet distance between two paths using the Shapely library.

    The Fréchet distance is a measure of similarity between curves that takes into account
    the location and ordering of points along the curves. Shapely calculates the continuous
    Fréchet distance.

    Args:
        path_a (list of tuples/lists): A list of (x, y) coordinates for the first path.
        path_b (list of tuples/lists): A list of (x, y) coordinates for the second path.

    Returns:
        float: A float representing the distance. If the paths are identical, the distance will be 0.0.
    """
    # Shapely's frechet_distance function requires LineString objects.
    # path_a = [[0,0], [0,1], [0,2], [0,3], [0,4], [0,5], [0,6], [0,7], [0,8], [0,9], [0,10], [0,11]]
    # path_b = [[0,0], [1,0], [2,0], [3,0], [4,0], [4,1], [4,2], [4,3], [4,4], [4,5], [4,6], [4,7], [4,8], [4,9], [4,10], [4,11], \
    #           [3,11], [2,11], [1,11], [0,11]]
    # Max frechet distance is 4.0 for paths that are completely different in this map size.


    line_a = LineString(path_a)
    line_b = LineString(path_b)

    # print(f"Path A: {line_a}")
    # print(f"Path B: {line_b}")

    # if len(path_a) == len(path_b):
    #     global same_length_trajs
    #     same_length_trajs += 1
    # else:
    #     global different_length_trajs
    #     different_length_trajs += 1

    # Calculate and return the Fréchet distance.
    distance = frechet_distance(line_a, line_b)

    # print(f"Calculated Fréchet distance using Shapely: {distance:.2f} between paths of lengths {len(path_a)} and {len(path_b)}")
    # print(f"Same Length Trajs: {same_length_trajs}| Different Length Trajs: {different_length_trajs}")
    return distance

def calculate_dtw(trajectory1, trajectory2):
    """
    Calculates the Dynamic Time Warping distance between two trajectories.
    """
    # The dtw library requires numpy arrays
    t1 = np.array(trajectory1)
    t2 = np.array(trajectory2)
    
    # Calculate DTW distance using Euclidean distance for point-to-point comparison
    alignment = dtw(t1, t2, dist_method=euclidean)
    
    return alignment.distance


def are_holes_away_from_start_goal(hole_positions, start_pos, goal_pos):
    """
    Checks that no hole is directly adjacent (up, down, left, or right) 
    to the start or goal positions.
    """
    for r_h, c_h in hole_positions:
        # Check proximity to start_pos using Manhattan distance
        if abs(r_h - start_pos[0]) + abs(c_h - start_pos[1]) == 1:
            return False  # A hole is adjacent to the start
        # Check proximity to goal_pos
        if abs(r_h - goal_pos[0]) + abs(c_h - goal_pos[1]) == 1:
            return False  # A hole is adjacent to the goal
    return True

def are_all_holes_clumped(hole_positions):
    """
    Checks if EVERY hole is adjacent to at least one other hole.
    Returns False if any individual, non-clumped hole is found.
    """
    positions_set = set(hole_positions)
    if not positions_set:
        return True  # No holes, so the condition is trivially met.

    for r, c in positions_set:
        # Check all four neighbors to see if any are also holes
        is_clumped = (
            (r, c + 1) in positions_set or
            (r, c - 1) in positions_set or
            (r + 1, c) in positions_set or
            (r - 1, c) in positions_set
        )
        if not is_clumped:
            return False  # Found an isolated hole
            
    return True  # All holes were checked and are part of a clump

def generate_one_map_attempt(args_tuple):
    """
    Worker function to perform a single map generation attempt.
    Returns map_data if successful, otherwise None.
    """
    # Unpack arguments
    metric_choice, diversity_threshold, policy_config = args_tuple

    # 1. Choose start and goal positions
    corners = [(0, 0), (0, MAP_COLS - 1), (MAP_ROWS - 1, 0), (MAP_ROWS - 1, MAP_COLS - 1)]
    start_pos = random.choice(corners)
    goal_pos = (start_pos[0], MAP_COLS - 1 - start_pos[1]) if start_pos[0] == 0 else (start_pos[0], 0) # Place it on the opposite side of the map

    # 2. Place random holes
    num_holes = random.randint(MIN_HOLES, MAX_HOLES)
    hole_positions = set()
    while len(hole_positions) < num_holes:
        r, c = random.randint(0, MAP_ROWS - 1), random.randint(0, MAP_COLS - 1)
        if (r, c) != start_pos and (r, c) != goal_pos:
            hole_positions.add((r, c))

    # 3. Apply filters
    if not are_holes_away_from_start_goal(hole_positions, start_pos, goal_pos) or \
       not are_all_holes_clumped(hole_positions):
        return None

    # 4. Create grid
    grid = [['F' for _ in range(MAP_COLS)] for _ in range(MAP_ROWS)]
    grid[start_pos[0]][start_pos[1]] = 'S'
    grid[goal_pos[0]][goal_pos[1]] = 'G'
    for r, c in hole_positions:
        grid[r][c] = 'H'

    if not is_solvable(grid, start_pos, goal_pos):
        return None

    # 5. Generate policies and check for diversity
    try:
        common_args = {
            "cliff_map": grid, "discount_factor": policy_config.get('DISCOUNT_FACTOR', 0.9),
            "probability_denominator": policy_config.get('PROBABILITY_DENOMINATOR', 3),
            "rewards": policy_config.get('REWARDS', [-100, 10, -1]),
            "print_converged_message": False,
        }
        policy_nonslippery = run_policy_iteration(slippery=False, **common_args)
        policy_slippery = run_policy_iteration(slippery=True, **common_args)

        traj_nonslippery = generate_trajectory_from_policy(policy_nonslippery, MAP_ROWS, MAP_COLS, start_pos, goal_pos)
        traj_slippery = generate_trajectory_from_policy(policy_slippery, MAP_ROWS, MAP_COLS, start_pos, goal_pos)

        # Path Filters
        if not traj_nonslippery or tuple(traj_nonslippery[-1]) != goal_pos or \
           not traj_slippery or tuple(traj_slippery[-1]) != goal_pos or \
           traj_nonslippery == traj_slippery or \
           len(traj_nonslippery) < STEPS_MATCH_THRESHOLD or len(traj_slippery) < STEPS_MATCH_THRESHOLD or \
           traj_nonslippery[:STEPS_MATCH_THRESHOLD] != traj_slippery[:STEPS_MATCH_THRESHOLD] or \
           traj_nonslippery[STEPS_MATCH_THRESHOLD] == traj_slippery[STEPS_MATCH_THRESHOLD]:
            return None

        # Final Diversity Filter
        frechet_dist = calculate_frechet_distance(traj_nonslippery, traj_slippery)
        dtw_dist = calculate_dtw(traj_nonslippery, traj_slippery)
        distance_to_check = frechet_dist if metric_choice == 'frechet' else dtw_dist

        if distance_to_check >= diversity_threshold:
            map_data = {
                "map_layout": ["".join(row) for row in grid],
                "frechet_distance": float(f"{frechet_dist:.2f}"),
                "dtw_distance": float(f"{dtw_dist:.2f}"),
                "policy_group_b1": json.dumps(policy_nonslippery, separators=(',', ':')),
                "policy_group_b2": json.dumps(policy_slippery, separators=(',', ':'))
            }
            return map_data
    except Exception:
        return None

    return None

def generate_maps(metric_choice='frechet'):
    """
    Main function to generate, filter, and save maps in parallel.
    """
    print(f"--- Starting Parallel Map Generation using {metric_choice.upper()} metric ---")
    if os.path.exists(OUTPUT_YAML_PATH):
        os.remove(OUTPUT_YAML_PATH)

    # --- Set Diversity Threshold ---
    # This calculation is done once in the main process.

    DIVERSITY_THRESHOLD = 0.0
    if metric_choice == 'frechet':
    
        smallest_path = [[0, c] for c in range(MAP_COLS)]
    
        longest_path = [[r, 0] for r in range(MAP_ROWS)] + \
                       [[MAP_ROWS - 1, c] for c in range(1, MAP_COLS)] + \
                       [[r, MAP_COLS - 1] for r in range(MAP_ROWS - 2, -1, -1)]
    
        max_dist = calculate_frechet_distance(smallest_path, longest_path)
    
        DIVERSITY_THRESHOLD = max_dist - DIVERSITY_DIFFERENCE
        print(f"Max Fréchet distance is {max_dist:.2f}. Seeking maps with distance >= {DIVERSITY_THRESHOLD:.2f}.")
    elif metric_choice == 'dtw':
    
        smallest_path = [[0, c] for c in range(MAP_COLS)]
    
        longest_path = [[r, 0] for r in range(MAP_ROWS)] + \
                       [[MAP_ROWS - 1, c] for c in range(1, MAP_COLS)] + \
                       [[r, MAP_COLS - 1] for r in range(MAP_ROWS - 2, -1, -1)]
        max_dist = calculate_dtw(smallest_path, longest_path)
    
        DIVERSITY_THRESHOLD = max_dist - DTW_DIVERSITY_DIFFERENCE
        print(f"Max DTW distance is {max_dist:.2f}. Seeking maps with distance >= {DIVERSITY_THRESHOLD:.2f}.")

    # --- Parallel Processing ---
    found_maps = []
    num_cpus = multiprocessing.cpu_count()
    print(f"Utilizing {num_cpus} CPU cores for generation...")

    args_tuple = (metric_choice, DIVERSITY_THRESHOLD, POLICY_CONFIG)

    # A simple generator to provide a continuous stream of tasks to the workers.
    def task_generator(args):
        while True:
            yield args

    # Use a single progress bar that tracks found maps and displays total attempts.
    attempts_counter = 0
    with multiprocessing.Pool(processes=num_cpus) as pool, \
         tqdm(total=NUM_MAPS_TO_GENERATE, desc="Finding diverse maps", unit=" map") as pbar:
        
        # Process tasks from the continuous stream.
        for result in pool.imap_unordered(generate_one_map_attempt, task_generator(args_tuple)):
            attempts_counter += 1
            # Update a postfix to show the running attempt count.
            pbar.set_postfix_str(f"Attempts: {attempts_counter:,}", refresh=True)

            if result:
                found_maps.append(result)
                pbar.update(1)  # Increment the progress bar for each map found.
                if len(found_maps) >= NUM_MAPS_TO_GENERATE:
                    pool.terminate() # Stop all worker processes immediately.
                    break

    # --- Finalizing and Saving ---
    if not found_maps:
        print("\nNo diverse maps were found after all attempts.")
        return

    print(f"\nGeneration complete. Found {len(found_maps)} total maps. Selecting the first {NUM_MAPS_TO_GENERATE} and saving...")


    final_maps_data = {"environments": {}}

    for i, map_data in enumerate(found_maps[:NUM_MAPS_TO_GENERATE]):
    
        map_id = f"gen_map_{i + 1}"
    
        map_data["name"] = f"Generated Map {i + 1}"
    
        final_maps_data["environments"][map_id] = map_data
    

    os.makedirs(os.path.dirname(OUTPUT_YAML_PATH), exist_ok=True)
    with open(OUTPUT_YAML_PATH, 'w') as f:
    
        yaml.dump(final_maps_data, f, default_flow_style=False, sort_keys=False)
    
    print(f"\nSuccessfully saved {len(final_maps_data['environments'])} maps to '{OUTPUT_YAML_PATH}'.")

if __name__ == '__main__':
    """
    To use the new DTW metric:
    python map_generator.py --metric dtw

    To use the original Fréchet metric:
    python map_generator.py --metric frechet
    """
    import argparse
    parser = argparse.ArgumentParser(description="Generate diverse maps for the game.")
    parser.add_argument(
        '--metric',
        type=str,
        default='frechet',
        choices=['frechet', 'dtw'],
        help='The diversity metric to use for filtering maps (default: frechet).'
    )
    args = parser.parse_args()

    # Get the policy config from the main game data to run the policy generator
    try:
        with open('game_data.yaml', 'r') as f:
            game_data = yaml.safe_load(f)
            POLICY_CONFIG = game_data.get('policy_generation_config', {})
    except FileNotFoundError:
        print("[map_generator.py] Warning: game_data.yaml not found. Using default policy config.")
        POLICY_CONFIG = {'DISCOUNT_FACTOR': 0.9, 'PROBABILITY_DENOMINATOR': 3, 'REWARDS': [-100, 10, -1]}

    # Pass the chosen metric to the generator function
    generate_maps(metric_choice=args.metric)