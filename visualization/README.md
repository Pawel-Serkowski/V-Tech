# Kosmiczne 3D

Interaktywna aplikacja webowa pokazująca:

- Ziemię w 3D
- satelity wokół Ziemi
- Księżyc
- nowe satelity orbitujące wokół Księżyca
- nocne światła miast na Ziemi
- bardziej realistyczne gwiazdy i Słońce
- klikane satelity z panelem informacji

## Uruchomienie

```bash
npm install
npm run dev
```

## Build produkcyjny

```bash
npm run build
```

## Tekstury

Realistyczne tekstury Ziemi i Księżyca są zapisane lokalnie w `public/textures`.
Pochodzą z oficjalnych zasobów przykładowych `Three.js`:

- `earth_day.jpg`
- `earth_normal.jpg`
- `earth_specular.jpg`
- `earth_night.png`
- `earth_clouds.png`
- `moon.jpg`

## Sterowanie

- obrót kamery: przeciągnięcie myszą
- zoom: scroll
- przesuwanie widoku: prawy przycisk myszy
