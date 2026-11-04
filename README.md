# Krillion Helper

A personal Chrome extension that suggests obscure answers while you play [Krillion](https://krillion.io).

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `extension` folder.
3. Open the extension's **Details**, then **Extension options**, and paste your Anthropic API key.

## How it works

- **Suggestions:** when a prompt appears, Claude Sonnet 5.5, with thinking off for speed, writes up to 40 obscure answers, then grades them in parallel batches of ten. They're ranked by obscurity times the chance a reference list includes them, and answers it's confident don't fit the prompt are removed. Once a dive starts, the other prompts are prepared in the background. The panel shows the top six, and when one is rejected the next moves up. Click one or press Alt + its number to fill the answer box, then press Enter yourself.
- **Answer book:** when you finish a dive, the game shows that dive's answers. The extension saves the top answer and some Deep Cuts for each prompt and shows them first if the prompt comes up again.
- **Known answers:** the extension remembers, per question, the answers it sees during play: tiers for accepted answers, and which ones were rejected. If a question comes up again, known answers show their tier and known misses are left out. This only uses what the game already shows you, and it never looks up answer lists.
- **Where it runs:** Unlimited, Archive and themed packs. On the Daily Dive, suggestions stay off until you turn them on from the panel. In Puffer Party, it runs in hosted public and private rooms during a round. Rated and Quick Play stay off.
- **playdaily.org:** dives at playdaily.org/krillion, Classic and Endless, also get suggestions, ranked for that site's steeper points. It keeps its own saved answers, separate from krillion.io, and doesn't count toward the toolbar popup. Its 1 vs 1 and multiplayer stay off.
- **Toolbar popup:** shows your dive pace on a water column, how many answers landed in each tier, and a switch for the Daily Dive.
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

Learned from six Classic dives on playdaily.org, a separate game with different grading:

- Playing the top suggestions, the deeper ranking scored 320 and 484 out of 700, and the krillion.io ranking scored 356 and 352. Those were different prompts in each dive, so this is a small sample.

- Tiers are worth 4, 8, 16, 32, 64 and 100 points, so obscurity pays much more than on krillion.io.
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
