# WhoSampled-prototype

De worker in `workers/whosampled` leest een trackpagina of relatiepagina en geeft
JSON-metadata terug. Hij staat los van gameplay en schrijft nog niet naar de
database. Importeren en de eerste 20 relaties horen bij de volgende stap.

## Wat is daadwerkelijk getest?

Twee routes zijn beschikbaar:

1. **Directe HTTP-aanvragen** (`client.ts`). Een eenvoudige `fetch` zonder
   JavaScript krijgt op 23 september 2026 in deze omgeving HTTP 403 met een
   Cloudflare-blokkade; ook robots.txt gaf een challengepagina. Deze route wordt
   dus nog niet gebruikt voor live data en kan `ACCESS_BLOCKED` geven.
2. **Browserroute** (`--browser`, `browser-client.ts`). Een zichtbare
   Edge/Chrome-sessie met een apart SampleCheck-profiel (standaard
   `.local/whosampled-browser`) voert JavaScript uit en wacht tot een
   eventuele challenge is afgehandeld, zonder een CAPTCHA te beantwoorden.
   Op 23 september 2026 laaide deze route in deze omgeving de trackpagina
   `https://www.whosampled.com/Kanye-West/Stronger/` (4 relatie-URL's) en de
   relatiepagina voor sample 12 (Kanye West – Stronger naar Daft Punk –
   Harder, Better, Faster, Stronger, met timestamps `2:01` aan de bronkant en
   `0:00 (and throughout)` aan de doorkant). De HTML is bewaard in
   `.local/whosampled/stronger-live.html` en
   `.local/whosampled/stronger-relation-live.html`; de JSON-uitvoer in
   `.local/whosampled/stronger-live.json` en
   `.local/whosampled/stronger-relation-live.json`. Beide runs sloten netjes
   af: geen achtergebleven browserproces en een vrijgegeven profiel-lock.
   Elke live run kan echter opnieuw een challenge tegenkomen of geblokkeerd
   blijven; dat geeft `ACCESS_BLOCKED`.

De relatieparser is daarnaast getest met een verkleinde **historische echte
HTML-fixture** uit
[sample-detection](https://github.com/denisakkavim/sample-detection/blob/bb9aaf5638ef9c34655ddb03d3e818551a58679d/tests/test_files/whosampled_html/sample.html)
en met zelfgemaakte fixtures voor randgevallen. Die historische pagina gaat
over sample 729975: Dua Lipa / Love Again en Lew Stone & the Monseigneur Band
feat. Al Bowlly / My Woman. Unit-tests dekken de browserroute met een
geïsoleerde mock: challenge-herstel naar 200, permanente blokkade
(`ACCESS_BLOCKED`), `429` (`RATE_LIMITED`) en een onverwachte redirect
(`REDIRECT_REJECTED`). Een geslaagde test bewijst geen live compatibiliteit.

De [opgegeven voorbeeldrepo](https://github.com/rikaa15/WhoSampled-API/blob/master/index.js)
gebruikt Cheerio voor tracklijsten. De historische rolmarkeringen en
`data-timings` zijn ook zichtbaar in
[deze scraperimplementatie](https://github.com/denisakkavim/sample-detection/blob/bb9aaf5638ef9c34655ddb03d3e818551a58679d/sample_detection/scrape/whosampled.py).
Onze implementatie gebruikt rolmarkeringen in plaats van de volgorde van de tracks.

## Zelf uitvoeren

Voer de commando's uit vanuit de repositoryroot, na `pnpm install --frozen-lockfile`.
Zonder globale pnpm-installatie: vervang `pnpm` door `npx.cmd --yes pnpm@10.34.5`
in Windows PowerShell. De offline commando's hebben geen database of netwerk nodig.

```sh
pnpm scrape timestamps "Sample appears at 0:06, 0:08, 0:13, 0:17 and 1:10"
pnpm scrape timestamps "Sample appears throughout"
pnpm scrape timestamps "Sample appears at 1:03:24"
pnpm scrape relation "https://www.whosampled.com/sample/900001/Fixture-Producer-Remixed-Loop-Fixture-Band-Original-Loop/" --html workers/whosampled/tests/fixtures/relation-multiple.html
pnpm scrape track "https://www.whosampled.com/Fixture-Producer/Remixed-Loop/" --html workers/whosampled/tests/fixtures/track.html
pnpm test:scraper
```

Voor een live poging (kan dus `ACCESS_BLOCKED` geven):

```sh
# Directe aanvraag; in deze omgeving geeft dit momenteel HTTP 403.
pnpm scrape track "https://www.whosampled.com/Kanye-West/Stronger/"

# Browserroute; opent een zichtbare browser met een apart profiel.
pnpm scrape track "https://www.whosampled.com/Kanye-West/Stronger/" --browser
pnpm scrape relation "https://www.whosampled.com/sample/12/Kanye-West-Stronger-Daft-Punk-Harder,-Better,-Faster,-Stronger/" --browser --out .local/whosampled/stronger-relation-live.json
```

### Browserroute

`--browser` start een zichtbare Edge/Chrome met een apart projectprofiel in
`.local/whosampled-browser`. Er worden geen persoonlijke profielen gebruikt en
geen cookies, wachtwoorden of vingerafdrukken overgenomen of gewijzigd. Het
commando wacht tot een eventuele challenge is afgehandeld (standaard maximaal
45 seconden) zonder zelf op een CAPTCHA te klikken.

Opties:

- `--browser-executable <pad>` kiest een specifieke geïnstalleerde
  Chromium-browser; zonder deze optie zoekt de CLI Edge en Chrome op de
  gebruikelijke Windows-, macOS- en Linux-locaties.
- `--save-html <pad>` bewaart de opgehaalde HTML; het bestand mag niet bestaan.
- Een openstaand tweede proces dat hetzelfde profiel gebruikt krijgt
  `BROWSER_BUSY`; een afsluitend proces verwijdert alleen zijn eigen lock.

Per CLI-opdracht wordt één pagina opgehaald. Er is geen automatische
paginering, er wordt niet geretried en er worden geen databases of audio
bestanden aangeraakt.

`track` geeft unieke `/sample/`-links van **alleen de opgehaalde pagina** terug.
Covers, remixes en aanbevelingen buiten de tracklijst worden genegeerd. Bij
paginering is `hasPagination` waar; het prototype volgt nog geen volgende pagina's
en haalt niet automatisch alle gevonden relaties op.

Gebruik `relation <url>` voor een afzonderlijke relatie. Met `--html <pad>` wordt
een lokaal UTF-8-bestand gelezen. Met `--out <pad>` wordt JSON opgeslagen; de
bovenliggende map moet bestaan en een bestaand bestand wordt niet overschreven.
Zonder `--out` schrijft de CLI JSON naar stdout. pnpm zelf kan scriptheaders tonen.
Fouten gaan als JSON naar stderr met exitcode 1.

## Timestampgedrag

| Tekst | `timestampsMs` | `throughout` |
| --- | --- | --- |
| `0:06` | `[6000]` | false |
| `0:06, 0:08 and 1:10` | `[6000, 8000, 70000]` | false |
| `1:03:24` | `[3804000]` | false |
| `Sample appears throughout` | `[]` | true |
| `0:31 (and throughout)` | `[31000]` | true |

De parser ondersteunt minuten/seconden, uren/minuten/seconden en maximaal drie
decimalen voor fracties van seconden. Spaties, nieuwe regels en non-breaking
spaces worden voor parsing genormaliseerd. Het oorspronkelijke tekstveld blijft
ongewijzigd in `rawText`. Dubbele tijden worden verwijderd en de lijst wordt
oplopend gesorteerd. Nul is een geldig expliciet tijdstip.

Bereiken zoals `0:06-0:10`, onbekende woorden, ontbrekende of gedeeltelijk kapotte
lijsten worden geweigerd. Er wordt niets stilzwijgend weggegooid. Alle tijden passen
in het bestaande PostgreSQL-integerveld. `data-timings` bevat seconden en wordt
omgezet naar milliseconden; verschil met de zichtbare tekst geeft
`TIMESTAMP_CONFLICT`. `throughout` leidt nooit automatisch tot een verzonnen nul.

## Output en grenzen

Relaties bevatten brontrack, gesamplede track, artiesten, optioneel album/jaar,
type, element, WhoSampled-ID/URL en timestamps met ruwe tekst voor beide kanten.
Ontbrekende verplichte velden geven een fout. De outputstatus is `IMPORTED`.
Voorkeurstimestamps, moeilijkheid en verificatie worden niet automatisch gekozen.

`client.ts` begrenst responses op 2 MB, gebruikt een timeout van 15 seconden en
serialiseert requests met minimaal 2 seconden tussen startmomenten per client.
Deze limiet geldt niet over meerdere CLI-processen heen. Er zijn geen automatische
retries. HTTP 401/403, 429 en herkende challengepagina's stoppen ook nog wachtende
requests van dezelfde client. `Retry-After` wordt bij 429 teruggegeven.
Redirects worden niet gevolgd; geef de uiteindelijke HTTPS-URL op. Alleen het
WhoSampled-domein is toegestaan. Er is geen bypass van de blokkade ingebouwd.

Belangrijke foutcodes: `ACCESS_BLOCKED`, `RATE_LIMITED`, `REQUEST_TIMEOUT`,
`PAGE_STRUCTURE_CHANGED`, `RELATION_PARSE_FAILED`, `TRACK_NAME_NOT_FOUND`,
`ARTIST_NOT_FOUND`, `TIMESTAMP_NOT_FOUND`, `TIMESTAMP_PARSE_FAILED` en
`TIMESTAMP_CONFLICT`. De browserroute kan daarnaast `BROWSER_UNAVAILABLE`
(browser niet gevonden of niet startbaar), `BROWSER_BUSY` (profiel in gebruik),
`REDIRECT_REJECTED` (landde op een andere pagina) en `INVALID_URL` geven.

Een actuele uitleesbare relatiepagina is via de browserroute geverifieerd en is
bewaard in `.local/whosampled/stronger-relation-live.html`. De importstap kan
daarom doorgaan met normalisatie/deduplicatie tegen PostgreSQL, importtransacties
en een reviewflow. Een Redis-jobqueue, volledige paginering en een worker-container
volgen wanneer we batches gaan importeren. Audio valt buiten de scraper.
