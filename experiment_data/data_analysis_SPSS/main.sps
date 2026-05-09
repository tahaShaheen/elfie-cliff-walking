* Encoding: UTF-8.

* ============================================================================.
* STEP 1: LOAD DATA.
* ============================================================================.

GET DATA
  /TYPE=TXT
  /FILE='[path_to_file]/processed_aggregated_data.csv'
  /DELIMITERS=","
  /QUALIFIER='"'
  /ENCODING='UTF8'
  /FIRSTCASE=2
  /VARIABLES=
    user_id_field A15
    instruction_group A4
    belief_factor A2
    ground_truth_factor A2
    task_order A60
    c0_demo_pre_vs_stable F8.5
    c0_demo_pre_vs_slippery F8.5
    c0_demo_pre F8.5
    c1_comp_vs_stable F8.5
    c1_comp_vs_slippery F8.5
    c1_comp F8.5
    c2_corr_vs_stable F8.5
    c2_corr_vs_slippery F8.5
    c2_corr F8.5
    c3_off_vs_stable F8.5
    c3_off_vs_slippery F8.5
    c3_off F8.5
    c4_demo_vs_stable F8.5
    c4_demo_vs_slippery F8.5
    c4_demo F8.5
    ff_stable_rating F1.0
    ff_slippery_rating F1.0
    mc_pre_slippery_q F1.0
    mc_pre_slippery_q2 F1.0
    mc_pre_execution_q F1.0
    mc_pre_task_q F1.0
    mc_post_slippery_q F1.0
    mc_post_slippery_q2 F1.0
    c0_demo_pre_pca1 F8.5
    c0_demo_pre_pca2 F8.5
    c1_comp_pca1 F8.5
    c1_comp_pca2 F8.5
    c2_corr_pca1 F8.5
    c2_corr_pca2 F8.5
    c3_off_pca1 F8.5
    c3_off_pca2 F8.5
    c4_demo_pca1 F8.5
    c4_demo_pca2 F8.5.
CACHE.
EXECUTE.
DATASET NAME ParticipantData WINDOW=FRONT.

* ============================================================================.
* STEP 1.5: RENAME VARIABLES.
* X2 is renamed to instructions.
* X1 is renamed to visual_context.
* ============================================================================.

RENAME VARIABLES (belief_factor = instructions).
RENAME VARIABLES (ground_truth_factor = visual_context).

VARIABLE LABELS instructions "X2: Stipulated Dynamics (Safe vs Danger)".
VARIABLE LABELS visual_context      "X1: Visual Context (Stable vs Slippery)".
EXECUTE.

* ============================================================================.
* STEP 2: OPERATIONALIZE VARIABLES (M, C1, C2).
* ============================================================================.

* --- 1. CALCULATE COVARIATE C1 (Baseline Understanding) ---.
* Average of "mc_pre_slippery_q" and Inverted "mc_pre_slippery_q2".
* Scale is 1 to 5.

* q is close to cliff edge. It can be safe or not. Higher numbers mean participant thinks that this is slippery.
* q2 is far away from cliff edge. It is always safe. Should give low numbers for most participants. 

* A. Invert q2 (The Safe one).
* Formula: (Theoretical_Max + 1) - Score.
* If user enters 1 (Safe), result is 5. If user enters 5 (Dangerous), result is 1.
COMPUTE q2_inverted = (5 + 1) - mc_pre_slippery_q2.

* B. Calculate the Average.
COMPUTE C1_raw = MEAN(mc_pre_slippery_q, q2_inverted).
EXECUTE.

* Cleanup helper variables.
DELETE VARIABLES q2_inverted.


* --- 2. CALCULATE MEDIATOR M (Dynamics Understanding) ---.
COMPUTE M_raw = mc_post_slippery_q.


* --- 3. CALCULATE COVARIATE C2 (Baseline Behaviour) ---.
* Average of Stable Score AND Inverted Slippery Score.

* High values for vs_slippery means the trajectory was far away from slippery "optimal". 
* We want for high values to be CLOSER to slippery instead. 
* We accomplish this by using vs_stable (low means far from slippery, high means closer to slippery).
* And inverting vs_slippery so that low is away from slippery, high is closer to slippery.

*(125 is the DTW distance between the straight path and the perimeter border hugging path in a 6x12 map).
COMPUTE C2_raw = (c0_demo_pre_vs_stable + (125.0 - c0_demo_pre_vs_slippery)) / 2.
EXECUTE.

* High values for C2_raw now mean that it was closer to slippery. Smaller values mean it was closer to stable.
* The resulting average values: high means the trajectory was close to slippery optimal.

* --- 4. SCALING (Z-SCORES) ---.
* Standardize the new M_raw, C1_raw, and C2_raw.
DESCRIPTIVES VARIABLES=M_raw C1_raw C2_raw /SAVE.


* --- 5. RENAME Z-SCORES ---.
RENAME VARIABLES (ZM_raw = dynamics_understanding).
RENAME VARIABLES (ZC1_raw = baseline_understanding).
RENAME VARIABLES (ZC2_raw = baseline_behaviour).

VARIABLE LABELS dynamics_understanding "M: Volatility Understanding (Z) [2-Item]".
VARIABLE LABELS baseline_understanding   "C1: Baseline Understanding (Z)".
VARIABLE LABELS baseline_behaviour               "C2: Prior Bias (Z)".
EXECUTE.

* ============================================================================.
* STEP 2.5: CLEAN MISSING DATA.
* ============================================================================.

SELECT IF NOT(NMISS(dynamics_understanding, baseline_understanding, baseline_behaviour, c1_comp_pca1, c2_corr_pca1, c3_off_pca1)).
EXECUTE.

* ============================================================================.
* STEP 3: CREATE COMPOSITE DVs & RESTRUCTURE.
* Formula: (Slippery + (Max_Stable - Actual_Stable)) / 2.
* ============================================================================.

* --- 1. COMPUTE RAW COMPOSITE SCORES ---. (125 is the DTW distance between the straight path and the perimeter border hugging path in a 6x12 map).
* Game 1: Comparison.
COMPUTE c1_raw_composite = (c1_comp_vs_stable + (125.0 - c1_comp_vs_slippery)) / 2.

* Game 2: Correction.
COMPUTE c2_raw_composite = (c2_corr_vs_stable + (125.0 - c2_corr_vs_slippery)) / 2.

* Game 3: Off Intervention.
COMPUTE c3_raw_composite = (c3_off_vs_stable + (125.0 - c3_off_vs_slippery)) / 2.

EXECUTE.

* --- 2. RESTRUCTURE (WIDE TO LONG) ---.
* Stack the 3 new composite variables into one column: 'raw_score'.
VARSTOCASES
  /MAKE raw_score FROM c1_raw_composite c2_raw_composite c3_raw_composite
  /INDEX=feedback_type_index(raw_score)
  /KEEP=user_id_field instructions visual_context task_order 
        dynamics_understanding baseline_understanding baseline_behaviour
  /NULL=KEEP.

* --- 4. CLEAN UP FEEDBACK LABELS ---.
STRING feedback_type (A4).
IF (CHAR.SUBSTR(feedback_type_index, 1, 2) = "c1") feedback_type = "comp".
IF (CHAR.SUBSTR(feedback_type_index, 1, 2) = "c2") feedback_type = "corr".
IF (CHAR.SUBSTR(feedback_type_index, 1, 2) = "c3") feedback_type = "off".
EXECUTE.

DELETE VARIABLES feedback_type_index.

* --- 5. STANDARDIZE THE FINAL DV ---.
* We Z-score the new 'raw_score' to create 'feedback_behavior'.
DESCRIPTIVES VARIABLES=raw_score /SAVE.

RENAME VARIABLES (Zraw_score = feedback_behavior).
VARIABLE LABELS feedback_behavior "Y: Composite Performance (Z)".
EXECUTE.

* ============================================================================.
* STEP 3.5: GENERATE TRIAL PERIOD FOR ALL 6 ORDERS.
* ============================================================================.

COMPUTE trial_period = 0.

* --- PATTERN 1: comp -> corr -> off ---.
DO IF (task_order = "comp-corr-off").
  IF (feedback_type = "comp") trial_period = 1.
  IF (feedback_type = "corr") trial_period = 2.
  IF (feedback_type = "off")  trial_period = 3.
END IF.

* --- PATTERN 2: comp -> off -> corr ---.
DO IF (task_order = "comp-off-corr").
  IF (feedback_type = "comp") trial_period = 1.
  IF (feedback_type = "off")  trial_period = 2.
  IF (feedback_type = "corr") trial_period = 3.
END IF.

* --- PATTERN 3: corr -> comp -> off ---.
DO IF (task_order = "corr-comp-off").
  IF (feedback_type = "corr") trial_period = 1.
  IF (feedback_type = "comp") trial_period = 2.
  IF (feedback_type = "off")  trial_period = 3.
END IF.

* --- PATTERN 4: corr -> off -> comp ---.
DO IF (task_order = "corr-off-comp").
  IF (feedback_type = "corr") trial_period = 1.
  IF (feedback_type = "off")  trial_period = 2.
  IF (feedback_type = "comp") trial_period = 3.
END IF.

* --- PATTERN 5: off -> comp -> corr ---.
DO IF (task_order = "off-comp-corr").
  IF (feedback_type = "off")  trial_period = 1.
  IF (feedback_type = "comp") trial_period = 2.
  IF (feedback_type = "corr") trial_period = 3.
END IF.

* --- PATTERN 6: off -> corr -> comp ---.
DO IF (task_order = "off-corr-comp").
  IF (feedback_type = "off")  trial_period = 1.
  IF (feedback_type = "corr") trial_period = 2.
  IF (feedback_type = "comp") trial_period = 3.
END IF.

EXECUTE.

* CHECK: This must show only 1, 2, and 3.
*FREQUENCIES VARIABLES=trial_period.

* ============================================================================.
* PART 1: SPLIT-FILE MEDIATION (ANALYSES 1 & 2).
* Run the mediation model separately for "Stable" and "Slippery".
* ============================================================================.

* 1. Turn on Split File.
SORT CASES BY visual_context user_id_field feedback_type.
SPLIT FILE SEPARATE BY visual_context.

* ============================================================================.
* MEDIATION PATH A (FIXED).
* Technique: Filter to 1 row per user -> Standard ANOVA.
* Because "dynamics_understanding" is constant. MIXED crashes on constant DVs.
* ============================================================================.

TEMPORARY.
SELECT IF feedback_type = "comp".

UNIANOVA dynamics_understanding BY instructions
  WITH baseline_understanding baseline_behaviour
  /METHOD=SSTYPE(3)
  /INTERCEPT=INCLUDE
  /PRINT=PARAMETER ETASQ DESCRIPTIVE
  /DESIGN=instructions baseline_understanding baseline_behaviour.

* ----------------------------------------------------------------------------.
* PATH B & C' (IV + Mediator -> DV).
* Does 'dynamics_understanding' predict 'feedback_behavior'?
* ----------------------------------------------------------------------------.

MIXED feedback_behavior BY instructions feedback_type trial_period
  WITH dynamics_understanding baseline_understanding baseline_behaviour
  /FIXED=
       instructions
       feedback_type
       dynamics_understanding
       trial_period
       baseline_understanding
       baseline_behaviour
       instructions*feedback_type
       dynamics_understanding*feedback_type
       | SSTYPE(3)
  /METHOD=REML
  /PRINT=SOLUTION
  /REPEATED=feedback_type | SUBJECT(user_id_field) COVTYPE(CS).

* 2. Turn OFF Split File.
SPLIT FILE OFF.

* ============================================================================.
* MONTE CARLO CONFIDENCE INTERVAL CALCULATOR FOR MEDIATION.
* ============================================================================.

SET SEED 12345.
INPUT PROGRAM.
LOOP #i = 1 TO 20000.

    * ------------------------------------------------------------------------.
    * Numbers used are from the analysis up until this point.
    * ------------------------------------------------------------------------.

    * ------------------------------------------------------------------------.
    * VISUAL CONTEXT 1: STABLE (b1).
    * Path a Source: Parameter Estimates.
    * Path b Source: Estimates of Fixed Effects.
    * ------------------------------------------------------------------------.
    * a = -1.326 (Effect of Stipulated Dynamics on Understanding).
    * SE_a = 0.123.
    * b = 0.448  (Effect of Understanding on Behavior).
    * SE_b = 0.111.
    * ------------------------------------------------------------------------.
    COMPUTE a_stable  = RV.NORMAL(-1.326, 0.123).
    COMPUTE b_stable  = RV.NORMAL(0.448, 0.111).
    COMPUTE ab_stable = a_stable * b_stable.

    * ------------------------------------------------------------------------.
    * VISUAL CONTEXT 2: SLIPPERY (b2).
    * Path a Source: Parameter Estimates.
    * Path b Source: Estimates of Fixed Effects.
    * ------------------------------------------------------------------------.
    * a = -0.918 (Effect of Stipulated Dynamics on Understanding).
    * SE_a = 0.168.
    * b = 0.356  (Effect of Understanding on Behavior).
    * SE_b = 0.085.
    * ------------------------------------------------------------------------.
    COMPUTE a_slippery  = RV.NORMAL(-0.918, 0.168).
    COMPUTE b_slippery  = RV.NORMAL(0.356, 0.085).
    COMPUTE ab_slippery = a_slippery * b_slippery.

    * ------------------------------------------------------------------------.
    * META-ANALYSIS STEPS.
    * 1. The Difference (Test of Moderated Mediation).
    * 2. The Pooled Effect (Average Mediation strength).
    * ------------------------------------------------------------------------.
    COMPUTE ab_diff   = ab_stable - ab_slippery.
    COMPUTE ab_avg    = (ab_stable + ab_slippery) / 2.

    END CASE.
END LOOP.
END FILE.
END INPUT PROGRAM.
DATASET NAME MonteCarloSim WINDOW=FRONT.

* ============================================================================.
* CALCULATE CONFIDENCE INTERVALS.
* RESULT INTERPRETATION:
* If the Lower and Upper bounds DO NOT cross zero, Mediation is Significant.
* Mean value is the point estimate of the indirect effect.
* ============================================================================.

FREQUENCIES VARIABLES=ab_stable ab_slippery
  /FORMAT=NOTABLE
  /STATISTICS=MEAN.

EXAMINE VARIABLES=ab_stable ab_slippery
  /PERCENTILES(2.5, 97.5) HAVERAGE
  /STATISTICS NONE
  /PLOT NONE.

* ============================================================================.
* CHECK THE RESULTS.
* 1. ab_diff: If CI contains 0, the contexts are NOT significantly different.
* 2. ab_avg:  The overall "Meta" strength of the mechanism.
* ============================================================================.

FREQUENCIES VARIABLES=ab_diff ab_avg
  /FORMAT=NOTABLE
  /STATISTICS=MEAN.

EXAMINE VARIABLES=ab_diff ab_avg
  /PERCENTILES(2.5, 97.5) HAVERAGE
  /STATISTICS NONE
  /PLOT NONE.
