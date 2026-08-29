# Status Tiles Card – Ausführliche Anleitung

Diese Karte erzeugt dynamische Status‑Kacheln mit farbigen Kreisen, Warnungen, optionalen Alarm‑Sounds und Blinkanimationen. Die Kacheln werden immer in **5 Spalten** dargestellt; Größe und Höhe passen sich automatisch an die verfügbare Breite an.

---

## 1) Installation und Ressourcen

1. Datei in den Ordner `www/` der Home‑Assistant‑Instanz kopieren, z. B.:
   - `status-tiles-card.js`
2. In Home Assistant die Ressource hinzufügen:
   - **Einstellungen → Dashboards → Ressourcen → Ressource hinzufügen**
   - URL: `/local/status-tiles-card.js`
   - Typ: **JavaScript Module**
3. Browser‑Cache leeren oder hart neu laden, wenn die Karte nicht erscheint.

---

## 2) Minimal‑Beispiel

```yaml
type: custom:status-tiles-card
tiles:
  - entity: sensor.temperature
    label: Temperatur
```

---

## 3) Vollständiges Beispiel

```yaml
type: custom:status-tiles-card
title: Status
columns_min: 90
circle_size: 56
tile_gap: 12
suppressed_color: "#8a8f99"
alarm_enabled: true
alarm_sound: /local/sounds/alarm.mp3
alarm_volume: 0.6
tiles:
  - entity: binary_sensor.window
    label: Fenster
    icon: mdi:window-open
    states:
      - value: "on"
        warning: true
        color: "#ff4d4d"
        blink: 1.0
      - value: "off"
        color: "#2ecc71"

  - entities:
      - binary_sensor.door
      - binary_sensor.garage_door
    label: Türen
    icon: mdi:door
    states:
      - values: ["on", "open"]
        warning: true
        color: "#ff6b6b"
      - values: ["off", "closed"]
        color: "#2ecc71"

  - entity_filters:
      - domain: sensor
        name_regex: "Feuchtigkeit"
        state_regex: "^[7-9][0-9]$"
    label: Feuchte hoch
    icon: mdi:water-percent
    states:
      - regex: "^[7-9][0-9]$"
        warning: true
        color: "#3498db"
```

---

## 4) Globale Karten‑Optionen

- `title`: Titel der Karte (optional).
- `columns_min`: Minimalbreite pro Kachel (wird aktuell übersteuert, da immer 5 Spalten gerendert werden).
- `circle_size`: Maximale Kreisgröße in px (die tatsächliche Größe passt sich an die verfügbare Breite an).
- `tile_gap`: gewünschter Abstand in px (wird intern auf max. 5px begrenzt).
- `suppressed_color`: Farbe, wenn eine Warnung unterdrückt ist.
- `alarm_enabled`: globaler Alarm (true/false).
- `alarm_sound`: URL zur Audiodatei.
- `alarm_volume`: 0.0–1.0.
- `tiles`: Liste der Kacheln.

---

## 5) Tile‑Optionen (pro Kachel)

- `entity`: einzelne Entity als Primärquelle.
- `entities`: mehrere Entities (Array). Die erste wird als Primäranzeige genutzt.
- `entity_filters`: dynamische Auswahl von Entities anhand von Filtern.
- `exclude_entity_filters`: schließt Entities aus (wird auf `entity_filters` angewandt).
- `label`: fester Text der Kachel.
- `icon`: Standard‑Icon (mdi).
- `color`: Standardfarbe.
- `warning`: feste Warnmarkierung (true/false).
- `tap_action`: Aktion bei Klick.
- `long_press_enabled`: Long‑Press aktivieren/deaktivieren (Standard: true).
- `alarm_enabled`, `alarm_sound`, `alarm_volume`: pro Kachel überschreibbar.

---

## 6) `states`‑Regeln (Status‑Matching)

In `states` definierst du Regeln, welche je nach Status ausgewählt werden. Die erste passende Regel gewinnt.

**Mögliche Felder:**

- `value`: exakter State (String).
- `values`: Liste erlaubter States (Array).
- `regex`: RegEx‑Match gegen den State.
- `from` / `to`: numerischer Bereich (für numerische States).
- `operator` / `value`: numerischer Vergleich (`>`, `>=`, `<`, `<=`, `==`, `!=`).
- `label`: überschreibt die Beschriftung.
- `icon`: überschreibt das Icon.
- `color`: überschreibt die Farbe.
- `warning`: markiert als Warnung (true).
- `blink`: Blinkdauer in Sekunden (z. B. `1.0`). `0` oder nicht gesetzt = aus.

---

## 7) Blink‑Animation (grau ↔ Farbe)

- `blink` gehört in die passende `states`‑Regel.
- Beispiel: `blink: 1.0` bedeutet ein kompletter Blink‑Zyklus pro Sekunde.
- `blink: 0` (oder kein `blink`) deaktiviert das Blinken.

---

## 8) Warnungen & Unterdrückung (Long‑Press)

- Wenn eine Kachel als Warnung erkannt wird (`warning: true`), kann sie per **Long‑Press** unterdrückt werden.
- Unterdrückte Warnungen bleiben grau, bis der Status nicht mehr als Warnung gilt.
- Unterdrückung wird im Browser‑Storage gespeichert.

---

## 9) Tap‑Aktionen

`tap_action` unterstützt:

- **more-info** (Standard): zeigt die Entitäts‑Detailansicht.
- **navigate**: wechselt das Dashboard.
- **url**: öffnet eine URL in neuem Tab.

Beispiel:

```yaml
tap_action:
  action: navigate
  navigation_path: /lovelace/energie
```

---

## 10) Filter‑Beispiele

### 10.1) Alle Sensoren mit Namen „Fenster“
```yaml
entity_filters:
  - domain: binary_sensor
    name_regex: "Fenster"
```

### 10.2) Nur States, die auf „open“ enden
```yaml
entity_filters:
  - state_regex: "open$"
```

---

## 11) Layout‑Hinweise

- Es werden **immer 5 Kacheln pro Zeile** angezeigt (mobil & desktop).
- Die Kachelgröße skaliert automatisch mit der Breite, die Höhe passt sich an.
- Der Abstand zwischen Kacheln ist auf **maximal 5px** begrenzt.
- Kreis und Label‑Box haben immer die **gleiche Breite**.

---

## 12) Fehlersuche

- Prüfe, ob die Ressource korrekt eingebunden ist (JS Module).
- Cache leeren oder „Hard Reload“ durchführen.
- In der Browser‑Konsole auf Fehler achten.
- Prüfe YAML‑Syntax (Einrückung!).

---

## 13) Kurz‑Cheatsheet (Blinken)

```yaml
states:
  - value: "on"
    warning: true
    color: "#ff4d4d"
    blink: 1.0
```
