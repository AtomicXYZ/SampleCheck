# Rapport — WhoSampled-scraper en browserroute

**Datum:** 23 september 2026
**Status:** Afgerond en geverifieerd

## Samenvatting

De WhoSampled-scraperprototype had al HTML-parsers, een timestamp-parser en
JSON-uitvoer. Het openstaande punt was de **live toegang** tot WhoSampled:
eenvoudige HTTP-aanvragen (zonder JavaScript) kregen in deze omgeving een
Cloudflare-blokkade (HTTP 403). Dit rapport dekt de afwerking en verificatie
van de **browserroute** die JavaScript kan uitvoeren, plus de testdekking
daaromheen.

Tijdens deze sessie zijn geen gameplay-, frontend- of databasefuncties
aangeraakt. De scraper blijft gescheiden van gameplay en schrijft nog niets
naar de database.

## Wat is er gebeurd

1. **Browser-client timing configureerbaar gemaakt.** `BrowserWhoSampledClient`
   accepteerde vaste waarden voor het interval tussen ophalingen en de tijd die
   het wacht op het oplossen van een challenge. Die zijn nu instelbaar via
   `intervalMs` en `blockedWaitMs` (standaard 2000 ms resp. 45000 ms). Onzinnige
   waarden geven `INVALID_ARGUMENT`. Dit maakt het gedrag betrouwbaar testbaar
   zonder de productie-standaardwaarden te veranderen.

2. **Lock-race gefixt bij afsluiting.** `close()` verwijderde de profiel-lock
   zonder te controleren of die wel van dit proces was. Nu wordt alleen een
   eigen lock verwijderd; een lock van een ander proces blijft op zijn plek.

3. **Testdekking toegevoegd voor de browserroute.**
   - `browser-client.test.ts` (geen echte browser): ongeldige timing-config,
     `BROWSER_UNAVAILABLE` bij ontbrekend browserbestand, `BROWSER_BUSY` bij een
     door een ander vastgehouden profiel-lock.
   - `browser-client.mocked.test.ts` (geïsoleerde mock, geen netwerk): challenge
     herstelt naar een echte 200-pagina; permanente blokkade geeft
     `ACCESS_BLOCKED` en stopt de client; HTTP 429 geeft `RATE_LIMITED`; een
     onverwachte redirect geeft `REDIRECT_REJECTED`.
   - `cli.test.ts`: `--browser` samen met `--html` wordt verworpen, en
     `--browser-executable` zonder `--browser` wordt verworpen, beide vóórdat er
     een browser start.

4. **Live browserroute geverifieerd** in deze omgeving (zie hieronder).

5. **Documentatie bijgewerkt** (`docs/scraper.md` en `README.md`): de
   onderscheiding tussen de directe-HTTP-route en de browserroute, hoe de
   browserroute werkt, welke opties er zijn, en welke foutcodes er kunnen
   voorkomen.

## Bewezen live resultaat

Twee ophalingen via de browserroute (zichtbare Edge, apart profiel in
`.local/whosampled-browser`), beide geslaagd en netjes afgesloten:

| Ophaling | Resultaat | Bewaard als |
| --- | --- | --- |
| Track `Kanye-West/Stronger/` | 4 relatie-URL's | `.local/whosampled/stronger-live.html` / `.json` |
| Relatie `sample/12` (Stronger → Daft Punk – Harder, Better, Faster, Stronger) | Volledige JSON; timestamps `2:01` (bron) en `0:00 (and throughout)` (doel) | `.local/whosampled/stronger-relation-live.html` / `.json` |

De relatie met **Kanye West – Stronger → Daft Punk – Harder, Better, Faster,
Stronger** werd dus succesvol live uitgelezen met timestamps aan beide kanten.

**Clean exit per run:** geen achtergebleven browserproces en een vrijgegeven
profiel-lock (`samplecheck.lock` afwezig na afloop).

## Beperkingen en eerlijkheid van de conclusie

- De **directe HTTP-route** (`client.ts`, zonder JavaScript) geeft in deze
  omgeving nog steeds HTTP 403. Die route wordt voor live data dus nog niet
  gebruikt.
- Elke live run kan opnieuw een challenge tegenkomen of geblokkeerd blijven;
  dan geeft de CLI `ACCESS_BLOCKED`. Het hierboven getoonde resultaat is bewijs
  dat de route op 23 september 2026 werkte, niet een garantie voor alle
  toekomstige runs.
- Een geslaagde unit- of fixturetest bewijst geen live compatibiliteit; die
  dekt gedrag (challenge, statuscodes, redirects, locks), niet de actuele
  HTML-structuur.
- De opgehaalde HTML en JSON liggen in `.local/`, dat buiten de git-versie
  wordt bewaard (zie `.gitignore`).

## Verificatie

- `pnpm test:scraper` → **91 tests** (6 bestanden) geslaagd.
- Volledige `pnpm test` met draaiende PostgreSQL/Redis → **102 tests**
  geslaagd (11 databasetests + 91 scraper-tests).
- `pnpm typecheck` (`tsc --noEmit`) → zonder fouten.

## Aangeraakte bestanden

| Bestand | Type |
| --- | --- |
| `workers/whosampled/src/browser-client.ts` | Gewijzigd (timing opties, lock-fix) |
| `workers/whosampled/tests/browser-client.test.ts` | Nieuw |
| `workers/whosampled/tests/browser-client.mocked.test.ts` | Nieuw |
| `workers/whosampled/tests/cli.test.ts` | Gewijzigd (2 browser-validatietests) |
| `README.md` | Gewijzigd (bouwvolgorde + scrapersectie) |
| `docs/scraper.md` | Gewijzigd (teststatus, browserroute, foutcodes) |
| `.local/whosampled/stronger-live.{html,json}` | Live artifact (niet in git) |
| `.local/whosampled/stronger-relation-live.{html,json}` | Live artifact (niet in git) |

## Volgende stap

De actuele relatiepagina is geverifieerd en bewaard. De volgende bouwstap kan
daarmee doorgaan: **de eerste 20 relaties importeren** met normalisatie en
deduplicatie tegen PostgreSQL, importtransacties en een reviewflow. Wanneer
batches gaan worden geïmporteerd volgen een Redis-jobqueue, volledige
paginering en een worker-container. Audio valt buiten de scraper.
