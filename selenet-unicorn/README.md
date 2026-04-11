# selenet-unicorn

Ta wersja zawiera nowy backend (v2) oraz wspolny plik compose na poziomie katalogu glownego, z mysla o dolaczeniu frontendu do tego samego `docker-compose.yml`.

## Struktura

- `frontend/` - nowy frontend React/Vite (dashboard, pakiety, dispatch, flota, wizualizacja).
- `selenet-backend/` - kod aplikacji backendowej i workerow.
- `docker-compose.yml` - wspolny punkt uruchamiania calego stosu.

## Dockerfile i obrazy

Dockerfile znajduje sie w katalogu `selenet-backend`:

- `selenet-backend/Dockerfile`

Zawiera 3 etapy:

- `base` - wspolna baza z zaleznosciami Python,
- `backend` - obraz uruchamiajacy FastAPI (`uvicorn app.main:app`),
- `worker` - obraz uruchamiajacy worker (`python worker/worker.py`).

W `docker-compose.yml` serwis `backend` buduje target `backend`,
a serwisy workerow buduja target `worker` z tego samego Dockerfile.

## Serwisy w docker-compose

### frontend

Frontend uruchamiany w compose w trybie developerskim (Vite + hot reload):

- Dashboard operacyjny ze zwiezlymi statystykami,
- Lista pakietow z filtrowaniem, paginacja i widokiem szczegolowym pipeline,
- Strona konfiguracji floty (download/upload JSON + modal edycji satelity),
- Strona dispatchu (manual + szablony + upload payload JSON),
- Strona wizualizacji zsynchronizowana z tym samym strumieniem telemetrycznym co dashboard.

Port hosta: `5173` (kontener: `5173`).

Hot reload dziala przez bind mount `./frontend:/app` oraz polling watcherow (`CHOKIDAR_USEPOLLING=true`).
Po edycji plikow w `frontend/src` przegladarka powinna odswiezyc widok automatycznie.

### backend

FastAPI API odpowiedzialne za:

- upload i odczyt konfiguracji nodow (`/api/nodes`),
- ingest pakietow (`/api/packets`),
- walidacje polityki zrodla dispatchu,
- statusy pakietow i anulowanie,
- websocket statusow (`/ws/status`).

Najwazniejsze cechy:

- egzekwowanie zrodla wysylki przez `DISPATCH_ORIGIN_SCOPE`,
- kolejki per-node (`packets.<NODE_ID>`),
- integracja z MongoDB i RabbitMQ.

Port hosta: `8002` (kontener: `8000`).

### worker_earth_gateway, worker_sat_1, worker_lunar_gateway

Kazdy worker reprezentuje niezalezny node w sieci DTN i robi store-and-forward:

- pobiera pakiet z kolejki przypisanej do swojego `NODE_ID`,
- pobiera biezaca konfiguracje nodow z backendu,
- liczy kolejny hop przez CGR dla aktualnego czasu,
- sprawdza TTL i cancellation,
- publikuje pakiet na kolejke nastepnego node'a,
- wysyla statusy do backendu.

To znaczy, ze routing jest dynamiczny na kazdym kroku (a nie tylko raz przy ingest).

### rabbitmq

Broker AMQP dla kolejkowania pakietow i priorytetow.

- AMQP host port: `5673`
- panel management: `15673`

### mongo

Baza danych na:

- konfiguracje nodow,
- dokumenty pakietow,
- historie statusow.

Host port: `27018`.

## Jak dziala routing (CGR + geometria)

W `selenet-backend/app/cgr.py`:

- trasa wybierana jest po najwczesniejszym czasie dotarcia,
- przy remisie czasowym wybierana jest mniejsza laczna odleglosc,
- przy kolejnym remisie mniejsza liczba hopow,
- mozna liczyc pozycje nodow z XYZ albo z modelu orbitalnego,
- trasy przecinajace wnetrze planety sa odrzucane (brak LOS przez cialo).

## Uruchomienie calego stosu

Z katalogu `selenet-unicorn`:

```bash
docker compose up --build
```

W tle:

```bash
docker compose up --build -d
```

Stop:

```bash
docker compose down
```

## Jak odpalic testy

Testy backendu mozesz uruchomic z katalogu `selenet-unicorn`:

```bash
python3 -m pytest -q
```

albo z katalogu `selenet-unicorn/selenet-backend`:

```bash
pytest -q
```

albo jawnie przez interpreter z Twojego venv:

```bash
/Users/pawelserkowski/Desktop/V-Tech/.venv/bin/python -m pytest -q
```

Testy frontendu (z katalogu `selenet-unicorn/frontend`):

```bash
npm install
npm run test:run
npm run build
```

## Przygotowanie pod frontend w tym samym compose

Gdy dodasz frontend, dopisz nowy serwis do `docker-compose.yml` na poziomie `selenet-unicorn`.
Dzieki temu `docker compose up --build` uruchomi backend, workery, baze, kolejke i frontend jednym poleceniem.
