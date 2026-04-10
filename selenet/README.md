# selnet Monorepo

selnet to symulacja routingu Earth-Moon Gateway oparta o DTN (Delay-Tolerant Networking).
Projekt jest zrobiony jako zestaw uslug (frontend + backend + broker + workerzy), gdzie kazdy worker symuluje osobny wezel/satelite.

## Szybki Start (najkrotsza sciezka)

1. Wejdz do katalogu projektu:

```bash
cd selnet
```

2. Uruchom wszystko (z budowaniem obrazow):

```bash
docker compose up --build
```

3. Otworz:

- Frontend: http://localhost:5173
- Backend docs: http://localhost:8000/docs (kompat) lub http://localhost:8001/docs
- RabbitMQ panel: http://localhost:15672 (guest/guest)

## Jak odpalic wszystkich workerow (dokladnie o to pytales)

Masz dwa najczestsze warianty:

1. Caly stack w tle:

```bash
docker compose up -d --build
```

2. Tylko backend + db + broker + wszystkie workery (bez frontendu):

```bash
docker compose up -d --build \
	backend mongo rabbitmq \
	worker_earth_gateway worker_sat_1 worker_sat_2 worker_lunar_gateway
```

Sprawdzenie czy workerzy dzialaja:

```bash
docker compose ps
```

Podglad logow workerow:

```bash
docker compose logs -f worker_earth_gateway worker_sat_1 worker_sat_2 worker_lunar_gateway
```

Stop:

```bash
docker compose down
```

Pelne sprzatanie (wolumeny + osierocone kontenery):

```bash
docker compose down -v --remove-orphans
```

## Jak dodac nowego workera (nowa satelite)

1. Dodaj nowa usluge worker w docker-compose.yml (najlatwiej skopiowac worker_sat_1).
2. Ustaw:
	 - NODE_ID: musi byc zgodny z node_id w konfiguracji nodow
	 - NODE_LOCATION: etykieta lokalizacji (np. "L2 Transfer Arc")
3. Odpal:

```bash
docker compose up -d --build <nazwa_nowej_uslugi>
```

Jesli NODE_ID nie pasuje do nodow wysylajacych pakiety, kolejka bedzie sie zapelniac, ale worker nie bedzie bral tych paczek.

## Architektura i przeplyw danych

1. Frontend wysyla POST /api/packets.
2. Backend zapisuje pakiet i wylicza route_hops.
3. Backend wrzuca wiadomosc do kolejki zrodla: packets.<source_node>.
4. Worker z tym NODE_ID robi jeden hop i przekazuje dalej do kolejki kolejnego wezla.
5. Statusy trafiaja do backendu przez POST /api/packets/status i przez WebSocket do UI.

To jest model zdecentralizowany store-and-forward (jeden hop na instancje workera).

## Jak poruszac sie po aplikacji (UI)

Po wejciu na http://localhost:5173 masz 4 glowne widoki:

1. Monitoring
	 - tabela pakietow, statusy, queue load, event feed
	 - tu najlatwiej diagnozowac czy pakiety utknely

2. Dispatch
	 - wysylanie nowych pakietow
	 - wybierasz source_node, destination_node, priority, payload

3. Graf Statusow
	 - wizualizacja przejsc statusow i hopow dla wybranych pakietow

4. Objects
	 - definicja nodow (ground_station/satellite/relay)
	 - links, contact_windows, orbit, location_label
	 - bez poprawnych nodow routing nie bedzie dzialal

## Jak poruszac sie po kodzie (mapa repo)

- backend/app/main.py
	- start FastAPI, lifecycle, podpiecie routerow

- backend/app/api/packets.py
	- ingest pakietow, queue-load, status callback, cancel

- backend/app/api/nodes.py
	- upload/lista konfiguracji nodow

- backend/app/cgr.py
	- wyliczanie route_hops na podstawie links + contact windows

- backend/worker/worker.py
	- logika jednego hopa, forwarding miedzy kolejkami packets.<NODE_ID>

- frontend/src/pages
	- glowna nawigacja UI (Monitoring, Dispatch, Graf Statusow, Objects)

- scripts/simulate_cancel_flow.sh
	- gotowy test flow z anulowaniem

- scripts/simulate_retry_flow.sh
	- test WAITING_RETRY -> QUEUED_ON_EARTH -> DELIVERED

## Kluczowe endpointy backendu

- POST /api/packets
- GET /api/packets
- GET /api/packets/queue-load
- POST /api/packets/status
- POST /api/packets/{packet_id}/cancel
- POST /api/nodes
- POST /api/nodes/upload-file
- GET /api/nodes
- WS /ws/status

## Konfiguracja nodow (co musi byc ustawione)

Node schema wspiera:

- node_id
- node_type: ground_station | satellite | relay
- links: lista dozwolonych next-hop
- contact_windows: okna lacznosci
- orbit: etykieta orbity (fallback lokalizacji)
- location_label: preferowana etykieta lokalizacji

Przyklad uploadu:

```bash
curl -X POST http://localhost:8000/api/nodes \
	-H 'Content-Type: application/json' \
	--data-binary @simulations/nodes.multi-window.json
```

## Pozycja satelity - jak jest okreslana teraz

Pozycja jest etykieta logiczna, nie obliczeniem 3D:

1. Najpierw location_label z konfiguracji noda.
2. Jesli brak, fallback na orbit.
3. Worker moze nadpisac/dopelnic lokalizacje przez NODE_LOCATION.

Efekt widac w telemetrii hopow: from_location -> to_location.

## Retry i cancel (zachowanie)

- Retry engine skanuje WAITING_RETRY i automatycznie ponawia wysylke,
	gdy pojawi sie poprawne okno kontaktu.
- Cancel jest finalizowany do CANCELLED po stronie backendu,
	zeby pakiety nie wisialy jako QUEUED_ON_EARTH.
- Queue-load nie liczy pakietow z cancel_requested=true.

## Gotowe symulacje E2E

Cancel flow:

```bash
chmod +x scripts/simulate_cancel_flow.sh
./scripts/simulate_cancel_flow.sh
```

Retry flow:

```bash
chmod +x scripts/simulate_retry_flow.sh
./scripts/simulate_retry_flow.sh
```

## Najczestsze problemy i szybka diagnoza

1. "Requesty nie ida"
	 - sprawdz backend na 8000/8001:

```bash
curl http://localhost:8000/api/health
curl http://localhost:8001/api/health
```

2. "Pakiety stoja w kolejce"
	 - sprawdz czy istnieje worker z NODE_ID rownym source_node lub kolejnemu hopowi
	 - sprawdz logs workerow

3. "Brak trasy"
	 - sprawdz links i contact_windows w Objects
	 - sprawdz czy source/destination istnieja w konfiguracji

4. "Frontend pokazuje stare dane"
	 - twarde odswiezenie strony
	 - sprawdzenie websocketu /ws/status

## Uwagi techniczne

- Frontend, backend i worker korzystaja z jednego Dockerfile (multi-stage).
- RabbitMQ ma kolejki priorytetowe x-max-priority.
- Routing korzysta z czasu bazowego Earth.
