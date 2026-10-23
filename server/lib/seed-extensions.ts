// Extra seed steps contributed by feature modules. Each runs inside the seed transaction, after the base seed.
// Add one import + one array entry per module.
import type { Db } from "./db.ts";
import { seedHr } from "../seed/hr.ts";
import { seedKnowledge } from "../seed/knowledge.ts";
import { seedPersonaEsco } from "../seed/persona-esco.ts";

export const seedExtensions: Array<(t: Db) => Promise<void>> = [seedHr, seedKnowledge, seedPersonaEsco];
