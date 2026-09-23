# SampleCheck

Browsergame waarin spelers muziek-samples herkennen. Singleplayer en multiplayer
gaan dezelfde servergestuurde game-engine en vragenbank gebruiken.

We bouwen dit project stap voor stap volgens [architectuur v0.2](docs/architecture-v0.2.md).
De huidige stap legt de lokale infrastructuur aan: PostgreSQL en Redis.
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

1. Docker Compose, PostgreSQL en Redis (huidige stap).
2. pnpm-monorepo en databaseschema met migrations.
3. WhoSampled-prototype en geteste timestamp-parser.
4. Eerste 20 relaties importeren en admin-verificatie.
5. Singleplayer met gedeelde game-core en audio-provider.
6. Multiplayer-rooms, Socket.IO, scoring en leaderboard.
7. Content uitbreiden en private tests.

Scraping blijft gescheiden van gameplay. Alle timestamps worden bewaard,
naast een voorkeursfragment. Alleen gepubliceerde, geverifieerde relaties worden
speelbaar. Timing en scores worden door de server bepaald.
