from PIL import Image
import os

def chop_tilemap(image_path, tile_width, tile_height, output_dir, upscale_factor=1):
    """
    Chops a tilemap image into individual tile images and optionally upscales them.

    Args:
        image_path (str): The path to the input tilemap image.
        tile_width (int): The width of each individual tile in pixels in the original tilemap.
        tile_height (int): The height of each individual tile in pixels in the original tilemap.
        output_dir (str): The directory where the chopped tiles will be saved.
        upscale_factor (int, optional): The factor by which to upscale each chopped tile.
                                        Uses nearest-neighbor resampling for pixel art.
                                        Defaults to 1 (no upscaling).
    """
    try:
        # Open the tilemap image
        tilemap = Image.open(image_path)
        image_width, image_height = tilemap.size

        print(f"Opened tilemap: {image_path} ({image_width}x{image_height} pixels)")
        print(f"Original tile size: {tile_width}x{tile_height} pixels")
        if upscale_factor > 1:
            print(f"Upscaling each tile by a factor of {upscale_factor}.")
            print(f"Output tile size will be: {tile_width * upscale_factor}x{tile_height * upscale_factor} pixels.")

        # Create the output directory if it doesn't exist
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            print(f"Created output directory: {output_dir}")
        else:
            print(f"Output directory already exists: {output_dir}")

        # Calculate the number of tiles horizontally and vertically
        num_cols = image_width // tile_width
        num_rows = image_height // tile_height

        print(f"Expected number of columns: {num_cols}")
        print(f"Expected number of rows: {num_rows}")

        tile_count = 0
        # Iterate through rows and columns to chop up the tiles
        for row in range(num_rows):
            for col in range(num_cols):
                # Calculate the bounding box for the current tile
                left = col * tile_width
                top = row * tile_height
                right = left + tile_width
                bottom = top + tile_height

                # Crop the tile from the tilemap
                tile = tilemap.crop((left, top, right, bottom))

                # Upscale the tile if upscale_factor is greater than 1
                if upscale_factor > 1:
                    new_width = tile_width * upscale_factor
                    new_height = tile_height * upscale_factor
                    # Use Image.NEAREST for pixel art to avoid blurring
                    tile = tile.resize((new_width, new_height), Image.NEAREST)

                # Define the output filename for the tile
                tile_filename = os.path.join(output_dir, f"tile_{row:03d}_{col:03d}.png")

                # Save the individual tile image
                tile.save(tile_filename)
                tile_count += 1
                # print(f"Saved {tile_filename}") # Uncomment for verbose output

        print(f"\nSuccessfully chopped {tile_count} tiles into '{output_dir}' directory.")

    except FileNotFoundError:
        print(f"Error: The image file '{image_path}' was not found. Please ensure it's in the correct directory.")
    except Exception as e:
        print(f"An error occurred: {e}")

# --- Configuration ---
input_image_file = "GRASS+.png"  # Make sure this file is in the same directory as the script
tile_w = 16                     # Width of each tile in pixels (original resolution in the tilemap)
tile_h = 16                     # Height of each tile in pixels (original resolution in the tilemap)
output_directory = "output_tiles" # Directory to save the chopped tiles
upscale = 4                     # Set to 1 for no upscaling, 2 for double size, 4 for quadruple size, etc.

# Run the function
chop_tilemap(input_image_file, tile_w, tile_h, output_directory, upscale_factor=upscale)
