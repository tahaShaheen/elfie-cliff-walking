# webapp/data_loader.py

import yaml
import pandas as pd
import os

GAME_DATA_YAML_FILE = "game_data.yaml"

def load_game_data():
    """Loads the main game data YAML file."""
    try:
        with open(GAME_DATA_YAML_FILE, 'r') as f:
            return yaml.safe_load(f) or {}
    except (FileNotFoundError, yaml.YAMLError) as e:
        print(f"Error loading {GAME_DATA_YAML_FILE}: {e}")
        return {}

# The load_user_data_df() function and global user_data_df variable
# have been removed as they are no longer needed for the live application.
# The database is now the single source of truth for participant data.