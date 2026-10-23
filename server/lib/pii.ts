// Personal-detail scrubbing (OWNER: intake agent). Runs before any text is sent to an AI model or stored.
// Tuned for Malaysian CVs, in English and Malay. It removes:
//   - the name line (opt-in: dropFirstLineName) and "Name:" lines, and other mentions of that full name
//   - emails, profile links (LinkedIn, GitHub, ...), phone numbers (+60, 01x, landlines, international)
//   - MyKad / NRIC numbers (with or without dashes), passport-style IDs, ID label lines
//   - home addresses (Jalan/Taman/Lorong/... lines, postcode + town/state lines, "Address:" lines)
//   - dates of birth, and lines stating age, gender, race, religion, marital status, nationality, photo etc.
// Whole lines are removed (not blanked) and blank lines are collapsed, so two CVs that differ only in
// these details produce exactly the same text (see tests/fairness.test.ts).
// Running it twice gives the same result as running it once (llm.ts scrubs again as defence in depth).

export interface ScrubResult { text: string; removed: string[] }

// ---- whole-line rules: the line is removed ----

// After a label: a colon or "=", or a dash followed by a space or digit ("Age - 38", "Age-38", but not "Age-analysis").
const SEP = String.raw`\s*(?::|=|[-–](?=\s|\d))`;
// Labelled protected attributes, in English and Malay, at the start of a line or after a separator (| • , ;).
const ATTR_LABEL = String.raw`(?:age|umur|usia|gender|sex|jantina|race|bangsa|keturunan|ethnicity|ethnic group|religion|agama|marital status|status perkahwinan|taraf perkahwinan|nationality|kewarganegaraan|warganegara|citizenship|place of birth|tempat lahir|date of birth|d\.?o\.?b\.?|tarikh lahir|birth ?date|height|weight|tinggi|berat|no\.? of children|bilangan anak|spouse|pasangan|photo|gambar|foto)`;
const PROTECTED_LINE = new RegExp(String.raw`(?:^|[|•·,;])\s*${ATTR_LABEL}\s*(?:\([^)]*\)\s*)?${SEP}`, "i");
// Identity-document label lines (the number itself is also caught by the inline ID rules below).
const ID_LINE = new RegExp(String.raw`(?:^|[|•·,;])\s*(?:ic|nric|i\/c|mykad|kad pengenalan|no\.?\s*k\/p|k\/p|identity card|passport|pasport)\s*(?:no\.?|number|num)?${SEP}`, "i");
const NAME_LINE = new RegExp(String.raw`^\s*(?:name|nama|full name|nama penuh)${SEP}`, "i");
const ADDRESS_LABEL = new RegExp(String.raw`^\s*(?:address|home address|correspondence address|permanent address|alamat|alamat rumah|alamat surat-menyurat)${SEP}`, "i");
// Lines that are only a photo placeholder, e.g. "[Photo]" or "Passport photo attached".
const PHOTO_LINE = /^\s*[[(]?\s*(?:passport[- ]size\s+)?(?:photo(?:graph)?|gambar|foto)(?:\s+(?:attached|here|dilampirkan))?\s*[\])]?\s*$/i;

// Lines made only of protected-attribute words, e.g. "Female | Married | Malaysian" or "Malay, Muslim, 38 years old".
const ATTR_WORDS = new Set(("male female lelaki perempuan man woman married single divorced widowed widow widower berkahwin bujang " +
  "janda duda muslim islam christian christianity kristian buddhist buddha hindu hinduism sikh taoist atheist " +
  "malay melayu chinese cina indian india bumiputera bumiputra iban kadazan dusun bidayuh orang asli eurasian " +
  "malaysian malaysia warganegara citizen non-citizen permanent resident status taraf " +
  "years year yrs old tahun with children child anak kids son daughter and dan no").split(" "));
const FILLER = new Set(["and", "dan", "no", "with", "years", "year", "yrs", "old", "tahun"]);
function isAttributeOnlyLine(line: string) {
  const words = line.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 10) return false;
  // Every word is an attribute or filler word, and at least one is a real attribute.
  return words.every(w => ATTR_WORDS.has(w)) && words.some(w => !FILLER.has(w));
}

// Religion shown indirectly: places of worship and religious groups (e.g. "Church choir", "AJK Surau", "temple committee").
// Islamic finance terms are WORK skills in Malaysia and are never removed.
const RELIGIOUS = /\b(?:church|gereja|chapel|cathedral|parish|mosque|masjid|surau|temple|kuil|tokong|gurdwara|vihara|buddhist|christian|catholic|methodist|anglican|hindu|sikh|taoist|muslim|sunday school|usrah|tahfiz|worship team|bible study|quran|al-quran)\b/i;
const FINANCE_NOT_RELIGION = /\b(?:islamic (?:finance|banking|capital market)|shariah|syariah|sukuk|takaful)\b/i;
const AGE_SEGMENT = /^(?:age|umur|usia)\s*[:\-]?\s*\d{2}$/i;
// Community groups that reveal ethnicity ("Hokkien Youth Association", "Chinese Chamber") or where someone lives
// ("Persatuan Penduduk Taman ...", "Persatuan Belia Kampung ...", a school PTA). "Malaysian" is not an ethnic word here.
const ORG = /\b(?:association|persatuan|society|chamber|club|kelab|guild|clan|kongsi|youth|belia|pibg|pta|rukun tetangga)\b/i;
const ETHNIC = /\b(?:malay|melayu|chinese|cina|indian|india|tamil|telugu|punjabi|hokkien|hakka|cantonese|teochew|hainanese|foochow|henghua|iban|kadazan|dusun|bidayuh|murut|bajau|orang asli|eurasian)\b/i;
const NEIGHBOURHOOD = /\b(?:taman|tmn|kampung|kampong|village|penduduk|residents?|ibu bapa|parent[- ]teacher|rukun tetangga)\b/i;
const sensitiveOrg = (t: string) => ORG.test(t) && (ETHNIC.test(t) || NEIGHBOURHOOD.test(t));
// "Age 30 / Female / Chinese": spaced slashes separate attributes, but only on lines that state one of them
// (so "PO / GRN" or "English / Malay" in a languages line are left alone).
const SLASH_ATTR = /\b(?:male|female|lelaki|perempuan|married|single|divorced|berkahwin|bujang|muslim|islam|christian|kristian|buddhist|hindu|sikh|age|umur)\b/i;

/**
 * Lines often pack several facts together: "NRIC 900918-14-6342 · Female · Indian · Hindu · Single".
 * Split on separators (· | • ; ▪ or 2+ spaces) and drop the pieces that state protected attributes or
 * religious affiliation. Returns the cleaned line, or null if nothing is left.
 */
function dropSensitiveSegments(line: string, removed: Set<string>): string | null {
  const religious = (t: string) => (RELIGIOUS.test(t) && !FINANCE_NOT_RELIGION.test(t)) || sensitiveOrg(t);
  const parts = line.split(SLASH_ATTR.test(line) ? /\s*(?:[·|•;▪]|\s{2,}|\s\/\s)\s*/ : /\s*(?:[·|•;▪]|\s{2,})\s*/);
  if (parts.length < 2) {
    if (religious(line)) { removed.add("protected_attribute"); return null; }
    return line;
  }
  const attrPieces = parts.filter(p => p && (isAttributeOnlyLine(p) || AGE_SEGMENT.test(p.trim())));
  const keep = parts.filter(p => {
    const t = p.trim();
    if (!t) return false;
    if (religious(t) || isAttributeOnlyLine(t) || AGE_SEGMENT.test(t)) return false;
    // A bare 2-digit number among attribute pieces is an age ("29 · Male · Chinese").
    if (/^\d{2}$/.test(t) && attrPieces.length >= 2) return false;
    return true;
  });
  if (keep.length === parts.filter(p => p.trim()).length) return line;
  removed.add("protected_attribute");
  return keep.length ? keep.join(" · ") : null;
}

// Street keywords (Malaysian and English) and states/major towns, to recognise address lines.
// (Kept to words that rarely appear in job descriptions: no "drive", "block", "lane" or "kg".)
const STREET = /\b(?:jalan|jln\.?|lorong|lrg\.?|persiaran|lebuh|lebuhraya|lengkok|taman|tmn\.?|kampung|kampong|pangsapuri|apartment|apartments|kondominium|condominium|residensi|blok|street|road)\s+\S/i;
const STATES = /\b(?:johor|kedah|kelantan|melaka|malacca|negeri sembilan|pahang|perak|perlis|pulau pinang|penang|pinang|sabah|sarawak|selangor|terengganu|kuala lumpur|wilayah persekutuan|putrajaya|labuan|bayan lepas|george ?town|butterworth|bukit mertajam|petaling jaya|shah alam|subang jaya|klang|puchong|kajang|cheras|ampang|cyberjaya|seremban|ipoh|johor bahru|kuching|kota kinabalu|kuantan|alor setar|kota bharu|kuala terengganu|miri|sandakan|singapore)\b/i;
// A house number: 1-5 digits (optionally "No." / "Lot" / "Unit", "12A", "3-2-1"), but not a year like 2015.
const HOUSE_NO = /(?:^|[\s,])(?:no\.?\s*|lot\s*|unit\s*)?(?!(?:19|20)\d\d(?!\d))\d{1,5}[a-z]?(?:-\d{1,4}[a-z]?)*(?=[,\s]|$)(?!\s+(?:km|kg|m|cm|mm|ha|tonnes?|tons?|units?|years?|yrs|tahun|months?|bulan|hours?|jam|days?|hari)\b)/i;
function isAddressLine(line: string) {
  if (ADDRESS_LABEL.test(line)) return true;
  // "No. 23, Jalan Bunga Raya 5": a street word plus a house number.
  if (STREET.test(line) && HOUSE_NO.test(line)) return true;
  // "11900 Bayan Lepas, Pulau Pinang": a postcode and a place name, with a state/town or street word on the line.
  if (/\b\d{5}\s+[A-Z][A-Za-z]+/.test(line) && (STATES.test(line) || STREET.test(line))) return true;
  // A short line that is just "postcode Town".
  if (/^\s*\d{5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\s*[,.]?\s*$/.test(line)) return true;
  // A line that is only a list of places with a neighbourhood and a state: "Taman Rinting, Masai, Johor".
  if (/^\s*[A-Za-z.' ]+(?:,\s*[A-Za-z.' ]+){1,4}\s*$/.test(line) && STREET.test(line) && STATES.test(line)) return true;
  return false;
}

// ---- inline rules: the match is replaced by a placeholder ----

const digits = (m: string) => m.replace(/\D/g, "").length;
const INLINE: [string, RegExp, string | ((m: string) => string)][] = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  ["profile_link", /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:linkedin\.com\/(?:in|pub|profile)|github\.com|gitlab\.com|facebook\.com|fb\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|wa\.me|t\.me)\/[^\s,;)|]+/gi, "[profile link]"],
  // Personal websites: LinkedIn exports label them "site.com (Portfolio)"; CVs write "Website: site.com".
  ["profile_link", /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s)]*)?(?=\s*\((?:portfolio|personal|blog|other|website)\))/gi, "[profile link]"],
  ["profile_link", /(?<=\b(?:website|portfolio|blog|laman web)\s*:\s*)(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?/gi, "[profile link]"],
  // MyKad: YYMMDD-PB-###G, with dashes, spaces or none (12 digits).
  ["id", /(?<![\d-])\d{6}[\s-]?\d{2}[\s-]?\d{4}(?![\d-])/g, "[id]"],
  // Passport-style and old IC numbers, e.g. A12345678, K1234567.
  ["id", /\b[A-Z]{1,2}\d{7,8}\b/g, "[id]"],
  // Landlines written with brackets: (03) 2123 4567.
  ["phone", /\(0\d{1,2}\)\s?\d{3,4}[\s-]?\d{4}\b/g, "[phone]"],
  // Malaysian phones: +60 12-345 6789, 6012-3456789, 012-345 6789, 04-123 4567. Must have 9-12 digits.
  ["phone", /(?<![\w+/.-])(?:\+?60[\s-]?|0)\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w/-])/g, m => (digits(m) >= 9 && digits(m) <= 12 ? "[phone]" : m)],
  // International numbers need a leading + and 9-15 digits: +65 9123 4567, +44 20 7946 0958.
  ["phone", /(?<![\w+])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?![\w%])/g, m => (digits(m) >= 9 && digits(m) <= 15 ? "[phone]" : m)],
  // Scanned (OCR) or oddly grouped phones: "013-5552 819O" (O for 0, l or I for 1), "011-555 30 71".
  ["phone", /(?<![\w+/.-])(?:\+?6\s?0[\s-]?|0)[\dOoIl]{1,2}(?:[\s.-]?[\dOoIl]{1,4}){2,4}(?![\w/-])/g, m => {
    const ocr = m.replace(/[Oo]/g, "0").replace(/[Il]/g, "1");
    return digits(m) >= 8 && digits(ocr) >= 9 && digits(ocr) <= 12 && digits(ocr) - digits(m) <= 2 ? "[phone]" : m;
  }],
  // Unlabelled ages: "38 years old", "berumur 38 tahun". (Not "10 tahun pengalaman" = 10 years' experience.)
  ["protected_attribute", /\b\d{2}\s*(?:years? old|yrs? old|y\/o)(?![a-z])|\b(?:berumur|umur)\s+\d{2}(?:\s*tahun)?\b/gi, "[age]"],
  // Honorific + name (referees, e.g. "Mr. Lim Boon Huat", "Puan Siti Aminah binti Yusof"). Case-sensitive, so "MS Excel" is safe.
  // Malay honorifics may be abbreviated and stacked ("En. Zulkarnain b. Hashim", "Tn. Hj. Rosli b. Abdullah").
  ["name", /\b(?:(?:Mr|Mrs|Ms|Mdm|Madam|Miss|Dr|Prof|Encik|En|Puan|Pn|Cik|Tuan|Tn|Datuk|Dato'?|Datin|Tan Sri|Puan Sri|Toh Puan|Ir|Sister|Matron|Ustaz|Ustazah|Haji|Hj|Hajah|Hjh|Pastor|Father|Reverend|Rev)\.?\s+)+[A-Z][a-zA-Z'’-]+(?:\s+(?:[A-Z][a-zA-Z'’-]+|binti\b|bin\b|bte\b|bt\.?(?=\s)|b\.(?=\s)|a\/[lp]\b|s\/o\b|d\/o\b|anak\b|@))*/g, "[name]"],
];

// Words that mean a capitalised first line is a heading or job title, not a person's name.
const NOT_A_NAME = /\b(?:curriculum|vitae|resume|résumé|cv|profile|summary|objective|experience|education|skills|contact|executive|manager|clerk|accountant|analyst|engineer|supervisor|assistant|officer|specialist|graduate|intern|director|consultant|associate|developer|lead|senior|junior|head|admin|administrator|sales|retail|store|finance|accounts|payable|receivable|page|personal|details|maklumat|peribadi|sdn|bhd|berhad|university|universiti)\b/i;
// Malaysian name connectors in any case: bin/binti (Malay), a/l, a/p, s/o, d/o (Indian), anak/ak (Iban and other Sarawak names).
const NAME_TOKEN = String.raw`(?:[A-Z][A-Za-z'’.-]+|[A-Z]{2,}|(?:bin|binti|bt|a\/[lp]|s\/o|d\/o|anak|ak|BIN|BINTI|BT|A\/[LP]|S\/O|D\/O|ANAK|AK)(?=\s)|@)`;
const NAME_RE = new RegExp(String.raw`^\s*${NAME_TOKEN}(?:\s+${NAME_TOKEN}){1,5}\s*$`);
/** LinkedIn "Save to PDF" text: starts with a Contact sidebar and has "(LinkedIn)" or "Top Skills". */
const isLinkedInExport = (t: string) => /^\s*Contact\s*$/m.test(t.slice(0, 300)) && /\(LinkedIn\)|^\s*Top Skills\s*$/m.test(t.slice(0, 1500));
const HEADING_ONLY =/^\s*(?:curriculum vitae|resume|résumé|cv)\s*$/i;

export function scrubPii(input: string, opts: { dropFirstLineName?: boolean } = {}): ScrubResult {
  const removed = new Set<string>();
  const lines = (input || "").replace(/\r\n?/g, "\n").split("\n");
  let fullName = null as string | null; // (set inside nameAt below)

  if (opts.dropFirstLineName) {
    // The name is usually in the first few non-empty lines, sometimes inside a heading such as
    // "CURRICULUM VITAE - LIM WEI LING     Page 1 of 3". The first name-like line wins.
    const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
    const linkedIn = isLinkedInExport(input);
    const nameAt = (core: string, i: number) => {
      fullName = core;
      lines[i] = lines[i].replace(core, "[name]"); removed.add("name");
    };
    if (linkedIn) {
      // LinkedIn "Save to PDF": a sidebar (Contact, Top Skills, ...) comes first and the name sits just above the
      // headline. Skill names in the sidebar look like names ("Adobe Illustrator"), so the first-lines rule is not used.
      // The profile link usually starts with the name ("linkedin.com/in/hafiz-roslan-..."): its first two words.
      const slug = (/linkedin\.com\/in\/([a-z0-9-]+)/i.exec(input)?.[1] || "").toLowerCase().split("-").slice(0, 2).filter(w => w.length >= 2);
      for (let k = 0; k < Math.min(nonEmpty.length, 40); k++) {
        const [line, i] = nonEmpty[k];
        const core = line.trim();
        if (!NAME_RE.test(core) || NOT_A_NAME.test(core)) continue;
        const next = nonEmpty[k + 1]?.[0] || "";
        if (slug.includes(core.toLowerCase().split(/\s+/)[0]) || /\s\|\s/.test(next)) { nameAt(core, i); break; }
      }
    } else {
      // The name is usually in the first few non-empty lines, sometimes inside a heading such as
      // "CURRICULUM VITAE - LIM WEI LING     Page 1 of 3", "SITI BT JAAFAR  --  CV" or "YEOH SIEW LAN       RESUME".
      for (const [line, i] of nonEmpty.slice(0, 6)) {
        const core = line
          .replace(/^\s*(?:curriculum vitae|resume|résumé|cv)\s*[-–:|]*\s*/i, "")
          .replace(/(?:\s*[-–:|]+\s*|\s{2,})(?:curriculum vitae|resume|résumé|cv)\s*$/i, "")
          .replace(/\s{2,}page \d+ of \d+\s*$/i, "").replace(/\s+page \d+ of \d+\s*$/i, "").trim();
        if (core && NAME_RE.test(core) && !NOT_A_NAME.test(core)) { nameAt(core, i); break; }
      }
    }
  }

  const out: string[] = [];
  for (const rawLine of lines) {
    const line = dropSensitiveSegments(rawLine, removed);
    if (line === null) continue;
    if (NAME_LINE.test(line)) { removed.add("name"); out.push("[name]"); continue; }
    if (PROTECTED_LINE.test(line)) {
      removed.add(/date of birth|d\.?o\.?b|tarikh lahir|birth ?date/i.test(line) ? "dob" : /photo|gambar|foto/i.test(line) ? "photo" : "protected_attribute");
      continue;
    }
    if (ID_LINE.test(line)) { removed.add("id"); continue; }
    if (PHOTO_LINE.test(line)) { removed.add("photo"); continue; }
    if (isAttributeOnlyLine(line)) { removed.add("protected_attribute"); continue; }
    if (isAddressLine(line)) { removed.add("address"); continue; }
    out.push(line);
  }

  let text = out.join("\n");
  // Other mentions of the detected full name (e.g. in a sign-off).
  if (fullName && fullName.length >= 5) {
    const re = new RegExp(fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    text = text.replace(re, "[name]");
  }
  for (const [kind, re, rep] of INLINE)
    text = text.replace(re, (m: string) => {
      const r = typeof rep === "function" ? rep(m) : rep;
      if (r !== m) removed.add(kind);
      return r;
    });

  // Tidy whitespace so removed lines leave no trace: trim line ends, collapse runs of blank lines.
  text = text.split("\n").map(l => l.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, removed: [...removed] };
}
