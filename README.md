# Elfie Cliff Walking

Welcome to the Elfie Cliff Walking project! 🍪

This is the companion codebase for the IJCAI '26 paper: **"Empirical Evidence and Analysis of a Critical Pitfall in Reward Learning from Human Feedback"** by [Taha Shaheen](https://scholar.google.com/citations?user=cEGtSWAAAAAJ&hl=en), [Stephen G. West](https://scholar.google.com/citations?user=SkMe3SEAAAAJ&hl=en), and [Yu Zhang](https://scholar.google.com/citations?user=n0uRPLgAAAAJ&hl=en&oi=ao).

---

## Live Demo (onRender)

The minigames are currently hosted and playable on onRender at:  
**[elfie-cliff-walking.onrender.com](https://elfie-cliff-walking.onrender.com/)**

### Test Accounts & Experimental Groups

Participants were recruited via general advertisement (paid $5) and a Psych 101 university pool (compensated with course credit). The only difference between these user types in the web application is the compensation information displayed to them. 

You can log in using any of the following accounts to test the different experimental conditions:

| Group ID | Instructions (`a`) | Visual Environment (`b`) | Regular User Login | Psych Pool Login |
| :--- | :--- | :--- | :--- | :--- |
| **a1b1** | Safe (Not Slippery) | Not Slippery | `test_user1` | `psych_user1` |
| **a1b2** | Safe (Not Slippery) | Slippery | `test_user2` | `psych_user2` |
| **a2b1** | Danger (Slippery) | Not Slippery | `test_user3` | `psych_user3` |
| **a2b2** | Danger (Slippery) | Slippery | `test_user4` | `psych_user4` |

---

## Data & Visualizations

* **Raw Final Data:** [View the Dataset on GitHub](https://github.com/tahaShaheen/elfie-cliff-walking/blob/main/experiment_data/processed_participant_data.csv)
* **Final Data Visualizations:** [View Interactive Trajectories and Responses for Individual Participants](https://elfie-cliff-walking.onrender.com/experiment_data/trajectory_visualizer/index.html)


---

## Local Development & Setup

This project uses a combination of Conda (for local Python development) and Pip (for web deployment). 

### 1. Python Environment Setup
We highly recommend using Conda to manage your local environment to ensure all dependencies resolve correctly.

**Option A: Standard Conda Installation**
Use the `environment.yml` file to create a conda environment that should work across different operating systems.

```bash
conda env create -f environment.yml

# Activate the environment
conda activate elfie
```

**Option B: Exact Replication of our Setup (macOS ARM64 only)**
If you are on an Apple Silicon Mac and want the *exact* package versions used during the original development, use the spec list:

```bash
conda create --name elfie --file spec-list.txt
conda activate elfie
```

**Option C: Pip Installation (For Deployment/Cloud)**
If you are deploying to a server (like onRender) or prefer not to use Conda, use the standard pip requirements file:

```bash
pip install -r requirements.txt
```

### 2. Start the Flask Backend

Once your Python environment is activated (and dependencies are installed), you can start the local development server.

```bash
flask run --port=5001
```

---

## Attributions & Resources

* [Mouse Icons by rcherem on Flaticon](https://www.flaticon.com)
* [Elf and Ice Sprites from Farama Gymnasium](https://gymnasium.farama.org/environments/toy_text/frozen_lake/)
* [Grass Tileset from Itch.io](https://ninjikin.itch.io/grass)
* [Dry Grass Photo](https://unsplash.com/photos/green-grass-HKJCs7jNd3w)
* [Ice Photo](https://unsplash.com/photos/white-snow-mountain-S-5qu7iwQfc)
* [Assistance from Gemini 2.5 Pro and 3.0 Pro](https://gemini.google.com)

## 🛑 Maintenance & License

**This repository is currently not being maintained.** Please feel free to fork and use the code for your own projects!

This project is licensed under the **MIT License**.