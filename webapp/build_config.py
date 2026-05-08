# build_config.py
import yaml
import os

SOURCE_DIR = 'yamls'
OUTPUT_FILE = 'game_data.yaml'

def build():
    """
    Finds all .yaml files in the source directory, merges them,
    and writes the result to a single output file.
    """
    print(f"--- Building {OUTPUT_FILE} from '{SOURCE_DIR}' directory ---")

    # Find all files ending with .yaml or .yml in the source directory
    try:
        source_files = [f for f in os.listdir(SOURCE_DIR) if f.endswith(('.yaml', '.yml'))]
        if not source_files:
            print(f"WARNING: No YAML files found in '{SOURCE_DIR}'. Output will be empty.")
    except FileNotFoundError:
        print(f"ERROR: Source directory '{SOURCE_DIR}' not found. Cannot build config.")
        return

    merged_data = {}

    # Loop through each source file and merge its contents
    for file_name in source_files:
        file_path = os.path.join(SOURCE_DIR, file_name)
        print(f"  - Merging {file_path}...")
        with open(file_path, 'r') as f:
            data = yaml.safe_load(f)
            if data:
                merged_data.update(data)

    # Write the final, merged dictionary to the output file
    with open(OUTPUT_FILE, 'w') as f:
        yaml.dump(merged_data, f, default_flow_style=False, sort_keys=False)

    print(f"--- Successfully built '{OUTPUT_FILE}' ---")

# This allows the script to be run directly from the command line if needed
if __name__ == '__main__':
    build()