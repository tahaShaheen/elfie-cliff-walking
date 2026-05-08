# Elfie Cliff Walking

Welcome to the Elfie Cliff Walking project! 

## How To Run

### Local Development

1. **Start the Flask Backend:**
   Run the Flask backend server. You can use either of the following commands:
   ```bash
   python app.py
   ```
   *or*
   ```bash
   flask run --port=5001
   ```

2. **Start the Frontend:**
   In a separate terminal, start a local HTTP server to serve the frontend files (this is important for proper cookie handling):
   ```bash
   python -m http.server 8000
   ```

### Running on onRender

To connect to the database hosted on Render from your local machine, setup your environment variables using the external database URL provided by Render:
```bash
source ~/.bash-profile  # or ~/.zshrc depending on your setup
export DATABASE_URL=postgresql://<your_render_external_url>
```
*Note: Make sure to use the **Internal Database URL** in your environment variables when the app is actively deployed on Render.*

## Conda Environment Setup

If you need to export the Conda environment so that you can reproduce the exact same environment on a different machine, use:
```bash
conda env export -n <env_name> -f environment.yml --no-builds
```