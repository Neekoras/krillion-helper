# Krillion Helper

A personal Chrome extension that suggests obscure answers while you play [Krillion](https://krillion.io).

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `extension` folder.
3. Open the extension's **Details**, then **Extension options**, and paste your OpenAI key.

## How it works

- **Suggestions:** when a prompt appears, GPT-6 Luna generates up to 40 obscure answers and the Decisions API ranks them by obscurity times the squared chance a reference list includes them. It also removes answers it's confident don't fit the prompt. The panel shows the top six, and when one is rejected the next moves up. Click one or press Alt + its number to fill the answer box, then press Enter yourself.
- **Answer book:** when you finish a dive, the game shows that dive's answers. The extension saves the top answer and some Deep Cuts for each prompt and shows them first if the prompt comes up again.
- **Where it runs:** Unlimited, Archive and themed packs. On the Daily Dive, suggestions stay off until you turn them on from the panel. In Puffer Party, it runs in hosted public and private rooms during a round. Rated and Quick Play stay off.
- **Toolbar popup:** shows your dive pace on a water column, how many answers landed in each tier, and a switch for the Daily Dive.
- **Puffer Party:** suggests answers for the current category, safest first, and removes anything already accepted or missed by anyone in the room. Clicking one fills the answer box at any point in the round, so you can have it ready before your turn. It reads the game's room messages but never sends anything or submits for you.

## What the game does

Learned by playing Unlimited dive 1:

- `POST /api/unlimited/<n>/submit` is checked on the server and returns `accepted`, `answer`, `tier`, `score` and a signed `receipt`.
- A close match returns `correction`, and pressing Enter again submits the corrected answer.
- A wrong answer costs only time, because you can guess again until the timer runs out.
- `GET /api/unlimited/<n>/reveal` runs after a dive and returns every accepted answer with its tier.
- Each prompt in that dive had exactly one `krillion` answer, chosen by hand with a fun fact attached.

Learned from the game's Puffer Party client code. The server isn't visible, and rooms can change the default settings:

- Everyone starts with 2 hearts and can hold up to 5. A pop costs the holder a heart, and the last player floating wins.
- The fuse defaults to 10 to 30 seconds, with a minimum turn of 8 seconds.
- A wrong answer (`miss`) or a used one (`repeat`) costs no heart, only the time you spend on it.
- Any accepted answer passes the puffer, whatever its tier.
- Each accepted answer adds its tier's points to a meter: Plankton 10, Too Clever 15, Schooler 30, Rare 60, Deep Cut 85, One in a Krillion 100. At 600 you gain a heart.
- A category ends when enough answers are accepted (`threshold`) or when someone pops.
- Answer lists come from dictionaries, wiki pages and encyclopedias, and include aliases, according to the FAQ.

## Development

```bash
npm test
```

With `OPENAI_API_KEY` set, `node scripts/eval-pipeline.mjs <tiers.json>` scores the suggestion code against a file of known tier lists.
