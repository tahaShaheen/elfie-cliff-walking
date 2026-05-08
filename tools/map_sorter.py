# map_sorter.py

import yaml
from collections import OrderedDict

# Define the input and output file names
input_filename = 'webapp/envs.yaml'
output_filename = 'webapp/sorted_envs.yaml'

def sort_environments(data):
    """
    Sorts the environments based on hole count, then DTW distance, 
    and finally Fréchet distance, all in descending order.
    """
    # Get the dictionary of environments
    environments = data.get('environments', {})

    # Convert the dictionary to a list of items (map_name, map_data)
    env_list = list(environments.items())

    # Sort the list using a lambda function that returns a tuple for sorting.
    # Primary key: 'hole_count'
    # Secondary key: 'dtw_distance'
    # Tertiary key: 'frechet_distance'
    # 'reverse=True' sorts all keys in descending order.
    env_list.sort(key=lambda item: (
        item[1].get('hole_count', 0), 
        item[1].get('dtw_distance', 0), 
        item[1].get('frechet_distance', 0)
    ), reverse=True)

    # Create an ordered dictionary to preserve the sort order
    sorted_environments = OrderedDict(env_list)

    # Return a new dictionary with the sorted environments
    return {'environments': dict(sorted_environments)}

def main():
    """
    Main function to load, sort, and save the YAML data.
    """
    try:
        with open(input_filename, 'r') as file:
            data = yaml.safe_load(file)
            print(f"Successfully loaded '{input_filename}'.")

        # Sort the data
        sorted_data = sort_environments(data)
        print("Sorting complete based on hole count, then DTW, then Fréchet distance.")

        with open(output_filename, 'w') as file:
            # sort_keys=False is important to respect our custom sort order.
            yaml.dump(sorted_data, file, default_flow_style=False, sort_keys=False)
        
        print(f"Successfully saved the sorted data to '{output_filename}'.")

    except FileNotFoundError:
        print(f"Error: The file '{input_filename}' was not found.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

# Run the main function
if __name__ == '__main__':
    main()