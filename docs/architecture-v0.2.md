# SampleCheck — Architectuur v0.2

## 1. Doel

SampleCheck is een browsergame waarin spelers muziek-samples moeten herkennen.

De applicatie ondersteunt vanaf de basis twee manieren van spelen:

### Singleplayer

Speler opent SampleCheck en kan onmiddellijk beginnen.

Geen account nodig.

Voorbeeld:

```text
SAMPLECHECK

[ PLAY ]

[ MULTIPLAYER ]
```

Singleplayer:

```text
PLAY
 ↓
kies categorie / difficulty
 ↓
10 rondes
 ↓
score
 ↓
play again
```

### Multiplayer

Speler maakt een room.

```text
CREATE ROOM
     ↓
K7XM
     ↓
vrienden joinen
     ↓
host start
     ↓
10 rondes
     ↓
leaderboard
```

Beide modes gebruiken **dezelfde game-engine en dezelfde vragen-database**.

---

# 2. Hoofdarchitectuur

```text
                         ┌────────────────────────┐
                         │      SAMPLECHECK       │
                         │                        │
                         │ Next.js / React        │
                         │                        │
                         │ Singleplayer UI        │
                         │ Multiplayer UI         │
                         │ Audio player           │
                         └────────────┬───────────┘
                                      │
                          HTTP / WebSocket
                                      │
                     ┌────────────────▼───────────────┐
                     │         API / GAME SERVER      │
                     │                                │
                     │ Fastify                        │
                     │ Socket.IO                      │
                     │                                │
                     │ Game engine                    │
                     │ Question engine                │
                     │ Scoring                        │
                     │ Rooms                          │
                     │ Sessions                       │
                     └─────────┬──────────┬──────────┘
                               │          │
                               │          │
                    ┌──────────▼──┐   ┌───▼─────────┐
                    │ PostgreSQL  │   │ Redis       │
                    │             │   │             │
                    │ Tracks      │   │ Rooms       │
                    │ Samples     │   │ Game state  │
                    │ Questions   │   │ Cache       │
                    │ Games       │   │ Pub/Sub     │
                    │ Scores      │   │             │
                    └──────▲──────┘   └─────────────┘
                           │
                           │
               ┌───────────┴────────────┐
               │    CONTENT PIPELINE    │
               │                        │
               │ WhoSampled scraper     │
               │ Metadata enrichment    │
               │ Timestamp parser       │
               │ Admin / verification   │
               └────────────────────────┘
```

---

# 3. Docker

Ja: **Docker gebruiken.**

Ik zou zelfs zorgen dat een developer SampleCheck lokaal kan starten met:

```bash
docker compose up
```

en daarna heeft hij:

```text
localhost:3000   → frontend
localhost:4000   → API / game server
localhost:5432   → PostgreSQL
localhost:6379   → Redis
```

Eventueel:

```text
localhost:3001   → admin
```

---

# 4. Docker-services

Onze `docker-compose.yml` bevat ongeveer:

```text
samplecheck-web
samplecheck-api
samplecheck-worker
samplecheck-postgres
samplecheck-redis
samplecheck-admin
```

Conceptueel:

```text
┌──────────────────────────────┐
│        Docker Compose        │
│                              │
│ ┌────────┐    ┌───────────┐ │
│ │  web   │───▶│    api    │ │
│ └────────┘    └─────┬─────┘ │
│                     │       │
│              ┌──────▼─────┐ │
│              │ PostgreSQL │ │
│              └────────────┘ │
│                     │       │
│              ┌──────▼─────┐ │
│              │   Redis    │ │
│              └────────────┘ │
│                              │
│ ┌───────────┐                │
│ │  scraper  │───────────────▶│
│ └───────────┘ PostgreSQL     │
│                              │
│ ┌───────────┐                │
│ │   admin   │───────────────▶│
│ └───────────┘ API            │
└──────────────────────────────┘
```

Docker is hier vooral handig omdat de scraper bijvoorbeeld andere dependencies kan hebben dan de webapp.

---

# 5. Repository

Ik zou SampleCheck als een monorepo maken.

```text
samplecheck/
│
├── apps/
│   │
│   ├── web/
│   │   └── Next.js
│   │
│   ├── api/
│   │   └── Fastify + Socket.IO
│   │
│   └── admin/
│       └── internal admin
│
├── workers/
│   │
│   ├── whosampled/
│   │   ├── scraper
│   │   ├── timestamp-parser
│   │   └── importer
│   │
│   └── metadata/
│
├── packages/
│   │
│   ├── database/
│   │
│   ├── game-core/
│   │
│   ├── shared/
│   │
│   └── audio/
│
├── docker/
│   ├── web.Dockerfile
│   ├── api.Dockerfile
│   └── worker.Dockerfile
│
├── docker-compose.yml
│
├── package.json
└── pnpm-workspace.yaml
```

---

# 6. Belangrijk principe: WhoSampled nooit tijdens gameplay

Dus absoluut niet:

```text
player starts round
        ↓
request WhoSampled
        ↓
scrape website
        ↓
start question
```

Dat zou traag en fragiel zijn.

In plaats daarvan:

```text
WhoSampled
   ↓
scraper
   ↓
SampleCheck PostgreSQL
   ↓
questions
   ↓
game
```

De game zelf heeft daardoor **geen directe afhankelijkheid van WhoSampled**.

Als WhoSampled bijvoorbeeld tijdelijk offline is, blijft SampleCheck gewoon werken.

---

# 7. WhoSampled scraper

De bestaande GitHub-repo vormt de basis van het idee. 

Onze versie wordt uitgebreider. https://github.com/rikaa15/WhoSampled-API

Pipeline:

```text
WhoSampled track
       ↓
find sample relationships
       ↓
open relationship page
       ↓
parse:
    source track
    sampled track
    artists
    year
    sample type
    elements
    timestamps
       ↓
normalize
       ↓
PostgreSQL
```

---

# 8. Sample relationship

Stel WhoSampled zegt:

```text
Track B samples Track A

Sample appears at:
0:06
0:08
0:13
0:17
1:10
```

Wij bewaren:

```json
{
  "sourceTimestamps": [
    6,
    8,
    13,
    17,
    70
  ]
}
```

Niet alleen de tekst.

We bewaren eventueel ook het origineel:

```json
{
  "sourceTimestampText": [
    "0:06",
    "0:08",
    "0:13",
    "0:17",
    "1:10"
  ]
}
```

---

# 9. Beide kanten bewaren

Belangrijk:

Er kunnen timestamps staan voor de **source track** én de **track waarin de sample gebruikt wordt**.

Dus:

```text
ORIGINAL

0:37
1:12
2:16

     ↓ sampled in

NEW TRACK

0:05
0:47
1:32
```

Database:

```text
source_timestamps

37
72
136
```

en:

```text
sampled_timestamps

5
47
92
```

---

# 10. Preferred timestamp

Alle timestamps bewaren is goed.

Maar voor een quiz willen we uiteindelijk één ideaal fragment.

Daarom:

```text
all timestamps
      ↓
preferred timestamp
```

Bijvoorbeeld:

```text
source timestamps:

[6, 8, 13, 17, 70]

preferred:
70
```

Waarom?

Misschien is op `0:06` maar een halve seconde van de sample hoorbaar terwijl hij op `1:10` veel duidelijker is.

Dit kunnen we handmatig kiezen via de admin.

---

# 11. Timestamp database

Ik zou timestamps zelfs in een aparte tabel opslaan.

```text
sample_timestamps

id
sample_relation_id

track_role
timestamp_ms

is_preferred
confidence

created_at
```

`track_role`:

```text
SOURCE
SAMPLED
```

Voorbeeld:

```text
relation 123

SOURCE    6000
SOURCE    8000
SOURCE   13000
SOURCE   17000
SOURCE   70000
```

Preferred:

```text
SOURCE   70000    preferred=true
```

---

# 12. Tracks

```text
tracks

id

title
artist_name
album_name
release_year

musicbrainz_id
spotify_id
apple_music_id

artwork_url

created_at
updated_at
```

We moeten tracks dedupliceren.

Niet:

```text
Kanye West - Stronger
Kanye West - Stronger
Kanye West - Stronger
```

maar één track-record waar meerdere relaties naar verwijzen.

---

# 13. Sample relations

```text
sample_relations

id

source_track_id
sampled_track_id

sample_type
sample_element

whosampled_url
whosampled_relation_id

verified

difficulty

created_at
updated_at
```

Bijvoorbeeld:

```text
SOURCE
Daft Punk — Harder Better Faster Stronger

SAMPLED IN
Kanye West — Stronger
```

---

# 14. Scraper architecture

Ik zou de scraper opdelen in kleine modules.

```text
workers/whosampled/

client.ts
track-parser.ts
relation-parser.ts
timestamp-parser.ts
normalizer.ts
importer.ts
queue.ts
```

### client

Haalt pagina's op.

### track-parser

Vindt sample-relaties van een track.

### relation-parser

Leest een individuele sample relationship.

### timestamp-parser

Zet:

```text
Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10
```

om naar:

```text
6
8
13
17
70
```

### normalizer

Maakt artiesten, tracks en metadata consistent.

### importer

Slaat alles in PostgreSQL op.

---

# 15. Scraper queue

Niet 10.000 requests tegelijk sturen.

Worker krijgt jobs:

```text
SCRAPE_TRACK
SCRAPE_RELATION
REFRESH_RELATION
```

Bijvoorbeeld:

```text
queue
 ↓
relation 1
 ↓
relation 2
 ↓
relation 3
```

Met throttling tussen requests.

---

# 16. Scraper resilience

Omdat we HTML scrapen kunnen selectors ooit veranderen.

Daarom moet de scraper falen met duidelijke errors.

Bijvoorbeeld:

```text
RELATION_PARSE_FAILED
TIMESTAMP_NOT_FOUND
TRACK_NAME_NOT_FOUND
PAGE_STRUCTURE_CHANGED
```

Niet stilletjes verkeerde data opslaan.

---

# 17. Raw scraping bewaren

Ik zou zelfs deels bewaren wat we oorspronkelijk hebben gevonden.

Bijvoorbeeld:

```text
raw_timestamp_text

"Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10"
```

Dan kunnen we later bugs in onze parser herstellen zonder opnieuw alles te moeten ontdekken.

---

# 18. Admin

Admin wordt belangrijk.

Niet publiek.

Daar kunnen wij relaties controleren.

```text
RELATION #348

SOURCE

Daft Punk
Harder Better Faster Stronger
2001

timestamps:

○ 0:06
○ 0:08
○ 0:13
○ 0:17
● 1:10     preferred


SAMPLED IN

Kanye West
Stronger
2007

timestamps:

● 0:27
○ 1:03


Sample type:

Direct Sample


[ PLAY SOURCE ]

[ PLAY TARGET ]

[ VERIFY ]

[ DISABLE ]
```

---

# 19. Question engine

De game speelt niet rechtstreeks `sample_relations`.

Er zit een question engine tussen.

Bijvoorbeeld:

```text
sample relation
      ↓
question builder
      ↓
correct answer
      ↓
3 decoys
      ↓
question
```

---

# 20. Vraag

Een gegenereerde vraag:

```json
{
  "mode": "GUESS_SAMPLED_TRACK",

  "sourceTrackId": 15,

  "correctTrackId": 224,

  "answers": [
    224,
    182,
    411,
    91
  ],

  "audioTimestamp": 70000
}
```

---

# 21. Gamemodes

De architectuur moet verschillende modes ondersteunen.

Maar MVP hoeft ze nog niet allemaal te tonen.

Enums:

```text
GUESS_SAMPLED_TRACK

GUESS_SOURCE_TRACK

SAMPLE_OR_NOT

GUESS_ARTIST
```

Later:

```text
SAME_SAMPLE

YEAR

FINAL_ROUND
```

---

# 22. Singleplayer game flow

Singleplayer:

```text
player
 ↓
POST /games/singleplayer
 ↓
server generates game
 ↓
round 1
 ↓
answer
 ↓
score
 ↓
round 2
 ↓
...
 ↓
final score
```

Singleplayer gebruikt dus óók de server.

Niet alles lokaal in JavaScript.

Voordelen:

* dezelfde scoring
* dezelfde questions
* moeilijker valsspelen
* analytics
* één game-engine

---

# 23. Multiplayer game flow

```text
Host
 ↓
Create room
 ↓
K7XM
 ↓
players join
 ↓
ready
 ↓
start
 ↓
server generates match
 ↓
round
 ↓
everyone answers
 ↓
reveal
 ↓
scoreboard
```

---

# 24. Game-core

De belangrijkste code hoort niet in React of Socket.IO.

We maken:

```text
packages/game-core
```

Daarin:

```text
Game
Round
Question
ScoreCalculator
QuestionGenerator
DifficultySelector
```

Singleplayer:

```text
API
 ↓
game-core
```

Multiplayer:

```text
Socket.IO
 ↓
game-core
```

Daardoor dupliceren we niets.

---

# 25. Game state

Bijvoorbeeld:

```text
CREATED

WAITING

INTRO

PLAYING_AUDIO

ANSWERING

LOCKED

REVEAL

SCOREBOARD

FINISHED
```

De server bepaalt de state.

---

# 26. Multiplayer realtime

Socket.IO events:

Client → server:

```text
room:create

room:join

player:ready

game:start

answer:submit
```

Server → client:

```text
room:state

player:joined

player:left

game:started

round:started

round:locked

round:reveal

score:update

game:finished
```

---

# 27. Server authoritative

Browser zegt:

```text
I selected answer B
```

Server beslist:

```text
correct?
response time?
points?
streak?
```

Browser mag nooit sturen:

```text
I earned 1000 points
```

---

# 28. PostgreSQL

Hoofddata:

```text
tracks

sample_relations

sample_timestamps

questions

question_stats

singleplayer_games

multiplayer_games

rooms

players

rounds

answers
```

---

# 29. Redis

Redis hoeft niet absoluut vanaf dag één gebruikt te worden.

Maar omdat we toch Docker gebruiken kunnen we het gewoon meenemen.

Gebruik:

```text
room state

active games

sessions

WebSocket presence

rate limiting

queues
```

Later ook:

```text
Socket.IO pub/sub
```

wanneer meerdere game servers draaien.

---

# 30. Audio

Dit blijft een aparte laag.

Belangrijk:

WhoSampled geeft ons:

```text
track
artist
relation
timestamp
```

Maar niet automatisch de audio die SampleCheck mag afspelen.

Daarom:

```text
WhoSampled
     ↓
sample metadata
     ↓
SampleCheck DB


Audio provider
     ↓
play track
     ↓
seek to timestamp
```

De game-engine mag niet weten waar de audio vandaan komt.

---

# 31. AudioProvider

```text
packages/audio
```

Interface:

```ts
interface AudioProvider {
    resolveTrack(trackId: string): Promise<AudioTrack>;
    preparePlayback(
        trackId: string,
        timestampMs: number
    ): Promise<PlaybackData>;
}
```

Implementaties kunnen later zijn:

```text
DevelopmentAudioProvider

AppleMusicAudioProvider

OtherProvider
```

We kunnen dus van provider wisselen zonder de game te herschrijven.

---

# 32. Development audio

Tijdens development kunnen we simpelweg testbestanden gebruiken.

Bijvoorbeeld:

```text
dev-audio/
track-1.mp3
track-2.mp3
```

Daarmee kunnen we alle gameplay ontwikkelen terwijl de definitieve playbackoplossing nog onderzocht wordt.

---

# 33. Docker development flow

Nieuwe developer:

```bash
git clone ...
cd samplecheck
docker compose up
```

Docker start:

```text
PostgreSQL
Redis
API
frontend
worker
admin
```

Daarna:

```text
http://localhost:3000
```

SampleCheck draait.

---

# 34. Database persistent maken

Docker Postgres krijgt een volume:

```text
postgres-data
```

Dus:

```text
docker compose down
```

wist niet automatisch onze hele database.

Alle geïmporteerde sampledata blijft bestaan.

---

# 35. Scraper apart draaien

De scraper draait niet continu.

We kunnen bijvoorbeeld doen:

```bash
docker compose run worker \
  scrape-track "Kanye West - Stronger"
```

of:

```bash
docker compose run worker import-popular
```

Later:

```bash
docker compose run worker refresh
```

---

# 36. Development commands

Idealiter:

```bash
pnpm dev
```

of Docker:

```bash
docker compose up
```

Scraper:

```bash
pnpm scrape
```

Migrations:

```bash
pnpm db:migrate
```

Seed:

```bash
pnpm db:seed
```

Tests:

```bash
pnpm test
```

---

# 37. Tests

Vooral timestamp parsing moeten we goed testen.

Input:

```text
Sample appears at 0:06
```

Output:

```text
[6]
```

Input:

```text
Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10
```

Output:

```text
[6, 8, 13, 17, 70]
```

Input:

```text
Sample appears throughout
```

Output:

```text
throughout = true
```

Input:

```text
Sample appears at 1:03:24
```

Parser moet ook dat formaat kunnen verwerken indien het voorkomt.

---

# 38. Scraper integration tests

We bewaren eventueel enkele HTML fixtures.

```text
tests/fixtures/

relation-single-timestamp.html

relation-multiple-timestamps.html

relation-throughout.html
```

Tests draaien dan tegen die bestanden.

Zo hoeven tests niet voortdurend WhoSampled zelf te bezoeken.

---

# 39. Content lifecycle

Iedere sample relation krijgt een status:

```text
IMPORTED

REVIEW_NEEDED

VERIFIED

PUBLISHED

DISABLED
```

Game gebruikt alleen:

```text
PUBLISHED
```

Dus slechte scrape-data kan nooit per ongeluk in een echte ronde komen.

---

# 40. Difficulty

Eerst handmatig:

```text
EASY
MEDIUM
HARD
```

Later op basis van data:

```text
correct rate
average response time
times played
```

Bijvoorbeeld:

```text
85% correct
→ EASY

48%
→ MEDIUM

16%
→ HARD
```

---

# 41. Question stats

```text
question_stats

question_id

times_played
times_correct

average_response_time

singleplayer_plays
multiplayer_plays
```

Dat helpt ons slechte vragen vinden.

---

# 42. Zonder accounts beginnen

Singleplayer:

```text
anonymous session
```

Multiplayer:

```text
nickname
room token
```

Geen login.

Later kunnen we toevoegen:

```text
account

stats

history

achievements
```

zonder de basisarchitectuur te veranderen.

---

# 43. MVP

Voor de eerste echte versie:

## Singleplayer

```text
Play
10 rounds
score
play again
```

## Multiplayer

```text
create room

join room

2–8 players

ready

start

10 rounds

leaderboard
```

## Game

```text
1 gamemode

4 answers

audio

timer

score

reveal
```

## Content

```text
100–300 verified sample relations
```

---

# 44. Wat nog niet in MVP hoeft

```text
accounts

ranked

matchmaking

achievements

custom avatars

friends

daily challenge

community questions

public profiles
```

---

# 45. Docker production

Lokaal gebruiken we Docker Compose.

Productie hoeft niet per se één grote Compose-machine te zijn.

Bijvoorbeeld:

```text
Frontend
    ↓
Vercel

API Docker container
    ↓
Railway / Fly.io / Render

Worker Docker container
    ↓
Railway / Fly.io / Render

PostgreSQL
    ↓
managed database

Redis
    ↓
managed Redis
```

Het voordeel van onze Dockerfiles:

dezelfde API-container die lokaal draait kan ook productie draaien.

---

# 46. Volledige dataflow

```text
                     WHOSAMPLED

                         │
                         ▼
              ┌────────────────────┐
              │  SCRAPER WORKER    │
              │                    │
              │ track discovery    │
              │ relation parser    │
              │ timestamp parser   │
              └─────────┬──────────┘
                        │
                        ▼
              ┌────────────────────┐
              │    NORMALIZER      │
              │                    │
              │ titles             │
              │ artists            │
              │ timestamps         │
              │ deduplication      │
              └─────────┬──────────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ PostgreSQL   │
                 │              │
                 │ tracks       │
                 │ relations    │
                 │ timestamps   │
                 └──────▲───────┘
                        │
                        │
                ┌───────┴─────────┐
                │      ADMIN      │
                │                 │
                │ verify          │
                │ timestamp       │
                │ difficulty      │
                │ publish         │
                └───────┬─────────┘
                        │
                        ▼
                PUBLISHED CONTENT
                        │
                        ▼
                ┌───────────────┐
                │ QUESTION      │
                │ ENGINE        │
                └───────┬───────┘
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼

       SINGLEPLAYER          MULTIPLAYER
             │                     │
             └──────────┬──────────┘
                        │
                        ▼
                  GAME ENGINE
                        │
                        ▼
                  AUDIO PROVIDER
```

---

# 47. Mijn concrete stack

Ik zou voorlopig vastleggen:

```text
Frontend
Next.js
React
TypeScript
Tailwind

Backend
Node.js
Fastify
TypeScript

Realtime
Socket.IO

Database
PostgreSQL

ORM
Prisma of Drizzle

Cache / realtime state
Redis

Scraping
Node.js
Cheerio

Repository
pnpm monorepo

Development
Docker
Docker Compose

Testing
Vitest
```

Voor scraping lijkt **Cheerio** logisch omdat de WhoSampled-API-repo ook vanuit HTML parsing vertrekt en we geen volledige browser nodig hebben zolang de relevante data server-side in de HTML staat.

Pas wanneer dat niet zo blijkt te zijn zouden we Playwright gebruiken.

---

# 48. Belangrijkste architectuurregels

### 1

**Scraping en gameplay zijn volledig gescheiden.**

### 2

**WhoSampled wordt nooit live aangeroepen tijdens een spel.**

### 3

**Alle timestamps worden opgeslagen.**

### 4

Daarnaast bestaat een:

```text
preferred_timestamp
```

voor de daadwerkelijke quiz.

### 5

**Singleplayer en multiplayer gebruiken dezelfde game-core.**

### 6

**De server berekent score en timing.**

### 7

**Audio zit achter een provider-interface.**

### 8

**Alleen geverifieerde sample-relaties worden speelbaar.**

### 9

**Docker is de standaard lokale ontwikkelomgeving.**

### 10

De belangrijkste eigen data van SampleCheck wordt uiteindelijk:

```text
sample relation

all timestamps

preferred timestamp

difficulty

question quality

player statistics
```

---

# 49. Startpunt

Ik zou het project nu in deze volgorde bouwen:

```text
1. Docker Compose

2. PostgreSQL

3. database schema

4. WhoSampled scraper prototype

5. timestamp parser

6. import 20 sample relations

7. admin / verification

8. singleplayer prototype

9. audio abstraction

10. multiplayer rooms + Socket.IO

11. scoring + leaderboard

12. 100–300 vragen importeren

13. private testing
```

De reden dat ik de scraper relatief vroeg zou bouwen is simpel: **we willen eerst bewijzen dat we betrouwbaar de data kunnen verzamelen die de game nodig heeft**.

Als we bijvoorbeeld:

```text
track A
track B
all timestamps
sample type
```

stabiel uit WhoSampled kunnen halen en in PostgreSQL krijgen, dan is één van de grootste onzekerheden van SampleCheck al opgelost.
