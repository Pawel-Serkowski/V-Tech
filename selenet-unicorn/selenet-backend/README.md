# selenet backend v2

Nowa wersja backendu dla symulacji routingu pakietow kosmicznych.
Kod powstal jako naprawiona migracja z `selenet/backend` i trafia do katalogu `selenet-unicorn/selenet-backend`.

## Co jest naprawione

- Worker liczy trase CGR przy kazdym hopie, a nie tylko korzysta z trasy policzonej raz.
- Routing preferuje najkrotszy czas dostarczenia i tie-breakuje krotszym dystansem.
- Trasa moze byc odrzucona, gdy geometria wskazuje, ze sygnal przechodzi przez cialo planetarne.
- Node moze miec pozycje XYZ albo pozycje wyliczana z orbity (wysokosc + faza + inklinacja).
- Backend egzekwuje polityke zrodla dispatchu (np. tylko Earth nodes).
- Po odebraniu pakietu worker przekazuje go dalej na kolejke kolejnego wezla, o ile nie dostarczony i nie anulowany.

## Uruchomienie

Glowny plik compose jest teraz na poziomie katalogu nadrzednego:

- `../docker-compose.yml`

Dockerfile backendu jest tutaj:

- `./Dockerfile`

i udostepnia targety:

- `backend` (API FastAPI),
- `worker` (proces worker).

Pelna dokumentacja serwisow i uruchamiania jest w:

- `../README.md`

Start calego stosu wykonuj z katalogu `selenet-unicorn`:

```bash
docker compose up --build
```

## Testy

Testy backendu uruchamiaj z katalogu `selenet-unicorn/selenet-backend`:

```bash
pytest -q
```
