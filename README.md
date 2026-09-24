# SampleCheck

Browsergame waarin spelers muziek-samples herkennen. Singleplayer en multiplayer
gaan dezelfde servergestuurde game-engine en vragenbank gebruiken.

We bouwen dit project stap voor stap volgens [architectuur v0.2](docs/architecture-v0.2.md).
De lokale infrastructuur en de pnpm-monorepo met het eerste databaseschema staan er.
Frontend, API, worker en admin volgen later; er draait nog geen game op poort 3000.

## Lokaal starten

Vereist: Docker Desktop met Linux-containers en Docker Compose v2.
Start Docker Desktop en voer vanuit deze map uit:

```sh
docker compose up -d --wait
docker compose ps
```

Beide services moeten `healthy` worden. `docker compose up` kan ook, om logs direct
te volgen. De eerste start downloadt de images.

| Service | Adres op je computer | Adres voor toekomstige containers |
| --- | --- | --- |
| PostgreSQL | localhost:5432 | postgres:5432 |
| Redis | localhost:6379 | redis:6379 |

PostgreSQL gebruikt standaard database `samplecheck`, gebruiker `samplecheck` en
lokaal ontwikkelwachtwoord `samplecheck_dev`. De poorten zijn alleen op localhost
bereikbaar. Deze Compose-configuratie is bedoeld voor lokale ontwikkeling.

Optioneel: kopieer `.env.example` naar `.env` en pas waarden aan. Als een poort
bezet is, wijzig dan `POSTGRES_PORT` of `REDIS_PORT`. Databasecredentials worden
bij de eerste initialisatie van het volume ingesteld; een latere wijziging in
`.env` verandert het bestaande databasewachtwoord niet.

## Controleren en stoppen

```sh
docker compose exec postgres psql -U samplecheck -d samplecheck -c 'SELECT current_database();'
docker compose exec redis redis-cli ping
docker compose logs --tail=50
docker compose down
```

Redis hoort `PONG` terug te geven. PostgreSQL hoort de databasenaam terug te geven.
Pas bij aangepaste credentials ook de gebruiker en database in dit commando aan.
`docker compose down` bewaart de named volumes `postgres-data` en `redis-data`.
PostgreSQL-data en Redis AOF-data blijven daardoor bestaan als containers worden
vervangen. `docker compose down --volumes` verwijdert deze data wel.

Voor PostgreSQL 18 is het volume gekoppeld aan `/var/lib/postgresql`, volgens de
[officiële Docker-handleiding](https://docs.docker.com/guides/postgresql/).
Redis gebruikt de [officiële image](https://hub.docker.com/_/redis) met AOF-opslag.
De images volgen een vaste major-versie; exacte releasepinnen volgen bij een
reproduceerbare applicatiebuild.

## Bouwvolgorde

1. Docker Compose, PostgreSQL en Redis (afgerond).
2. pnpm-monorepo en databaseschema met migrations (afgerond).
3. WhoSampled-prototype, geteste timestamp-parser en browserroute (afgerond; direct HTTP geeft nog 403).
4. Eerste 20 relaties importeren en admin-verificatie.
5. Singleplayer met gedeelde game-core en audio-provider.
6. Multiplayer-rooms, Socket.IO, scoring en leaderboard.
7. Content uitbreiden en private tests.

Scraping blijft gescheiden van gameplay. Alle timestamps worden bewaard,
naast een voorkeursfragment. Alleen gepubliceerde, geverifieerde relaties worden
speelbaar. Timing en scores worden door de server bepaald.

## Monorepo en database

Vereist voor de Node-tooling: Node.js 22.19+ (22 LTS) of 24 LTS en pnpm 10.34.5.
Zonder globale pnpm-installatie kun je elk `pnpm`-commando hieronder uitvoeren
als `npx --yes pnpm@10.34.5 ...`. Gebruik in Windows PowerShell `npx.cmd` wanneer
de execution policy de `.ps1`-wrapper blokkeert.

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait
pnpm db:migrate
pnpm db:seed
pnpm typecheck
pnpm test
```

`db:migrate` voert alleen nog niet toegepaste SQL-migrations uit. `db:seed` voegt
herhaalbaar twee fictieve tracks, een relatie en zeven timestamps toe. Die relatie
blijft `IMPORTED`; de seed publiceert niets en overschrijft geen bestaande reviews.

De databasetests gebruiken echte PostgreSQL-transacties die na iedere test worden
teruggedraaid. Ze vereisen een draaiende, gemigreerde database. Gebruik eventueel
`TEST_DATABASE_URL` voor een aparte testdatabase en migreer die eerst met
`DATABASE_URL` ingesteld op hetzelfde adres.

| Onderdeel | Verantwoordelijkheid |
| --- | --- |
| `packages/shared` | Gedeelde contentstatussen, moeilijkheidsniveaus en trackrollen |
| `packages/database` | Drizzle-schema, verbinding, SQL-migrations, seed en integratietests |
| `workers/whosampled` | Scraperprototype, HTML-parsers, timestamp-parser en offline tests |
| `apps/*` | Workspace-pad voor de volgende bouwstappen |

Interne packages exporteren voorlopig TypeScript-broncode voor `tsx` en toekomstige
app-bundlers. Er is nog geen productiebuild of `pnpm dev`; die volgen met de apps.

Na een schemawijziging: `pnpm db:generate`, controleer de gegenereerde SQL en voer
`pnpm db:migrate` uit. Commit de SQL en bijbehorende Drizzle-metadata samen.
Details en ontwerpkeuzes staan in [docs/database.md](docs/database.md).

## Scraperprototype proberen

Dit werkt lokaal, zonder database of internet:

```powershell
npx.cmd --yes pnpm@10.34.5 scrape timestamps "Sample appears at 0:06 and 1:10"
npx.cmd --yes pnpm@10.34.5 scrape relation "https://www.whosampled.com/sample/900001/Fixture-Producer-Remixed-Loop-Fixture-Band-Original-Loop/" --html workers/whosampled/tests/fixtures/relation-multiple.html
npx.cmd --yes pnpm@10.34.5 test:scraper
```

Live via de browserroute (opent een zichtbare browser met een apart profiel;
kan `ACCESS_BLOCKED` geven):

```powershell
npx.cmd --yes pnpm@10.34.5 scrape track "https://www.whosampled.com/Kanye-West/Stronger/" --browser --out .local/whosampled/stronger-live.json
npx.cmd --yes pnpm@10.34.5 scrape relation "https://www.whosampled.com/sample/12/Kanye-West-Stronger-Daft-Punk-Harder,-Better,-Faster,-Stronger/" --browser --out .local/whosampled/stronger-relation-live.json
```

Het prototype geeft JSON terug en importeert nog niets. De parsers zijn getest
met historische HTML en fictieve fixtures. Eenvoudige live WhoSampled-aanvragen
zonder JavaScript geven in deze omgeving een Cloudflare-blokkade (HTTP 403);
de browserroute heeft op 23 september 2026 de track- en relatiepagina van
Kanye West – Stronger wél opgehaald en netjes afgesloten. Werking,
beperkingen en overige commando's staan in
[docs/scraper.md](docs/scraper.md).
