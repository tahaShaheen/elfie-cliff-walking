# webapp/main_routes.py
import os
from flask import Blueprint, render_template, send_from_directory

main_bp = Blueprint('main', __name__)

@main_bp.route('/')
def home():
    """Serves the main index.html page."""
    return render_template('index.html')

@main_bp.route('/<string:page_name>')
def serve_page(page_name):
    """Serves a page from the templates folder."""
    allowed_pages = [
        "index.html", "instructions.html", "demonstrations.html",
        "comparisons.html", "corrections.html", "off.html", "thank_you.html",
        "free_form_question.html",
        "plan_vs_execution.html",
        "manipulation_check.html",
        "failed_check.html",
        "close_window.html"
    ]
    if page_name in allowed_pages:
        return render_template(page_name)
    else:
        return "Not Found", 404

@main_bp.route('/experiment_data/<path:filename>')
def serve_experiment_data(filename):
    """Serves static files from the experiment_data directory."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_dir = os.path.join(base_dir, 'experiment_data')
    return send_from_directory(target_dir, filename)