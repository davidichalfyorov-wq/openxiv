/**
 * Subject categories shared by API and web. arXiv-compatible slugs where they
 * exist, plus our own slugs for branches arXiv does not cover (chemistry,
 * earth & space, life sciences beyond q-bio, social sciences, humanities).
 *
 * Goals:
 *   1. Submitters from any STEM discipline find a category that fits without
 *      having to pick a "general physics" lifeboat.
 *   2. The taxonomy is searchable both by group ("Computer Science") and by
 *      slug prefix ("cs.*"), so OAI-PMH sets and category filter pages work
 *      without per-discipline special-cases.
 *   3. Adding a new code is one line — no boilerplate.
 *
 * Conventions:
 *   - Physics keeps its dotted arXiv slugs (physics.foo) and three-letter
 *     special slugs (astro-ph, cond-mat, …).
 *   - Math, CS, q-bio, q-fin, stat, econ, eess use arXiv-compat dot slugs.
 *   - Life sciences outside q-bio use bio.* (we do not steal arXiv's q-bio
 *     prefix — it is reserved for quantitative biology).
 *   - Chemistry uses chem.*; earth/space chem-adjacent (e.g. atm-sci) lives
 *     in earth.*; planetary stays under astro-ph.* where it overlaps.
 *   - Social sciences: soc.* (sociology), psy.* (psychology), edu.*
 *     (education research), law.* (legal scholarship), pol.* (political
 *     science / international relations).
 *   - Humanities: hum.* (philosophy, history, linguistics, literature).
 *   - Engineering: eng.* (mech / civil / aerospace etc beyond eess).
 *   - Medicine: med.* (clinical) — kept separate from bio because the
 *     review / reproducibility expectations are very different.
 */
export interface CategoryNode {
  readonly code: string;
  readonly name: string;
  readonly group: string;
  readonly description?: string;
}

export const CATEGORY_GROUPS = [
  'Physics',
  'Mathematics',
  'Computer Science',
  'Statistics',
  'Electrical Engineering & Systems Science',
  'Engineering',
  'Chemistry',
  'Life Sciences',
  'Quantitative Biology',
  'Medicine & Health',
  'Earth & Space Sciences',
  'Quantitative Finance',
  'Economics',
  'Psychology & Cognitive Science',
  'Social Sciences',
  'Humanities',
  'Education & Methodology',
] as const;

export type CategoryGroup = (typeof CATEGORY_GROUPS)[number];

export const CATEGORIES: readonly CategoryNode[] = [
  // ────────────────────────────────────────────────────────────────────
  // Physics
  // ────────────────────────────────────────────────────────────────────
  { code: 'astro-ph.CO', name: 'Cosmology & Nongalactic Astrophysics', group: 'Physics' },
  { code: 'astro-ph.EP', name: 'Earth & Planetary Astrophysics', group: 'Physics' },
  { code: 'astro-ph.GA', name: 'Astrophysics of Galaxies', group: 'Physics' },
  { code: 'astro-ph.HE', name: 'High Energy Astrophysical Phenomena', group: 'Physics' },
  { code: 'astro-ph.IM', name: 'Instrumentation & Methods for Astrophysics', group: 'Physics' },
  { code: 'astro-ph.SR', name: 'Solar & Stellar Astrophysics', group: 'Physics' },
  { code: 'cond-mat.dis-nn', name: 'Disordered Systems & Neural Networks', group: 'Physics' },
  { code: 'cond-mat.mes-hall', name: 'Mesoscale & Nanoscale Physics', group: 'Physics' },
  { code: 'cond-mat.mtrl-sci', name: 'Materials Science', group: 'Physics' },
  { code: 'cond-mat.other', name: 'Other Condensed Matter', group: 'Physics' },
  { code: 'cond-mat.quant-gas', name: 'Quantum Gases', group: 'Physics' },
  { code: 'cond-mat.soft', name: 'Soft Condensed Matter', group: 'Physics' },
  { code: 'cond-mat.stat-mech', name: 'Statistical Mechanics', group: 'Physics' },
  { code: 'cond-mat.str-el', name: 'Strongly Correlated Electrons', group: 'Physics' },
  { code: 'cond-mat.supr-con', name: 'Superconductivity', group: 'Physics' },
  { code: 'gr-qc', name: 'General Relativity & Quantum Cosmology', group: 'Physics' },
  { code: 'hep-ex', name: 'High Energy Physics — Experiment', group: 'Physics' },
  { code: 'hep-lat', name: 'High Energy Physics — Lattice', group: 'Physics' },
  { code: 'hep-ph', name: 'High Energy Physics — Phenomenology', group: 'Physics' },
  { code: 'hep-th', name: 'High Energy Physics — Theory', group: 'Physics' },
  { code: 'math-ph', name: 'Mathematical Physics', group: 'Physics' },
  { code: 'nlin.AO', name: 'Adaptation & Self-Organizing Systems', group: 'Physics' },
  { code: 'nlin.CD', name: 'Chaotic Dynamics', group: 'Physics' },
  { code: 'nlin.CG', name: 'Cellular Automata & Lattice Gases', group: 'Physics' },
  { code: 'nlin.PS', name: 'Pattern Formation & Solitons', group: 'Physics' },
  { code: 'nlin.SI', name: 'Exactly Solvable & Integrable Systems', group: 'Physics' },
  { code: 'nucl-ex', name: 'Nuclear Experiment', group: 'Physics' },
  { code: 'nucl-th', name: 'Nuclear Theory', group: 'Physics' },
  { code: 'physics.acc-ph', name: 'Accelerator Physics', group: 'Physics' },
  { code: 'physics.ao-ph', name: 'Atmospheric & Oceanic Physics', group: 'Physics' },
  { code: 'physics.app-ph', name: 'Applied Physics', group: 'Physics' },
  { code: 'physics.atm-clus', name: 'Atomic & Molecular Clusters', group: 'Physics' },
  { code: 'physics.atom-ph', name: 'Atomic Physics', group: 'Physics' },
  { code: 'physics.bio-ph', name: 'Biological Physics', group: 'Physics' },
  { code: 'physics.chem-ph', name: 'Chemical Physics', group: 'Physics' },
  { code: 'physics.class-ph', name: 'Classical Physics', group: 'Physics' },
  { code: 'physics.comp-ph', name: 'Computational Physics', group: 'Physics' },
  { code: 'physics.data-an', name: 'Data Analysis, Statistics & Probability', group: 'Physics' },
  { code: 'physics.ed-ph', name: 'Physics Education', group: 'Physics' },
  { code: 'physics.flu-dyn', name: 'Fluid Dynamics', group: 'Physics' },
  { code: 'physics.gen-ph', name: 'General Physics', group: 'Physics' },
  { code: 'physics.geo-ph', name: 'Geophysics', group: 'Physics' },
  { code: 'physics.hist-ph', name: 'History & Philosophy of Physics', group: 'Physics' },
  { code: 'physics.ins-det', name: 'Instrumentation & Detectors', group: 'Physics' },
  { code: 'physics.med-ph', name: 'Medical Physics', group: 'Physics' },
  { code: 'physics.optics', name: 'Optics', group: 'Physics' },
  { code: 'physics.plasm-ph', name: 'Plasma Physics', group: 'Physics' },
  { code: 'physics.pop-ph', name: 'Popular Physics', group: 'Physics' },
  { code: 'physics.soc-ph', name: 'Physics & Society', group: 'Physics' },
  { code: 'physics.space-ph', name: 'Space Physics', group: 'Physics' },
  { code: 'quant-ph', name: 'Quantum Physics', group: 'Physics' },

  // ────────────────────────────────────────────────────────────────────
  // Mathematics
  // ────────────────────────────────────────────────────────────────────
  { code: 'math.AC', name: 'Commutative Algebra', group: 'Mathematics' },
  { code: 'math.AG', name: 'Algebraic Geometry', group: 'Mathematics' },
  { code: 'math.AP', name: 'Analysis of PDEs', group: 'Mathematics' },
  { code: 'math.AT', name: 'Algebraic Topology', group: 'Mathematics' },
  { code: 'math.CA', name: 'Classical Analysis & ODEs', group: 'Mathematics' },
  { code: 'math.CO', name: 'Combinatorics', group: 'Mathematics' },
  { code: 'math.CT', name: 'Category Theory', group: 'Mathematics' },
  { code: 'math.CV', name: 'Complex Variables', group: 'Mathematics' },
  { code: 'math.DG', name: 'Differential Geometry', group: 'Mathematics' },
  { code: 'math.DS', name: 'Dynamical Systems', group: 'Mathematics' },
  { code: 'math.FA', name: 'Functional Analysis', group: 'Mathematics' },
  { code: 'math.GM', name: 'General Mathematics', group: 'Mathematics' },
  { code: 'math.GN', name: 'General Topology', group: 'Mathematics' },
  { code: 'math.GR', name: 'Group Theory', group: 'Mathematics' },
  { code: 'math.GT', name: 'Geometric Topology', group: 'Mathematics' },
  { code: 'math.HO', name: 'History & Overview', group: 'Mathematics' },
  { code: 'math.IT', name: 'Information Theory', group: 'Mathematics' },
  { code: 'math.KT', name: 'K-Theory & Homology', group: 'Mathematics' },
  { code: 'math.LO', name: 'Logic', group: 'Mathematics' },
  { code: 'math.MG', name: 'Metric Geometry', group: 'Mathematics' },
  { code: 'math.MP', name: 'Mathematical Physics', group: 'Mathematics' },
  { code: 'math.NA', name: 'Numerical Analysis', group: 'Mathematics' },
  { code: 'math.NT', name: 'Number Theory', group: 'Mathematics' },
  { code: 'math.OA', name: 'Operator Algebras', group: 'Mathematics' },
  { code: 'math.OC', name: 'Optimization & Control', group: 'Mathematics' },
  { code: 'math.PR', name: 'Probability', group: 'Mathematics' },
  { code: 'math.QA', name: 'Quantum Algebra', group: 'Mathematics' },
  { code: 'math.RA', name: 'Rings & Algebras', group: 'Mathematics' },
  { code: 'math.RT', name: 'Representation Theory', group: 'Mathematics' },
  { code: 'math.SG', name: 'Symplectic Geometry', group: 'Mathematics' },
  { code: 'math.SP', name: 'Spectral Theory', group: 'Mathematics' },
  { code: 'math.ST', name: 'Statistics Theory', group: 'Mathematics' },

  // ────────────────────────────────────────────────────────────────────
  // Computer Science
  // ────────────────────────────────────────────────────────────────────
  { code: 'cs.AI', name: 'Artificial Intelligence', group: 'Computer Science' },
  { code: 'cs.AR', name: 'Hardware Architecture', group: 'Computer Science' },
  { code: 'cs.CC', name: 'Computational Complexity', group: 'Computer Science' },
  { code: 'cs.CE', name: 'Computational Engineering, Finance & Science', group: 'Computer Science' },
  { code: 'cs.CG', name: 'Computational Geometry', group: 'Computer Science' },
  { code: 'cs.CL', name: 'Computation & Language (NLP)', group: 'Computer Science' },
  { code: 'cs.CR', name: 'Cryptography & Security', group: 'Computer Science' },
  { code: 'cs.CV', name: 'Computer Vision & Pattern Recognition', group: 'Computer Science' },
  { code: 'cs.CY', name: 'Computers & Society', group: 'Computer Science' },
  { code: 'cs.DB', name: 'Databases', group: 'Computer Science' },
  { code: 'cs.DC', name: 'Distributed, Parallel & Cluster Computing', group: 'Computer Science' },
  { code: 'cs.DL', name: 'Digital Libraries', group: 'Computer Science' },
  { code: 'cs.DM', name: 'Discrete Mathematics', group: 'Computer Science' },
  { code: 'cs.DS', name: 'Data Structures & Algorithms', group: 'Computer Science' },
  { code: 'cs.ET', name: 'Emerging Technologies', group: 'Computer Science' },
  { code: 'cs.FL', name: 'Formal Languages & Automata Theory', group: 'Computer Science' },
  { code: 'cs.GL', name: 'General Literature', group: 'Computer Science' },
  { code: 'cs.GR', name: 'Graphics', group: 'Computer Science' },
  { code: 'cs.GT', name: 'Computer Science & Game Theory', group: 'Computer Science' },
  { code: 'cs.HC', name: 'Human-Computer Interaction', group: 'Computer Science' },
  { code: 'cs.IR', name: 'Information Retrieval', group: 'Computer Science' },
  { code: 'cs.IT', name: 'Information Theory', group: 'Computer Science' },
  { code: 'cs.LG', name: 'Machine Learning', group: 'Computer Science' },
  { code: 'cs.LO', name: 'Logic in Computer Science', group: 'Computer Science' },
  { code: 'cs.MA', name: 'Multiagent Systems', group: 'Computer Science' },
  { code: 'cs.MM', name: 'Multimedia', group: 'Computer Science' },
  { code: 'cs.MS', name: 'Mathematical Software', group: 'Computer Science' },
  { code: 'cs.NA', name: 'Numerical Analysis', group: 'Computer Science' },
  { code: 'cs.NE', name: 'Neural & Evolutionary Computing', group: 'Computer Science' },
  { code: 'cs.NI', name: 'Networking & Internet Architecture', group: 'Computer Science' },
  { code: 'cs.OH', name: 'Other Computer Science', group: 'Computer Science' },
  { code: 'cs.OS', name: 'Operating Systems', group: 'Computer Science' },
  { code: 'cs.PF', name: 'Performance', group: 'Computer Science' },
  { code: 'cs.PL', name: 'Programming Languages', group: 'Computer Science' },
  { code: 'cs.RO', name: 'Robotics', group: 'Computer Science' },
  { code: 'cs.SC', name: 'Symbolic Computation', group: 'Computer Science' },
  { code: 'cs.SD', name: 'Sound', group: 'Computer Science' },
  { code: 'cs.SE', name: 'Software Engineering', group: 'Computer Science' },
  { code: 'cs.SI', name: 'Social & Information Networks', group: 'Computer Science' },
  { code: 'cs.SY', name: 'Systems & Control', group: 'Computer Science' },

  // ────────────────────────────────────────────────────────────────────
  // Statistics
  // ────────────────────────────────────────────────────────────────────
  { code: 'stat.AP', name: 'Applications', group: 'Statistics' },
  { code: 'stat.CO', name: 'Computation', group: 'Statistics' },
  { code: 'stat.ME', name: 'Methodology', group: 'Statistics' },
  { code: 'stat.ML', name: 'Machine Learning', group: 'Statistics' },
  { code: 'stat.OT', name: 'Other Statistics', group: 'Statistics' },
  { code: 'stat.TH', name: 'Statistics Theory', group: 'Statistics' },

  // ────────────────────────────────────────────────────────────────────
  // Electrical Engineering & Systems Science (arXiv eess.*)
  // ────────────────────────────────────────────────────────────────────
  { code: 'eess.AS', name: 'Audio & Speech Processing', group: 'Electrical Engineering & Systems Science' },
  { code: 'eess.IV', name: 'Image & Video Processing', group: 'Electrical Engineering & Systems Science' },
  { code: 'eess.SP', name: 'Signal Processing', group: 'Electrical Engineering & Systems Science' },
  { code: 'eess.SY', name: 'Systems & Control', group: 'Electrical Engineering & Systems Science' },

  // ────────────────────────────────────────────────────────────────────
  // Engineering (broader than EE/Systems)
  // ────────────────────────────────────────────────────────────────────
  { code: 'eng.aero', name: 'Aerospace Engineering', group: 'Engineering' },
  { code: 'eng.bio', name: 'Biomedical Engineering', group: 'Engineering' },
  { code: 'eng.chem', name: 'Chemical Engineering', group: 'Engineering' },
  { code: 'eng.civil', name: 'Civil & Structural Engineering', group: 'Engineering' },
  { code: 'eng.energy', name: 'Energy Systems', group: 'Engineering' },
  { code: 'eng.env', name: 'Environmental Engineering', group: 'Engineering' },
  { code: 'eng.indust', name: 'Industrial & Manufacturing Engineering', group: 'Engineering' },
  { code: 'eng.materials', name: 'Materials Engineering', group: 'Engineering' },
  { code: 'eng.mech', name: 'Mechanical Engineering', group: 'Engineering' },
  { code: 'eng.nuclear', name: 'Nuclear Engineering', group: 'Engineering' },
  { code: 'eng.other', name: 'Other Engineering', group: 'Engineering' },

  // ────────────────────────────────────────────────────────────────────
  // Chemistry (beyond physics.chem-ph)
  // ────────────────────────────────────────────────────────────────────
  { code: 'chem.ana', name: 'Analytical Chemistry', group: 'Chemistry' },
  { code: 'chem.bio', name: 'Biochemistry', group: 'Chemistry' },
  { code: 'chem.cat', name: 'Catalysis', group: 'Chemistry' },
  { code: 'chem.comp', name: 'Computational & Theoretical Chemistry', group: 'Chemistry' },
  { code: 'chem.env', name: 'Environmental & Green Chemistry', group: 'Chemistry' },
  { code: 'chem.inorg', name: 'Inorganic Chemistry', group: 'Chemistry' },
  { code: 'chem.matsci', name: 'Materials Chemistry', group: 'Chemistry' },
  { code: 'chem.med', name: 'Medicinal Chemistry', group: 'Chemistry' },
  { code: 'chem.org', name: 'Organic Chemistry', group: 'Chemistry' },
  { code: 'chem.phys', name: 'Physical Chemistry', group: 'Chemistry' },
  { code: 'chem.poly', name: 'Polymers', group: 'Chemistry' },
  { code: 'chem.other', name: 'Other Chemistry', group: 'Chemistry' },

  // ────────────────────────────────────────────────────────────────────
  // Life Sciences (broader than quantitative q-bio)
  // ────────────────────────────────────────────────────────────────────
  { code: 'bio.bioinf', name: 'Bioinformatics', group: 'Life Sciences' },
  { code: 'bio.cell', name: 'Cell Biology', group: 'Life Sciences' },
  { code: 'bio.dev', name: 'Developmental Biology', group: 'Life Sciences' },
  { code: 'bio.ecol', name: 'Ecology', group: 'Life Sciences' },
  { code: 'bio.evo', name: 'Evolutionary Biology', group: 'Life Sciences' },
  { code: 'bio.genet', name: 'Genetics', group: 'Life Sciences' },
  { code: 'bio.immuno', name: 'Immunology', group: 'Life Sciences' },
  { code: 'bio.micro', name: 'Microbiology', group: 'Life Sciences' },
  { code: 'bio.mol', name: 'Molecular Biology', group: 'Life Sciences' },
  { code: 'bio.neuro', name: 'Neuroscience', group: 'Life Sciences' },
  { code: 'bio.physio', name: 'Physiology', group: 'Life Sciences' },
  { code: 'bio.plant', name: 'Plant Biology', group: 'Life Sciences' },
  { code: 'bio.struct', name: 'Structural Biology', group: 'Life Sciences' },
  { code: 'bio.synth', name: 'Synthetic Biology', group: 'Life Sciences' },
  { code: 'bio.zoo', name: 'Zoology', group: 'Life Sciences' },
  { code: 'bio.other', name: 'Other Life Sciences', group: 'Life Sciences' },

  // ────────────────────────────────────────────────────────────────────
  // Quantitative Biology (arXiv q-bio.*)
  // ────────────────────────────────────────────────────────────────────
  { code: 'q-bio.BM', name: 'Biomolecules', group: 'Quantitative Biology' },
  { code: 'q-bio.CB', name: 'Cell Behavior', group: 'Quantitative Biology' },
  { code: 'q-bio.GN', name: 'Genomics', group: 'Quantitative Biology' },
  { code: 'q-bio.MN', name: 'Molecular Networks', group: 'Quantitative Biology' },
  { code: 'q-bio.NC', name: 'Neurons & Cognition', group: 'Quantitative Biology' },
  { code: 'q-bio.OT', name: 'Other Quantitative Biology', group: 'Quantitative Biology' },
  { code: 'q-bio.PE', name: 'Populations & Evolution', group: 'Quantitative Biology' },
  { code: 'q-bio.QM', name: 'Quantitative Methods', group: 'Quantitative Biology' },
  { code: 'q-bio.SC', name: 'Subcellular Processes', group: 'Quantitative Biology' },
  { code: 'q-bio.TO', name: 'Tissues & Organs', group: 'Quantitative Biology' },

  // ────────────────────────────────────────────────────────────────────
  // Medicine & Health
  // ────────────────────────────────────────────────────────────────────
  { code: 'med.clin', name: 'Clinical Research', group: 'Medicine & Health' },
  { code: 'med.epi', name: 'Epidemiology', group: 'Medicine & Health' },
  { code: 'med.gen', name: 'Medical Genetics', group: 'Medicine & Health' },
  { code: 'med.health', name: 'Health Services & Policy', group: 'Medicine & Health' },
  { code: 'med.imag', name: 'Medical Imaging', group: 'Medicine & Health' },
  { code: 'med.onco', name: 'Oncology', group: 'Medicine & Health' },
  { code: 'med.pharm', name: 'Pharmacology', group: 'Medicine & Health' },
  { code: 'med.psy', name: 'Psychiatry', group: 'Medicine & Health' },
  { code: 'med.pubh', name: 'Public Health', group: 'Medicine & Health' },
  { code: 'med.other', name: 'Other Medicine', group: 'Medicine & Health' },

  // ────────────────────────────────────────────────────────────────────
  // Earth & Space Sciences
  // ────────────────────────────────────────────────────────────────────
  { code: 'earth.atm', name: 'Atmospheric Science & Climate', group: 'Earth & Space Sciences' },
  { code: 'earth.geol', name: 'Geology', group: 'Earth & Space Sciences' },
  { code: 'earth.geochem', name: 'Geochemistry', group: 'Earth & Space Sciences' },
  { code: 'earth.geomag', name: 'Geomagnetism & Paleomagnetism', group: 'Earth & Space Sciences' },
  { code: 'earth.hydro', name: 'Hydrology & Water Resources', group: 'Earth & Space Sciences' },
  { code: 'earth.ocean', name: 'Oceanography', group: 'Earth & Space Sciences' },
  { code: 'earth.paleo', name: 'Paleontology', group: 'Earth & Space Sciences' },
  { code: 'earth.planet', name: 'Planetary Science', group: 'Earth & Space Sciences' },
  { code: 'earth.seis', name: 'Seismology & Tectonics', group: 'Earth & Space Sciences' },
  { code: 'earth.soil', name: 'Soil Science', group: 'Earth & Space Sciences' },
  { code: 'earth.volc', name: 'Volcanology', group: 'Earth & Space Sciences' },

  // ────────────────────────────────────────────────────────────────────
  // Quantitative Finance (arXiv q-fin.*)
  // ────────────────────────────────────────────────────────────────────
  { code: 'q-fin.CP', name: 'Computational Finance', group: 'Quantitative Finance' },
  { code: 'q-fin.EC', name: 'Economics', group: 'Quantitative Finance' },
  { code: 'q-fin.GN', name: 'General Finance', group: 'Quantitative Finance' },
  { code: 'q-fin.MF', name: 'Mathematical Finance', group: 'Quantitative Finance' },
  { code: 'q-fin.PM', name: 'Portfolio Management', group: 'Quantitative Finance' },
  { code: 'q-fin.PR', name: 'Pricing of Securities', group: 'Quantitative Finance' },
  { code: 'q-fin.RM', name: 'Risk Management', group: 'Quantitative Finance' },
  { code: 'q-fin.ST', name: 'Statistical Finance', group: 'Quantitative Finance' },
  { code: 'q-fin.TR', name: 'Trading & Market Microstructure', group: 'Quantitative Finance' },

  // ────────────────────────────────────────────────────────────────────
  // Economics
  // ────────────────────────────────────────────────────────────────────
  { code: 'econ.EM', name: 'Econometrics', group: 'Economics' },
  { code: 'econ.GN', name: 'General Economics', group: 'Economics' },
  { code: 'econ.TH', name: 'Theoretical Economics', group: 'Economics' },

  // ────────────────────────────────────────────────────────────────────
  // Psychology & Cognitive Science
  // ────────────────────────────────────────────────────────────────────
  { code: 'psy.cog', name: 'Cognitive Psychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.dev', name: 'Developmental Psychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.exp', name: 'Experimental Psychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.clinical', name: 'Clinical Psychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.social', name: 'Social Psychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.neuro', name: 'Neuropsychology', group: 'Psychology & Cognitive Science' },
  { code: 'psy.meta', name: 'Meta-science & Replication', group: 'Psychology & Cognitive Science' },

  // ────────────────────────────────────────────────────────────────────
  // Social Sciences
  // ────────────────────────────────────────────────────────────────────
  { code: 'soc.gen', name: 'General Sociology', group: 'Social Sciences' },
  { code: 'soc.urban', name: 'Urban & Regional Studies', group: 'Social Sciences' },
  { code: 'soc.demo', name: 'Demography', group: 'Social Sciences' },
  { code: 'soc.work', name: 'Labor & Workplace Studies', group: 'Social Sciences' },
  { code: 'pol.gen', name: 'Political Science', group: 'Social Sciences' },
  { code: 'pol.intl', name: 'International Relations', group: 'Social Sciences' },
  { code: 'pol.pp', name: 'Public Policy', group: 'Social Sciences' },
  { code: 'law.gen', name: 'Legal Scholarship', group: 'Social Sciences' },
  { code: 'anthro', name: 'Anthropology & Archaeology', group: 'Social Sciences' },
  { code: 'comm', name: 'Communication & Media Studies', group: 'Social Sciences' },
  { code: 'soc.other', name: 'Other Social Sciences', group: 'Social Sciences' },

  // ────────────────────────────────────────────────────────────────────
  // Humanities
  // ────────────────────────────────────────────────────────────────────
  { code: 'hum.phil', name: 'Philosophy', group: 'Humanities' },
  { code: 'hum.hist', name: 'History', group: 'Humanities' },
  { code: 'hum.ling', name: 'Linguistics', group: 'Humanities' },
  { code: 'hum.lit', name: 'Literature & Cultural Studies', group: 'Humanities' },
  { code: 'hum.art', name: 'Art & Aesthetics', group: 'Humanities' },
  { code: 'hum.relig', name: 'Religious Studies', group: 'Humanities' },
  { code: 'hum.music', name: 'Music & Musicology', group: 'Humanities' },
  { code: 'hum.dh', name: 'Digital Humanities', group: 'Humanities' },
  { code: 'hum.other', name: 'Other Humanities', group: 'Humanities' },

  // ────────────────────────────────────────────────────────────────────
  // Education & Methodology
  // ────────────────────────────────────────────────────────────────────
  { code: 'edu.cur', name: 'Curriculum & Pedagogy', group: 'Education & Methodology' },
  { code: 'edu.assess', name: 'Assessment & Measurement', group: 'Education & Methodology' },
  { code: 'edu.tech', name: 'Educational Technology', group: 'Education & Methodology' },
  { code: 'edu.policy', name: 'Education Policy', group: 'Education & Methodology' },
  { code: 'meth.gen', name: 'Research Methodology', group: 'Education & Methodology' },
  { code: 'meth.qual', name: 'Qualitative Methods', group: 'Education & Methodology' },
  { code: 'meth.mixed', name: 'Mixed-Methods Research', group: 'Education & Methodology' },
];

export const CATEGORY_CODES: readonly string[] = CATEGORIES.map((c) => c.code);
const CATEGORY_INDEX = new Map(CATEGORIES.map((c) => [c.code, c]));

export function getCategory(code: string): CategoryNode | undefined {
  return CATEGORY_INDEX.get(code);
}

export function isCategoryCode(code: string): boolean {
  return CATEGORY_INDEX.has(code);
}

/**
 * Group categories by their parent group, preserving the declaration order so
 * the wizard renders Physics → Math → CS → … in a stable order.
 */
export function groupCategories(): Record<CategoryGroup, CategoryNode[]> {
  const acc = {} as Record<CategoryGroup, CategoryNode[]>;
  for (const group of CATEGORY_GROUPS) acc[group] = [];
  for (const cat of CATEGORIES) {
    const group = cat.group as CategoryGroup;
    if (!acc[group]) continue;
    acc[group].push(cat);
  }
  return acc;
}

/**
 * The top-level prefix of a category code — useful for OAI-PMH set names and
 * URL filters. `cs.LG` → `cs`, `physics.optics` → `physics`, `gr-qc` → `gr-qc`.
 */
export function categoryPrefix(code: string): string {
  const dot = code.indexOf('.');
  return dot === -1 ? code : code.slice(0, dot);
}
