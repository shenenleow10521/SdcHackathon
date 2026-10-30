// Builds the ESCO skill -> skill network (method: server/services/skill-network.ts header) and writes
// db/seed/esco_skill_network.json.gz.   Run: npx tsx scripts/build-skill-network.ts
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { buildSkillNetwork, encodeNetwork, escoNetworkInput, NETWORK_FILE, NETWORK_PARAMS } from "../server/services/skill-network.ts";

const input = escoNetworkInput();
if (!input) throw new Error("needs db/seed/esco_full.json.gz and db/seed/esco_skill_vectors.bin");
const t0 = Date.now();
const net = buildSkillNetwork(input);
const seconds = Math.round((Date.now() - t0) / 100) / 10;

const total = Object.keys(input.skills).length;
const links = [...net.values()].reduce((a, l) => a + l.length, 0);
const meta = {
  generatedBy: "scripts/build-skill-network.ts",
  generated: new Date().toISOString(),
  method: "relatedness = sqrt(cooc x emb). cooc: NPMI of the two skills across ESCO occupations (essential 1.0, optional 0.5), shrunk by c/(c+1) for little evidence; emb: bge-m3 cosine rescaled from [cosFloor,1]. Both must pass their gate; knowledge items link only to knowledge items. Top-k per skill.",
  params: NETWORK_PARAMS,
  format: "ids: skill ids; links[i] = flat [neighbourIndex, relatedness x 1000, ...] for skill ids[i], strongest first",
  sources: "ESCO v1.2.1 (European Commission, CC BY 4.0); bge-m3 skill vectors db/seed/esco_skill_vectors.bin",
  counts: { skills: total, skillsWithNeighbours: net.size, links, seconds },
};
const gz = gzipSync(JSON.stringify(encodeNetwork(net, meta)), { level: 9 });
writeFileSync(NETWORK_FILE, gz);
console.log(`${net.size}/${total} skills have neighbours, ${links} links, ${(gz.length / 1e6).toFixed(2)} MB gz, ${seconds}s -> ${NETWORK_FILE}`);
