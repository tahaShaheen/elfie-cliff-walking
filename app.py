# app.py

from flask import Flask
from flask_session import Session 
from flask_cors import CORS
import os
import logging

# Import your blueprints
from webapp.main_routes import main_bp
from webapp.api_routes import api_bp
from webapp import policy_manager
import webapp.build_config as build_config  # Import our build script as a module

def create_app():
    app = Flask(__name__)

    # --- Configuration ---
    logging.basicConfig(level=logging.INFO)
    app.logger.setLevel(logging.INFO)
    CORS(app, supports_credentials=True, origins=["http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:8001", "http://localhost:8001", "null"])
    app.config["SECRET_KEY"] = os.environ.get("FLASK_SECRET_KEY", "yaml-is-great-for-config-dev-key-v9")
    app.config["SESSION_TYPE"] = "filesystem"  
    app.config["SESSION_FILE_DIR"] = "./flask_session"
    app.config["SESSION_PERMANENT"] = False 
    app.config["SESSION_USE_SIGNER"] = True 
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax" 
    app.config["SESSION_COOKIE_HTTPONLY"] = True 
    Session(app)
    os.makedirs(app.config["SESSION_FILE_DIR"], exist_ok=True)
    
    # --- ONE-TIME STARTUP TASKS (AUTOMATIC) ---
    # This block runs only once when the server worker starts up.
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        with app.app_context():
            # 1. Build the single game_data.yaml file from the yamls/ directory
            build_config.build()

            # 2. Generate policies using the newly built data
            print("--- Running automatic policy generation at startup ---")
            # policy_manager.delete_all_policies()
            policy_manager.check_and_generate_policies()
            print("--- Automatic setup finished ---")

    # --- Register Blueprints ---
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp)

    # --- Register Custom CLI Commands (MANUAL OPTION) ---
    @app.cli.command("generate-policies")
    def generate_policies_command():
        """Deletes all old policies and generates new ones from YAML."""
        print("--- Running Policy Generation Task ---")
        # policy_manager.delete_all_policies()
        policy_manager.check_and_generate_policies()
        print("--- Policy Generation Finished ---")
        
    return app

# This pattern is used so that the app creation can be controlled
app = create_app()