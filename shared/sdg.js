// UN Sustainable Development Goals: names, official colours, and a rule that tags any job or skill with a goal and a
// one-line reason. The 45 catalogue jobs and skills carry hand-written tags (db/seed/knowledge.json); ESCO jobs and
// skills (thousands) get theirs from this rule, so every role and skill links to at least one goal.
// Rule: a topic word in the name picks a specific goal; otherwise a job's ISCO-08 sub-major group does. Every job also
// links to SDG 8 (decent work: target 8.5) and every skill to SDG 4 (target 4.4: skills for decent jobs).

/** All 17 goals, with the UN's official names (as on the icons) and colours. */
export const SDG_INFO = Object.freeze({
  1: { name: "No poverty", color: "#e5243b" }, 2: { name: "Zero hunger", color: "#dda63a" },
  3: { name: "Good health and well-being", color: "#4c9f38" }, 4: { name: "Quality education", color: "#c5192d" },
  5: { name: "Gender equality", color: "#ff3a21" }, 6: { name: "Clean water and sanitation", color: "#26bde2" },
  7: { name: "Affordable and clean energy", color: "#fcc30b" }, 8: { name: "Decent work and economic growth", color: "#a21942" },
  9: { name: "Industry, innovation and infrastructure", color: "#fd6925" }, 10: { name: "Reduced inequalities", color: "#dd1367" },
  11: { name: "Sustainable cities and communities", color: "#fd9d24" }, 12: { name: "Responsible consumption and production", color: "#bf8b2e" },
  13: { name: "Climate action", color: "#3f7e44" }, 14: { name: "Life below water", color: "#0a97d9" },
  15: { name: "Life on land", color: "#56c02b" }, 16: { name: "Peace, justice and strong institutions", color: "#00689d" },
  17: { name: "Partnerships for the goals", color: "#19486a" },
});

// Topic words -> goal, first match wins (more specific topics first).
const TOPICS = [
  [13, /\b(climate|carbon|emission|esg|greenhouse|environment\w*|sustainab\w*|pollution)/i, "Work on emissions and the environment (target 13.2)"],
  [7, /\b(energy|solar|wind turbine|renewable|power plant|electricity)/i, "Work that keeps energy clean and reliable (target 7.2)"],
  [6, /\b(water|sanitation|sewage|wastewater)/i, "Work on clean water and sanitation (target 6.3)"],
  [14, /\b(marine|ocean|fisher\w*|aquacultur\w*)/i, "Work that depends on healthy seas (target 14.4)"],
  [15, /\b(forest\w*|biodivers\w*|wildlife|conservation)/i, "Work that protects land and nature (target 15.2)"],
  [2, /\b(agricultur\w*|farm\w*|crop\w*|livestock|food)/i, "Work that feeds people (target 2.4)"],
  [3, /\b(health\w*|medic\w*|patient\w*|nurs\w*|clinic\w*|pharma\w*|hygiene|therap\w*|safety)/i, "Work that keeps people healthy and safe (target 3.8)"],
  [12, /\b(supply chain|procure\w*|inventory|logistic\w*|recycl\w*|waste|circular)/i, "Using materials and goods responsibly (target 12.5)"],
  [16, /\b(audit\w*|complian\w*|regulat\w*|legal|law\b|governance|ethic\w*|fraud|tax(ation|es)?\b|polic(e|ing))/i, "Accountable, transparent institutions (target 16.6)"],
  [10, /\b(inclusi\w*|disabilit\w*|social work\w*|community|welfare)/i, "Including people who are left out (target 10.2)"],
  [5, /\b(gender|women)/i, "Equal chances for women (target 5.5)"],
  [11, /\b(urban|construction|building|transport\w*|housing|railway)/i, "Safer, better-run cities and transport (target 11.2)"],
  [4, /\b(teach\w*|educat\w*|training|tutor\w*|curricul\w*)/i, "Helping others learn (target 4.4)"],
  [9, /\b(data|software|programm\w*|digital|ai\b|artificial intelligence|machine learning|automat\w*|cloud|cyber\w*|engineer\w*|technolog\w*|research)/i, "Digital and industrial innovation (target 9.5)"],
];

// ISCO-08 sub-major group (first two digits) -> goal, for jobs whose title names no topic.
const ISCO = {
  "01": 16, "02": 16, "03": 16, 11: 16, 12: 8, 13: 9, 14: 8,
  21: 9, 22: 3, 23: 4, 24: 8, 25: 9, 26: 16,
  31: 9, 32: 3, 33: 8, 34: 10, 35: 9,
  41: 8, 42: 8, 43: 8, 44: 8,
  51: 8, 52: 8, 53: 3, 54: 16,
  61: 2, 62: 2, 63: 2,
  71: 11, 72: 9, 73: 8, 74: 7, 75: 12,
  81: 9, 82: 9, 83: 11,
  91: 6, 92: 2, 93: 8, 94: 2, 95: 8, 96: 12,
};
const ISCO_REASON = {
  2: "A job in food and farming (target 2.4)", 3: "A health or care job (target 3.8)", 4: "A teaching job (target 4.c)",
  6: "Cleaning and hygiene work (target 6.2)", 7: "Electrical work that runs on and for energy (target 7.1)",
  8: "Productive work that pays a living (target 8.5)", 9: "Work in industry, science or technology (target 9.5)",
  10: "Social and community work (target 10.2)", 11: "Building and moving people in cities (target 11.2)",
  12: "Making and handling goods, and their waste (target 12.5)", 16: "Public order, law and leadership (target 16.6)",
};

export const JOB_BASE = [8, "Moving into this job is redeployment, not job loss (target 8.5)"];
export const SKILL_BASE = [4, "A skill adults need for decent jobs (target 4.4)"];

/** Any stored tag shape ([goal, reason] or [[goal, reason], ...]) as a list of [goal, reason]. */
export function normSdg(x) {
  if (!Array.isArray(x) || !x.length) return [];
  return (Array.isArray(x[0]) ? x : [x]).filter(r => Array.isArray(r) && Number(r[0]) >= 1 && Number(r[0]) <= 17).map(r => [Number(r[0]), String(r[1] || "")]);
}

const topicOf = text => TOPICS.find(([, re]) => re.test(String(text || "")));
const dedupe = list => list.filter((r, i) => list.findIndex(x => x[0] === r[0]) === i);

/** A job's goals: its title's topic, else its ISCO group, then SDG 8. */
export function sdgForJob(title, isco) {
  const tp = topicOf(title);
  const g = tp ? tp[0] : ISCO[String(isco || "").slice(0, 2)];
  const own = tp ? [tp[0], tp[2]] : g ? [g, ISCO_REASON[g]] : null;
  return dedupe([...(own ? [own] : []), JOB_BASE]);
}

/** A skill's goals: its name's topic, then SDG 4. */
export function sdgForSkill(name) {
  const tp = topicOf(name);
  return dedupe([...(tp ? [[tp[0], tp[2]]] : []), SKILL_BASE]);
}
