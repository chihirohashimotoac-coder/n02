# Pentathlon rules research

This document records the rules used to implement n02's Pentathlon mode, and where they came from.

## Access constraints (read before anything else)

This session's network egress is policy-restricted. Direct fetches to the primary sources named in
the task were **blocked at the network gateway** (`EGRESS_BLOCKED`, confirmed for every domain below),
so nothing in this document could be pulled from a live primary page. Everything here comes from
search-engine result snippets/summaries (via the WebSearch tool) that quote or paraphrase secondary
community sources, cross-checked across multiple independent sources where possible.

Blocked during research: `nakka.com` (n01 / i-Pentathlon home), `darts.or.jp` (公益社団法人 日本ダーツ協会,
the real "JDA"), `jsfd.or.jp` (Japan Sports Federation of Darts), `9darts.jugem.jp`, `en.wikipedia.org`,
`dartbase.com`, `web.archive.org`.

Because of this, **no numeric official point-conversion table for either Pentathlon preset could be
retrieved or confirmed.** This is flagged explicitly below rather than invented. Per the task's own
priority order (repo → existing code → git history → docs → JDA official info → nakka.com public
rules → reliable secondary sources), secondary sources were used only after primary sources proved
unreachable, and every rule below is marked as **Confirmed** (multiple independent sources agree),
**Reasonably corroborated** (consistent single/generic-source), or **Undetermined / interpreted**
(no reliable source found; a documented, conservative implementation choice was made instead of
guessing at the competitive rule).

No n01 source code, images, CSS, or JavaScript were viewed or copied at any point in this research or
in the implementation. Only the fact of public game rules/format was used.

---

## JDA preset — 501 → Half-It → Round the Clock on Doubles → Golf → 301

"JDA" here names the preset after 公益社団法人日本ダーツ協会 (Japan Darts Association), whose site
confirms (via search index metadata, since the page itself was unreachable) that Pentathlon is part of
their instructor-qualification curriculum. Its own numeric rulebook could not be reached, so each
discipline below is implemented from the closest confirmable/generic ruleset for that named game,
explicitly **not** the "British Pentathlon" event (a different, separately documented format — see
the note at the end of this section).

### 1. 501
**Confirmed** (standard X01 convention already implemented by n02's existing 通常01 engine, reused
as-is): straight-in, double-out, start 501, 3 darts/visit, bust on remaining <0, remaining ==1, or
reaching 0 on a non-double dart. compareResults = fewer darts used to check out wins; a player who
does not finish records no checkout for this discipline.

### 2. Half-It
**Reasonably corroborated** across several independent Japanese darts-rule sites (darts-rule.com,
dartsmeeee.com, ruleof.info, kit-work.com all describe the same sequence). Adopted structure:

- Start score: **40 points** (not zero).
- 9 rounds, 3 darts/round, fixed target sequence:
  `15, 16, Double(any), 17, 18, Triple(any), 19, 20, Bull`.
- Any of the 3 darts hitting the round's target scores `target × multiplier` (e.g. hitting D16 in
  round 2 scores 32; in the wildcard "Double"/"Triple" rounds, *any* double/triple scores
  `hitNumber × multiplier`, and Bull is a single 25/double 50 target like any other round).
- If **none** of the 3 darts hit the round's target at all, the player's running score is **halved**
  (rounded down, standard integer-half convention; this specific rounding direction was not
  independently re-confirmed and is marked **interpreted**).
- After 9 rounds, highest score wins. compareResults = higher score wins; tie = draw.

### 3. Round the Clock on Doubles
**Reasonably corroborated** core mechanic, **undetermined** exact finish/point formula for JDA
specifically. Multiple sources describe standard "Round the Clock" as sequential 1→20 (any hit
advances) with an "上級者向け" advanced variant requiring the **double** of each number to advance
("ダブルまわり"); the JDA discipline name explicitly is the doubles variant. A separate, well-documented
"Round the Clock Doubles" event inside the (distinct) **British Pentathlon** format adds a 42-dart cap
and a bull finish, with points = doubles hit + darts saved. Since JDA's own numeric formula could not
be retrieved, and the task explicitly warns not to conflate JDA with British Pentathlon, the game
*mechanic* (not the point formula) is adopted from the corroborated common ground:

- Sequential targets **Double 1 → Double 20**, in order; only the current target's double advances
  the player, any other hit (including a non-double hit on the correct number) is a non-advancing dart.
- Final target after D20: **Bull** (either the outer or inner ring counts as completion — sources
  disagree on whether an inner "double bull" is required, so the easier "any bull" reading was taken
  to avoid inventing a harder rule than confirmed). **Interpreted.**
- No hard round cap by default (darts used is the natural performance metric, consistent with the
  task's own compareResults guidance), but a generous optional cap is offered for parity with the
  British-Pentathlon-documented 42-dart convention. **Interpreted**, not asserted as JDA's own cap.
- compareResults = fewer darts to complete all 21 targets wins; a player who doesn't complete records
  their count of targets reached as a fallback ranking, clearly not a formal JDA score.

### 4. Golf
**Confirmed** stroke-scoring convention (converges across multiple independent English-language
dart-rule sites): each hole = one board number, played in ascending numerical order; up to 3 darts
per hole, but a player may stop after dart 1 or 2 — **only the last dart thrown counts**, so continuing
is a gamble, not a bonus. Strokes: Double = 1, Treble = 2, Single = 3, Miss = 5. Lowest total strokes
wins. **Undetermined**: hole count for the JDA pentathlon specifically. Sources confirm both a 9-hole
("half") and 18-hole variant exist generically; **9 holes (numbers 1–9) was chosen** as the practical
default for a 5-event pentathlon, documented here as an implementation choice, not a confirmed JDA fact.
compareResults = fewer total strokes wins; tie = draw.

### 5. 301
**Reasonably corroborated**: multiple Japanese sources describe "301" in a competitive/pentathlon
context as **Double-In / Double-Out**, with a **13-round limit** (39 darts) — scoring 0 / a loss if not
finished within the limit. This is different from n02's existing 通常01 (which is straight-in). The
existing X01 engine gains an additive `doubleIn` option (default `false`, so 通常01/Checkout/501 are
unaffected) used only by this discipline. compareResults = fewer darts wins; a player who doesn't
finish inside the round limit is treated as not having checked out (loses to anyone who did).

**Note on "British Pentathlon"**: per the task's own instruction this must not be confused with JDA.
British Pentathlon is a separately, well-documented event (Half-It / Shanghai / Round-the-Board-on-
doubles, etc. per dartbase.com's summary) with its own scoring table; it was consulted only as
corroborating background for the *mechanics* of Round the Clock on Doubles above, never adopted as
"the JDA table."

---

## n01 / i-Pentathlon preset — Cork → 301 → Baseball → 501 → Cricket

This lineup (Cork, 301, Baseball, 501, Cricket) matches both the user-specified nakka.com/i/pen/
line-up and an independent secondary description of a Japanese darts "Pentathlon（五種競技）" found at
a hobbyist blog (Road 2 9darts), which states the format explicitly:

> 「ペンタスロンはコーク、301、ベースボール、501、クリケットの5種目を順にこなし、なるべく多く得点することを
> 目指すゲームです。種目毎のスコアを得点換算表と照らし合せて、出てきたその得点を合計します。」

This confirms the *existence* of an official score→points conversion-table system for this exact
lineup (each discipline's raw result is looked up in a conversion table, and the resulting points are
summed for the overall placing) — but the **numeric table itself was not retrievable** from this
environment (the source page is a blocked domain; nakka.com itself, the authoritative source, is also
blocked). This is the central limitation of this implementation: **see "Overall scoring" below.**

### 1. Cork
**Confirmed** base game ("diddle for the middle"): each player throws at the bull; inner bull (50)
beats outer bull (25) beats any board hit by proximity; ties are re-thrown. This is normally used only
to decide who throws first, not as a scored discipline in its own right, so **the exact format nakka.com
uses when Cork appears as a full Pentathlon discipline (dart count, tie procedure) could not be
confirmed** — no source describing it as a standalone scored event was found. **Interpreted**
implementation: each player throws 1 dart at the bull; closest wins the discipline outright (Inner
Bull > Outer Bull > single-dart board proximity > miss); an exact tie triggers a sudden-death re-throw.
compareResults = closer to centre wins; true tie = draw.

### 2. 301
Same X01 engine as JDA's 301 above (**Reasonably corroborated**: Double-In/Double-Out, 13-round
limit). Reused identically — one engine, two presets.

### 3. Baseball
**Confirmed**, converges across independent Japanese and English sources: 9 innings, inning *N* only
scores hits on number *N* (other numbers don't count that inning), 3 darts/inning ("at-bats"),
Single = 1 run, Double = 2 runs, Triple = 3 runs (max 9 runs/inning on three triples), miss = 0.
Highest total runs after 9 innings wins; a tie plays extra innings (10, 11, …) until broken.
compareResults = higher total runs wins; still tied after the extra-innings cap = draw (a bounded cap
is applied for a practical UI rather than literally unbounded innings).

### 4. 501
Same X01 engine as JDA's 501 (straight-in/double-out). One engine, two presets.

### 5. Cricket
**Confirmed** base mechanics, consistently documented: numbers 20, 19, 18, 17, 16, 15 and Bull only.
Each target needs 3 marks to "open" (Single = 1 mark, Double = 2, Triple = 3 — Bull counts outer = 1,
inner = 2 — accumulated across up to 3 darts/visit); marks beyond the 3rd on an opened target score
points equal to `target value × surplus marks` (Bull = 25).

**Deliberate deviation — read this carefully.** In tournament Cricket the *opponent* can close your
number and stop you scoring on it; that head-to-head territory-denial dynamic is the game's defining
feature. n02's Pentathlon implements **independent per-player attempts instead**: each player opens
and scores on their own targets and the opponent cannot close them out. This is a conscious trade-off
forced by two hard requirements of this mode: (a) 1-player Pentathlon must play the same discipline
at all, and (b) the task requires each player to *complete their own official result* rather than
having one player's finish terminate the other's attempt. This is an **implementation decision, not a
rule finding** — tournament Cricket is not what is being modelled here, and the interactive variant
would need a different session model to support.

An attempt ends when the player closes all 7 targets, or at a **20-round limit** (this cap is
**interpreted**, not a confirmed nakka.com number). compareResults: closing all 7 targets outranks not
closing them; among players of equal closing status, more points wins; otherwise draw.

---

## Overall Pentathlon result / ranking

The task requires: *if an official total-points system exists, use it — never invent an overall winner
from win-count alone.* Research above establishes that **an official score-to-points conversion table
almost certainly exists for the Cork/301/Baseball/501/Cricket lineup** (and plausibly for JDA's lineup
too, per the British-Pentathlon-adjacent convention), but its **numeric values were not retrievable**
from any source reachable in this environment.

Rather than fabricate plausible-looking numbers and present them as "the official points," the
implementation:

- Shows each discipline's **actual result** for both players (darts/score/runs/etc., whichever is
  native to that discipline) side by side — this part is never in doubt.
- Determines each discipline's **winner** via that engine's own `compareResults()` (never raw-number
  comparison across unrelated disciplines).
- Reports the Pentathlon **TOTAL/RESULT** as each player's **discipline-win count** (out of 5), clearly
  labelled in the UI as "Discipline wins," explicitly **not** labelled as an official points total.
- If a future contributor obtains the real conversion table, it is designed to slot into
  `compareResults`'s neighbourhood (`src/domain/pentathlon/engines/*`) without changing the session
  controller or UI contracts.

This is the "確定不能な場合は事実と実装上の扱いを明確にする" (undeterminable → state the fact and the
implementation's actual behaviour) case the task anticipates, applied honestly rather than resolved by
guesswork. It also directly answers the "can 2 players alone even populate an official points table"
concern the task raises: most such tables are normalized against a wide competitive field (like a golf
handicap table), so even *with* the real numbers, a 2-player casual session couldn't reproduce an
official tournament placing anyway — win-count is the honest, self-consistent substitute for exactly
that reason.

## Contradictions found

- **"Round the Clock" bull requirement**: sources disagree on whether the closing Bull must be the
  harder inner ("double") bull or any bull. Not resolved by further searching within this session's
  network constraints; documented above as an explicit implementation choice (any bull), not silently
  picked.
- No other direct rule-vs-rule contradiction was found between sources (most secondary sources agreed
  with each other where they overlapped); the larger gap throughout is **missing** JDA/n01-specific
  numeric detail (point tables, exact round caps) rather than conflicting numbers.
