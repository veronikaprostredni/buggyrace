# 🏁 Iron Man Offroad Racing — moderní remake

Moderní webová verze klasické offroad závodní hry z DOSu. Pohled shora,
celá trať na obrazovce, **dva hráči na jedné klávesnici** — přesně jak to
bývalo na velké obrazovce u jednoho počítače.

Hra běží čistě v prohlížeči (HTML5 Canvas + JavaScript, **žádné závislosti**),
takže ji lze hrát online bez instalace.

## ▶️ Jak hru spustit

Stačí otevřít `index.html` v prohlížeči. Buď přímo dvojklikem, nebo přes
lokální server (doporučeno):

```bash
# v adresáři projektu
python3 -m http.server 8000
# pak otevři http://localhost:8000
```

Hostování online zdarma: nahraj soubory na **GitHub Pages**, Netlify nebo
kamkoli, kde se dají servírovat statické soubory.

## 🎮 Ovládání

| Akce            | Hráč 1 (červený) | Hráč 2 (modrý) |
|-----------------|:----------------:|:--------------:|
| Plyn            | **W**            | **↑**          |
| Brzda/zpátečka  | **S**            | **↓**          |
| Zatáčení        | **A / D**        | **← / →**      |
| Nitro (turbo)   | **Levý Shift**   | **Pravý Shift**|

- **Enter** — spustit závod (z úvodní obrazovky)
- **R** — restart kdykoli během hry

## 🏆 Pravidla

- Závod na **3 kola** po stejné trati.
- Mimo trať (v trávě) auto výrazně zpomalí a drncá — drž se cesty!
- **Nitro** dává dočasné zrychlení, pomalu se samo dobíjí (ukazatel v HUD).
- Auta do sebe mohou narážet a odstrkovat se.
- Kdo dokončí 3 kola první, vyhrává.

## 🛠️ Z čeho se to skládá

| Soubor        | Obsah                                            |
|---------------|--------------------------------------------------|
| `index.html`  | struktura stránky, úvodní a výsledková obrazovka |
| `style.css`   | vzhled, responzivní škálování plátna             |
| `game.js`     | herní logika, fyzika, vykreslování, trať         |

### Pár technických detailů
- Trať je definovaná řídicími body a vyhlazená **Catmull-Rom splajnem**.
- Příslušnost k trati se počítá jako vzdálenost od osy trati.
- Kola a pořadí se počítají přes **branky** rozmístěné po trati (nelze je
  přeskočit ani projet zkratkou).
- Jednoduchá arkádová fyzika (akcelerace, tření, zatáčení závislé na rychlosti).

## 💡 Nápady na rozšíření
- Síťový multiplayer (každý hráč na svém zařízení) přes WebRTC/WebSocket.
- Více tratí, počasí a překážky (bláto, skoky).
- Nakupování vylepšení mezi koly (jako v originále).
- AI soupeři.
- Zvuky motoru a hudba.

Bavte se! 🚙💨
