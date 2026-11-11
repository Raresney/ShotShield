// People's names written without a label: "Thanks, Ana Popescu", "John Smith
// replied", "POPESCU ANDREI". There's no model here, only lists: a name counts
// when a known given name sits next to a family name on the same line. That
// keeps it predictable and fast, and it stays quiet on the title-case words a
// screenshot is full of ("Sign In With Google", "Victor Mono").

/** Lowercase without diacritics, so "Ștefan", "STEFAN" and "Stefan" compare equal. */
export function fold(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s$/, "");
}

const words = (list: string): Set<string> => new Set(list.trim().split(/\s+/));

// Common given names, Romanian first, then English and a few from elsewhere
// that turn up in the same chats and mail.
const GIVEN = words(`
  adrian alexandru alex alin andrei anton aurel aurelian bogdan catalin cezar ciprian claudiu
  codrin constantin cornel cosmin costel cristi cristian dan daniel darius david denis dorin
  dragos dumitru eduard emil eugen fabian florian florin gabriel george gheorghe grigore horia
  iacob ilie ioan ion ionel ionut iulian iustin laurentiu liviu lucian marcel marian marius
  matei mihai mihail mircea nicolae nicu octavian ovidiu paul petre petru radu razvan remus
  robert romeo sebastian sergiu silviu sorin stefan teodor tiberiu toma traian tudor valentin
  valeriu vasile victor viorel virgil vlad
  adela adelina adriana alexandra alina ana anca andra andreea angela anisia antonia aurelia
  bianca camelia carmen catalina claudia cornelia corina cristina dana daniela delia denisa
  diana doina ecaterina elena eliza emilia eugenia florentina gabriela georgiana ileana ioana
  irina iulia iuliana larisa laura lavinia lidia liliana loredana luminita madalina magdalena
  mara maria mariana marilena melania mihaela mirela monica natalia nicoleta oana otilia paula
  petronela ramona raluca rebeca roxana sabina simona sofia sorina stefania silvia tatiana
  teodora valentina veronica violeta viorica
  aaron adam alan albert alexander andrew anthony arthur ben benjamin brandon brian bruce carl
  charles chris christopher dennis donald douglas dylan edward eric ethan evan gary gregory
  harry henry ian jacob james jason jeffrey jeremy john jonathan joseph joshua justin keith
  kevin kyle larry liam logan lucas luke matthew michael nathan nicholas noah oliver patrick
  peter philip raymond richard roger ronald ryan samuel scott sean simon stephen steven thomas
  timothy tyler walter william zachary carlos juan jose luis miguel pedro antonio marco luca
  giuseppe francesco hans klaus pierre jean mohamed ahmed omar hiroshi rahul ivan dmitri
  sergei igor piotr tomasz lars erik sven
  abigail alice alicia amanda amy andrea anna anne ashley barbara betty brenda carla caroline
  catherine charlotte chloe christina claire cynthia deborah donna dorothy elizabeth ella
  emily emma evelyn hannah heather helen isabella jacqueline janet jennifer jessica joan julia
  julie karen katherine kathleen kimberly linda lisa lucy margaret marie martha mary megan
  melissa michelle nancy natalie nicole olivia pamela rachel rebecca samantha sandra sarah
  sharon sophia sophie stephanie susan teresa valeria lucia isabel giulia francesca ingrid olga
  natasha svetlana fatima aisha yuki priya
`);

// Given names that are also everyday words, months or places. They only count
// next to a family name the lists know, so "May Update" or "Grace Period" stay
// uncovered while "Will Smith" doesn't.
const AMBIGUOUS = words(`
  may june april august will mark grace rose hope faith joy bill dawn victoria florence virginia
  jordan chase hunter mason jack frank ruby jade iris lily ivy holly olive ray robin eve max
  carol drew grant miles penny dean sky summer constanta
`);
for (const w of AMBIGUOUS) GIVEN.add(w);

// Common family names. A given name next to one of these is a name with little
// doubt, which is also what lets an ambiguous given name count.
const FAMILY = words(`
  popescu ionescu popa pop radu dumitru stan stoica gheorghe matei ciobanu rusu munteanu
  constantin marin mihai lazar florea dinu nistor tudor ilie barbu toma moldovan dobre sima ene
  manea cristea nita oprea lupu ion ionita serban balan voicu preda neagu anghel petrescu
  georgescu dumitrescu enache sandu vasile nicolae stanciu cojocaru mocanu diaconu iordache
  coman avram vlad dragomir ursu bogdan olteanu paraschiv zamfir roman pavel nedelcu pana bucur
  costache grigore mihaila ardeleanu moraru craciun rotaru tanase chirita
  smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez
  gonzalez wilson anderson thomas taylor moore jackson martin lee perez thompson white harris
  sanchez clark ramirez lewis robinson walker young allen king wright scott torres nguyen hill
  flores green adams nelson baker hall rivera campbell mitchell carter roberts muller schmidt
  schneider fischer weber rossi russo ferrari bianchi dubois bernard kowalski nowak ivanov
  petrov smirnov kim park wang zhang chen liu singh kumar patel khan silva santos oliveira
  connor murphy kelly sullivan walsh
`);

// Romanian family names are recognisable by their endings even when the list
// doesn't have them: Dumitrescu, Ardeleanu, Bădoiu, Iordache.
const FAMILY_ENDING = /(?:escu|ascu|eanu|anu|oiu|ache)$/;

// Title-case words that follow a given name without making a name of it: UI
// labels, greetings, places, font and product words, days and months, and the
// Doe of a placeholder "John Doe". Months that are also given names (May,
// June) are left to the ambiguous list.
const NOT_A_NAME = words(`
  the and or of for to in on at by with from new my your our his her their all more about
  home help settings profile account login sign log out up edit view open save delete add
  search share send reply forward file tools window menu page app apps mode dark light team
  group chat message messages inbox mail email phone mobile call video music photo photos news
  store shop bank banca pay card cards street strada road avenue city park hall house hotel
  school college university center centre hospital church station airport airlines air bridge
  square river lake mount island north south east west central international national company
  inc ltd srl sa llc corp foundation institute museum library studio studios media games mono
  sans serif code pro mini plus ultra lite prime premium gold silver edition version update
  release beta alpha monday tuesday wednesday thursday friday saturday sunday january february
  march july september october november december luni marti miercuri
  joi vineri sambata duminica ianuarie februarie martie aprilie mai iunie iulie septembrie
  octombrie noiembrie decembrie today tomorrow yesterday day week month year time date am pm
  hello hi hey dear thanks thank regards best good morning evening night buna salut multumesc
  domnul doamna dl dna mr mrs ms dr prof sir saint sf sfantul de la cu si din pe said says
  posted wrote replied commented liked shared joined left added removed online offline active
  typing seen you me us them they we is are was were be has have had do does did not no yes ok
  okay any each every this that these those romania bucuresti europe america london paris
  period channel battery shoes update doe copyright present author
`);

// A street, school or hospital named after someone: the name is public, and
// covering "Strada Ion Creangă" would only hide the address's street.
const BEFORE_PLACE = words(`
  strada str bulevardul bulevard bd calea aleea piata soseaua sos splaiul intrarea street st
  avenue ave road rd boulevard blvd lane square liceul colegiul scoala universitatea spitalul
  parcul teatrul muzeul aeroportul stadionul statia gara institutul fundatia premiul sf sfantul
  sfanta saint
`);
const AFTER_PLACE = words(`
  street avenue road boulevard lane square university college school hospital airport park
  museum institute foundation prize award center centre bridge station hall
`);

// A word shaped like a name: "Ana", "McDonald", "O'Brien", "Maria-Elena", or
// all capitals as an ID or a signature prints it. OCR may read a capital I as
// l ("lon"); such a word only counts if the I version is a known name.
const TITLE = /^\p{Lu}[\p{Ll}'’]*(?:\p{Lu}\p{Ll}+)?(?:-\p{Lu}\p{Ll}+)?$/u;
const CAPS = /^\p{Lu}{2,}(?:-\p{Lu}{2,})?$/u;
const OCR_I = /^l\p{Ll}+$/u;

interface Token {
  start: number;
  end: number;
  /** Folded, with the OCR l fixed when that makes a known name. */
  key: string;
  shaped: boolean;
}

function token(text: string, start: number): Token {
  const end = start + text.length;
  if (OCR_I.test(text)) {
    const key = fold("I" + text.slice(1));
    return { start, end, key, shaped: GIVEN.has(key) || FAMILY.has(key) };
  }
  const key = fold(text);
  return { start, end, key, shaped: TITLE.test(text) || CAPS.test(text) };
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  // An apostrophe only inside a word ("O'Brien"), so a quote around a name
  // stays out of it.
  for (const m of text.matchAll(/\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*(?:-\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*)*/gu)) {
    out.push(token(m[0], m.index));
  }
  return out;
}

const isGiven = (t: Token): boolean => GIVEN.has(t.key) || t.key.split("-").every((p) => GIVEN.has(p));
const isFamily = (t: Token): boolean => FAMILY.has(t.key) || FAMILY_ENDING.test(t.key);

/** How sure a run of tokens is a person's name, or 0 when it isn't one. */
function judge(run: Token[]): number {
  const word = (t: Token): boolean => NOT_A_NAME.has(t.key) || BEFORE_PLACE.has(t.key) || AFTER_PLACE.has(t.key);
  if (!run.every((t) => t.shaped && t.key.length >= 2 && !word(t))) return 0;
  const given = run.filter(isGiven);
  if (given.length === 0) return 0;
  const family = run.some((t) => isFamily(t) && !(isGiven(t) && AMBIGUOUS.has(t.key)));
  // Every given name in the run is also a word: it needs a real family name.
  if (given.every((t) => AMBIGUOUS.has(t.key)) && !family) return 0;
  const others = run.filter((t) => !isGiven(t));
  const unknown = others.filter((t) => !isFamily(t));
  // A short all-caps word that isn't a known name is an acronym: "Ana BCR".
  if (unknown.some((t) => t.key.length <= 3)) return 0;
  // One word the lists don't know is the family name; a second is the word
  // before it ("Copyright Michael Ciniawsky"), and the name stands without it.
  if (unknown.length > 1) return 0;
  if (family) return run.length === 3 ? 0.85 : 0.8;
  if (others.length === 0) return 0.65; // two given names, "Ana Maria"
  // An unknown family name usually follows the given name; one in front is as
  // likely the word before the name ("Copyright Michael Ciniawsky").
  return unknown[0] === run[0] ? 0.55 : 0.6;
}

export interface NameHit {
  start: number;
  end: number;
  confidence: number;
}

/** Names written on their own, without a label in front of them. */
export function findNames(text: string): NameHit[] {
  const toks = tokens(text);
  // Tokens i and i + 1 belong to one name only when a few spaces part them.
  const joined = (i: number): boolean => /^[ \t]{1,3}$/.test(text.slice(toks[i]!.end, toks[i + 1]!.start));
  const sameLine = (a: number, b: number): boolean => !text.slice(toks[a]!.end, toks[b]!.start).includes("\n");

  const hits: NameHit[] = [];
  // The first token a new name may use: names never share a word.
  let floor = 0;
  let i = 0;
  while (i < toks.length) {
    if (!isGiven(toks[i]!)) {
      i++;
      continue;
    }
    let best: { from: number; to: number; confidence: number } | null = null;
    for (let from = Math.max(floor, i - 2); from <= i; from++) {
      for (let to = i; to <= Math.min(toks.length - 1, from + 2); to++) {
        if (to - from < 1) continue;
        let linked = true;
        for (let k = from; k < to; k++) if (!joined(k)) linked = false;
        if (!linked) continue;
        if (from > 0 && sameLine(from - 1, from) && BEFORE_PLACE.has(toks[from - 1]!.key)) continue;
        if (to + 1 < toks.length && sameLine(to, to + 1) && AFTER_PLACE.has(toks[to + 1]!.key)) continue;
        const confidence = judge(toks.slice(from, to + 1));
        if (confidence === 0) continue;
        const better =
          !best || confidence > best.confidence || (confidence === best.confidence && to - from > best.to - best.from);
        if (better) best = { from, to, confidence };
      }
    }
    if (best) {
      hits.push({ start: toks[best.from]!.start, end: toks[best.to]!.end, confidence: best.confidence });
      i = floor = best.to + 1;
    } else {
      i++;
    }
  }
  return hits;
}
