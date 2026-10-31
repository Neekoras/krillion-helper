# Krillion Helper

A personal Chrome extension that suggests obscure answers while you play [Krillion](https://krillion.io).

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `extension` folder.
3. Open the extension's **Details**, then **Extension options**, and paste your OpenAI key.

## How it works

- **Suggestions:** when a prompt appears, GPT-6 Luna generates up to 40 obscure answers and the Decisions API ranks them by obscurity times the squared chance a reference list includes them. It also removes answers it's confident don't fit the prompt. The panel shows the top six, and when one is rejected the next moves up. Click one or press Alt + its number to fill the answer box, then press Enter yourself.
- **Answer book:** when you finish a dive, the game shows that dive's answers. The extension saves the top answer and some Deep Cuts for each prompt and shows them first if the prompt comes up again.
- **Where it runs:** Unlimited, Archive and themed packs. On the Daily Dive, suggestions stay off until you turn them on from the panel. Puffer Party is always excluded because it's played against other people.
- **Toolbar popup:** shows your dive pace on a water column, how many answers landed in each tier, and a switch for the Daily Dive.

## What the game does

Learned by playing Unlimited dive 1:

- `POST /api/unlimited/<n>/submit` is checked on the server and returns `accepted`, `answer`, `tier`, `score` and a signed `receipt`.
- A close match returns `correction`, and pressing Enter again submits the corrected answer.
- A wrong answer costs only time, because you can guess again until the timer runs out.
- `GET /api/unlimited/<n>/reveal` runs after a dive and returns every accepted answer with its tier.
- Each prompt in that dive had exactly one `krillion` answer, chosen by hand with a fun fact attached.

## Development

```bash
npm test
```

With `OPENAI_API_KEY` set, `node scripts/eval-pipeline.mjs <tiers.json>` scores the suggestion code against a file of known tier lists.
