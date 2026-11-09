# Krillion Helper

A personal Chrome extension that suggests obscure answers while you play [Krillion](https://krillion.io).

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `extension` folder.
3. Open the extension's **Details**, then **Extension options**, and paste your Anthropic API key.

## How it works

- **Suggestions:** when a prompt appears, Claude Sonnet 5.5, with thinking off for speed, writes up to 30 obscure answers, following guidelines learned from the game's answer sheets (headword names, dictionary-only words for word prompts, no famous "obscure" picks), then grades them in parallel batches of ten. They're ranked by obscurity squared times the chance a reference list includes them, and answers it's confident don't fit the prompt are removed. Grading starts while Claude is still writing, and the ranked list appears within eight seconds. Anything not graded by then is left out. Once a dive starts, the other prompts are prepared in the background, behind the one on screen. The panel shows the top six, and when one is rejected the next moves up. Click one or press its number key to fill the answer box (a number typed after other text in the box types normally), then press Enter yourself.
- **Answer book:** when you finish a dive, the game shows that dive's answers. The extension saves the top answer and some Deep Cuts for each prompt and shows them first if the prompt comes up again.
- **Known answers:** the extension remembers, per question, the answers it sees during play: tiers for accepted answers, and which ones were rejected. If a question comes up again, known answers show their tier and known misses are left out. This only uses what the game already shows you, and it never looks up answer lists.
- **Where it runs:** Unlimited, Archive and themed packs. On the Daily Dive, suggestions stay off until you turn them on from the panel. In Puffer Party, it runs in hosted public and private rooms during a round, and can be switched off from the popup or the panel. Rated and Quick Play stay off.
- **playdaily.org:** dives at playdaily.org/krillion, Classic and Endless, also get suggestions, from a deeper answer request. Its Krillocity daily race, where you type as many answers as you can in 30 seconds, gets the same ranked list, and each answer you use leaves it so the next is ready. It keeps its own saved answers, separate from krillion.io, and doesn't count toward the toolbar popup. Its 1 vs 1, multiplayer and open Krillocity races play real people, so they stay off.
- **Toolbar popup:** shows your dive pace on a water column, how many answers landed in each tier, and switches for the Daily Dive and Puffer Party.
- **Puffer Party:** suggests answers for the current category, safest first, and removes anything already accepted or missed by anyone in the room. When fewer than six are left, it asks Claude for more answers nobody has used, and stops only when Claude has nothing new for that category. Clicking one fills the answer box at any point in the round, so you can have it ready before your turn. It reads the game's room messages but never sends anything or submits for you.

## What the game does

Learned by playing Unlimited dive 1:

- `POST /api/unlimited/<n>/submit` is checked on the server and returns `accepted`, `answer`, `tier`, `score` and a signed `receipt`.
- A close match returns `correction`, and pressing Enter again submits the corrected answer.
- A wrong answer costs only time, because you can guess again until the timer runs out.
- `GET /api/unlimited/<n>/reveal` runs after a dive and returns every accepted answer with its tier.
- Each prompt in that dive had exactly one `krillion` answer, chosen by hand with a fun fact attached.

Learned from the reveal of one finished Unlimited dive (7 prompts, 6,337 answers), so treat these as a small sample:

- Deep Cut is the default for a listed answer that isn't well known: 73% of answers, against Rare 16%, Schooler 10%, Plankton 1%. A uniformly random listed answer would average about 75 points.
- Long, open lists are mostly Deep Cut (wine 94%). Short, closed lists aren't (coastal countries 6%, Rare 47%), so tier is relative to the list.
- There is exactly one One in a Krillion per prompt, 1 answer in 82 to 2,465. Each comes with a one-line fun fact and is often only moderately obscure, so it can't be predicted from rarity. Fun facts appear on 18 answers in total, so a fact doesn't guarantee a gem.

Learned from Daily Dive #109 (7 prompts, 28,774 answers) and its pick counts, one day's sample:

- Tier doesn't follow pick counts. Floppy disk had about 67,000 picks and was Deep Cut, while Tia Mowry had 1 and was Rare. It seems to reflect how obvious an answer is for that prompt, not how famous it is.
- Every prompt had one One in a Krillion, and each was picked by 0.25% to 0.65% of players. That's more than 97% to 100% of that prompt's Deep Cuts, and they ranked 20th to 97th most picked. Gems aren't the rarest answers.
- 62% of listed answers had no picks at all, and all of them were Deep Cut.
- Fun facts appeared only on gems. Several facts show the answer qualifies in a surprising way, such as Bone music (bootlegs cut onto X-rays) and Golf hole cutter.
- Misspellings and old names return `correction` and need a second Enter (Olinguitto to Olinguito, Swaziland to Eswatini). A shortened name can pass straight through (Karakum to Karakum Desert).
- Too Clever didn't appear in this dive. The only example so far is Human for "Name a species of great ape" in Unlimited dive 1, so it may mark an answer that's technically right but a gotcha.

Learned from Geography pack 1, which the game labels as beta with possible scoring issues:

- Lists are short and closed (9 to 69 answers), so far fewer are Deep Cut.
- A prompt can have zero, one or two gems, and fun facts also appear on other tiers. A gem can be a well-known answer with a hidden qualifier, such as Croatia (stars in the crown above its checkerboard).

Learned from the game's Puffer Party client code. The server isn't visible, and rooms can change the default settings:

- Everyone starts with 2 hearts and can hold up to 5. A pop costs the holder a heart, and the last player floating wins.
- The fuse defaults to 10 to 30 seconds, with a minimum turn of 8 seconds.
- A wrong answer (`miss`) or a used one (`repeat`) costs no heart, only the time you spend on it.
- Any accepted answer passes the puffer, whatever its tier.
- Each accepted answer adds its tier's points to a meter: Plankton 10, Too Clever 15, Schooler 30, Rare 60, Deep Cut 85, One in a Krillion 100. At 600 you gain a heart.
- A category ends when enough answers are accepted (`threshold`) or when someone pops.
- Answer lists come from dictionaries, wiki pages and encyclopedias, and include aliases, according to the FAQ.

Learned from the FAQ and from 1,300 of Claude's answers that were on the real lists (Daily #109, Unlimited 1 and the first Movies, Sports, Geography and Lexicon dives):

- The FAQ says some prompts are tiered mechanically from a database of how often a word or name turns up in what people read and write, and the rest with a model plus a manual pass. That shows in the lists. On word, name and place prompts, a rarer tier almost always means a rarer word (the order agrees with the `wordfreq` library 80% to 90% of the time), while on film, team and sport prompts it agrees only about half the time.
- Among listed answers, Claude's obscurity score predicts the tier well: answers it rates under 1 average 29 points, and answers it rates near 3 average 84. Word frequency predicts it less well (52 to 81 points), and it says nothing about whether an answer is listed at all.
- Since a rejected answer only costs time, obscurity now counts for more than the chance of being listed. Squaring it turned many Rare picks into Deep Cuts in replays, with about half a rejection more per prompt.
- The FAQ says the One in a Krillion is picked for fun factor past a certain depth, and should be something a few players actually get. Asking Claude to pick the gem among its own answers, with 12 real gems and their fun facts as examples, found it 8 times in 28, but putting that pick first gained under a point a prompt, so it isn't used.
- Too Clever, per the FAQ, is "the go-to obscure pick that isn't actually that obscure."

Learned from every answer sheet the API hands out without an unlock, 252 prompts and 98,000 answers (`node scripts/fetch-sheets.mjs` saves them to `eval/`): all 30 Words & Language dives, the first dive of the other packs, Unlimited 1, and the day's Daily sheet, which `/api/reveal?date=<today>` returns before you play while past days are "not publicly available". The extension never reads these during play:

- Word prompts are tiered by corpus frequency, as the FAQ says. Over 30 word dives the tier order matched the `wordfreq` library 87% of the time. Plankton words sit around a Zipf frequency of 3.5 (a few times per million words), Schooler around 2.8, Rare around 1.5, and 68% of Deep Cuts and 78% of gems don't appear in the corpus at all. So on a word prompt the target is a dictionary word that modern writing never uses.
- Word prompts get two gems each, both near-zero frequency ("hospitage", "froughy"), so there fun factor is just depth. Elsewhere there's one gem, and it's often not the rarest answer: Iraq for a country with a coastline, Croatia for a flag with a star, Military patrol for a Winter Olympic sport, each with a fun fact about a hidden qualifier or a quirk of history.
- List size sets the tiers. Open categories run into the thousands (South American animals 19,412) and are 95% to 99% Deep Cut, so there nearly any documented uncommon answer scores 85. Short closed lists (6 to 150) are mostly Schooler and Rare, with Deep Cuts for defunct or little-known members.
- A quarter of Claude's rejected answers were on the list under a shorter name: "Bootleg" not "Bootleg recording", "Acetate" not "Acetate disc", "Split" not "Split album", and the gem "Eephus" not "Eephus pitch". The autocorrect didn't bridge those. Only 3% were spelling slips, and the rest were absent.
- Listed names almost never start with "The" (0.5%) or carry parentheses, but 7% keep their diacritics.
- Putting those lessons into the answer prompt mainly helped word prompts: on four Words & Language dives, suggestions found on the list went from 37% to 45%, rejections before a hit fell from 1.6 to 0.4 and points rose from 55 to 62 a prompt. On the other dives it scored the same as before, about 80 points a prompt. A longer version that also pushed defunct or technically-qualifying members of short lists raised rejections and was dropped.
- Too Clever appeared three times in 98,000 answers: Human for a great ape, and Antidisestablishmentarianism twice.

Learned from six Classic dives on playdaily.org, a separate game with different grading:

- Playing the top suggestions, the deeper ranking scored 320 and 484 out of 700, and the krillion.io ranking scored 356 and 352. Those were different prompts in each dive, so this is a small sample.

- Tiers are worth 4, 8, 16, 32, 64 and 100 points, so obscurity pays much more than on krillion.io.
- Played through its API with Claude (35 prompts a side), the krillion.io ranking by obscurity squared scored 73 points a prompt and a ranking built for the doubled points scored 64, mostly by turning Schoolers into Deep Cuts. Almost every accepted answer was off the short list shown afterwards, so the site grades unlisted answers live.
- A prompt can have several One in a Krillion answers, and the lists after a dive are short (25 to about 60 answers).
- Answers not on those lists can still be accepted: Bublik scored Deep Cut for "a food that has a hole in it" but wasn't on the list shown.
- Too Clever here is the answer that feels clever but many people give: Pomegranate for "a thing that contains seeds", Bahrain for "a country in the Middle East".
- Close spellings and near names are accepted straight away (Umamii to Umami, Crochet needle to Crochet Hook), with no second Enter.
- `POST /api/krillion/deal` gives all 7 prompts, `POST /api/krillion/answer` grades one, and `GET /api/krillion/answers` returns a prompt's list after the dive.

## Development

```bash
npm test
```

The extension loads the Anthropic SDK from `extension/vendor/anthropic-sdk.js`. After changing the SDK version in `package.json`, rebuild it with `npm run build:sdk`.

With `ANTHROPIC_API_KEY` set, `node scripts/eval-pipeline.mjs <tiers.json>` scores the suggestion code against a file of known tier lists.
