# webapp/main_routes.py

from flask import Blueprint, render_template

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