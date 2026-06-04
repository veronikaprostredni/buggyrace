# 🏁 Iron Man Offroad Racing — moderní remake

Moderní webová verze klasické offroad závodní hry z DOSu. Pohled shora,
arkádová fyzika, **dva hráči na jedné klávesnici** i **skutečný síťový
multiplayer** (každý hráč na svém zařízení). Čistý HTML5 Canvas +
JavaScript, server v Node.js **bez jakýchkoli externích závislostí**.

## ✨ Co hra umí

- 🎮 **Lokální hra** pro 1–2 hráče na jedné klávesnici (hotseat)
- 🌐 **Online multiplayer** — místnosti s kódem, každý hráč na svém zařízení
- 🤖 **AI soupeři** (0–4) ve třech obtížnostech
- 🛣️ **4 tratě** s vlastní geometrií a barevným motivem
- 🏆 **Šampionát** — série 5 závodů s **nakupováním vylepšení** mezi koly
  (motor, zrychlení, pneumatiky, nitro) za vyhrané peníze, jako v originále
- 🔊 **Zvuky** motorů (výška dle rychlosti), nitra, nárazů, odpočtu, sběru a cíle
- 🖥️ **Hra na celou obrazovku** (tlačítko / klávesa **F**), široká plastická trať
- 🧪 **Propracovaná fyzika** — vektor rychlosti, přilnavost a smyk (drift)
- 🟥 **Terén ve stylu originálu** — červeno-bílé mantinely, blátivé a vodní louže
- 🎁 **Balíčky odměn** na trati — nitro, peníze, pneumatiky (grip), zrychlení
- 🔥 Nitro turbo, vzájemné narážení aut

## ▶️ Spuštění

### Jen lokální hra (bez serveru)
Otevři `index.html` v prohlížeči. Online tlačítko se bez serveru nepřipojí,
ale rychlý závod i šampionát fungují rovnou.

### S online multiplayerem (doporučeno)
Potřebuješ jen Node.js (verze 16+), žádné `npm install`:

```bash
npm start          # nebo: node server/server.js
# otevři http://localhost:3000
```

Server zároveň servíruje celou hru i WebSocket pro online hraní.
Ostatní hráči se připojí na stejnou adresu (v rámci sítě nebo přes
tunel/hosting) a zadají **kód místnosti**.

Port lze změnit přes proměnnou prostředí `PORT`:
```bash
PORT=8080 node server/server.js
```

## 🎮 Ovládání

**Lokální hra (jedna klávesnice):**

| Akce            | Hráč 1 (červený) | Hráč 2 (modrý) |
|-----------------|:----------------:|:--------------:|
| Plyn            | **W**            | **↑**          |
| Brzda/zpátečka  | **S**            | **↓**          |
| Zatáčení        | **A / D**        | **← / →**      |
| Nitro           | **Levý Shift**   | **Pravý Shift**|

**Online hra (na svém zařízení):** ovládej buď **WASD + Levý Shift**,
nebo **šipky + Pravý Shift** — obě sady řídí tvé auto.

Další klávesy: **Enter** = potvrdit/start, **R** = restart (lokálně),
**M** = ztlumit zvuk.

## 🏆 Šampionát a obchod

Vyber režim **Šampionát** v menu. Odjedeš 5 závodů na rotujících tratích.
Po každém závodě dostaneš peníze podle umístění a v **obchodě** je utratíš
za vylepšení auta. AI soupeři se v průběhu šampionátu také zlepšují.
Šampionem se stává hráč s nejvíce vítězstvími.

## 🌐 Online multiplayer — jak to funguje

1. Klikni na **🌐 Hrát online**, zadej jméno.
2. **Vytvoř místnost** → dostaneš 4znakový kód, který pošleš kamarádům.
3. Ostatní zadají kód a **Připojí se**.
4. Hostitel zvolí trať, počet kol a AI soupeře a spustí závod.
5. Server běží autoritativní simulaci a posílá stav všem; klienti vykreslují
   plynule interpolovaný obraz a posílají jen svůj vstup.

## 🗂️ Struktura projektu

| Cesta              | Obsah                                                     |
|--------------------|-----------------------------------------------------------|
| `index.html`       | stránka, menu, lobby, obchod, výsledky                    |
| `style.css`        | vzhled a responzivní škálování                            |
| `js/sim.js`        | **simulační jádro** — trati, fyzika, AI, svět (sdílené)   |
| `js/audio.js`      | syntetizovaný zvuk (Web Audio)                            |
| `js/net.js`        | klientská síťová vrstva (WebSocket)                       |
| `js/main.js`       | vstup, vykreslování, UI, herní smyčka, režimy             |
| `server/server.js` | herní server (statické soubory + lobby + simulace)        |
| `server/ws.js`     | minimální WebSocket server (RFC 6455, bez závislostí)     |

### Technické detaily
- Trati jsou definované řídicími body a vyhlazené **Catmull-Rom splajnem**.
- Detekce kol a pořadí přes **branky** řešené protnutím čáry — nelze
  přeskočit ani projet zkratkou.
- Simulace běží s **pevným časovým krokem** (60 Hz) lokálně i na serveru,
  takže se chová stejně v offline i online režimu.
- Online: autoritativní server (~20 Hz snapshoty) + interpolace na klientu.

## 💡 Možná rozšíření
- Online šampionát s obchodem (nyní jen lokálně).
- Více tratí, počasí, překážky (bláto, skoky).
- Žebříčky a perzistence.

Bavte se! 🚙💨
