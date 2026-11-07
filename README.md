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
- Filter unterstützen `domain`, `device_class`, `entity_id_regex`, `name_regex` und `state_regex`; mehrere Filter werden als ODER ausgewertet.
- `exclude_entity_filters`: schließt Entities aus (wird auf `entity_filters` angewandt).
- `label`: fester Text der Kachel.
- `icon`: Standard‑Icon (mdi).
- `color`: Standardfarbe.
- `warning`: feste Warnmarkierung (true/false).
- `tap_action`: Aktion bei Klick.
- `list_id`: eindeutige ID zum Verbinden mit `custom:status-tiles-list` in derselben Dashboard-Ansicht.
- `exclude`: Liste von Suchmustern; `*` steht für beliebig viele Zeichen. Das Muster wird innerhalb von Entity-ID und Anzeigename gesucht, ohne Beachtung der Groß-/Kleinschreibung. Andere Regex-Zeichen sind normale Zeichen. Wird auch auf `entity` und `entities` angewandt.
- `long_press_enabled`: Long‑Press aktivieren/deaktivieren (Standard: true).
- Ein Long-Press wird nach 1 Sekunde erkannt.
- `long_press_action: turn_on`: bei Long-Press ausschließlich den Dienst `switch.turn_on` für `long_press_entity` aufrufen. Die Entity muss aus der Domain `switch` stammen; es gibt keine Ausschalt-Aktion.
- `long_press_entity`: Schalter-Entity für `long_press_action: turn_on`.
- `alarm_enabled`, `alarm_sound`, `alarm_volume`: pro Kachel überschreibbar.

---

## 6) `states`‑Regeln (Status‑Matching)

In `states` definierst du Regeln, welche je nach Status ausgewählt werden. Die erste passende Regel gewinnt.

Bei mehreren Entities bestimmt eine passende Warnregel Farbe, Icon, Beschriftung
und Blinkanimation der Kachel, auch wenn die erste Entity keine Warnung hat.
Treffen verschiedene Warnregeln zu, hat die in `states` weiter oben stehende
Regel Vorrang. Ohne Warnung bleibt die erste Entity die Quelle der Darstellung.
Unterdrückte Warnungen behalten die konfigurierte Unterdrückungsfarbe.

**Mögliche Felder:**

- `value`: exakter State (String).
- `values`: Liste erlaubter States (Array).
- `regex`: RegEx‑Match gegen den State.
- `entity_id_regex`: beschränkt eine Statusregel auf passende Entity-IDs (JavaScript-RegEx), z. B. um Spannungsgrenzen nur auf Phasensensoren anzuwenden.
- `date_within_days`: matcht einen am Anfang des States stehenden ISO-Zeitstempel, wenn er innerhalb der angegebenen Anzahl vergangener Tage liegt (z. B. `2025-12-29T19:58:29+0200 Fehlermeldung`). Die Karte entfernt die Warnung automatisch beim Ablauf der Frist.
- `from` / `to`: numerischer Bereich (für numerische States).
- `operator` / `value`: numerischer Vergleich (`>`, `>=`, `<`, `<=`, `==`, `!=`).
- `label`: überschreibt die Beschriftung.
- `icon`: überschreibt das Icon.
- `color`: überschreibt die Farbe.
- `warning`: markiert als Warnung (true).
- `blink`: Blinkdauer in Sekunden (z. B. `1.0`). `0` oder nicht gesetzt = aus.

Beispiel für einen gemeinsamen Netzstatus mit getrennten Spannungs- und Frequenzgrenzen:

```yaml
entities:
  - sensor.tasmota_sz_v_l1
  - sensor.tasmota_sz_v_l2
  - sensor.tasmota_sz_v_l3
  - sensor.tasmota_sz_hz
states:
  - entity_id_regex: "^sensor\\.tasmota_sz_v_l[123]$"
    operator: "<="
    value: 0
    warning: true
    color: "#ff4d4d"
  - values: ["unknown", "unavailable"]
    warning: true
    color: "#ffb347"
  - entity_id_regex: "^sensor\\.tasmota_sz_v_l[123]$"
    operator: "<"
    value: 207
    warning: true
    color: "#ffb347"
  - entity_id_regex: "^sensor\\.tasmota_sz_v_l[123]$"
    operator: ">"
    value: 253
    warning: true
    color: "#ffb347"
  - entity_id_regex: "^sensor\\.tasmota_sz_hz$"
    operator: "<"
    value: 49.5
    warning: true
    color: "#ffb347"
  - entity_id_regex: "^sensor\\.tasmota_sz_hz$"
    operator: ">"
    value: 50.5
    warning: true
    color: "#ffb347"
```

Beispiel für einen Heizungsfehler, der höchstens 30 Tage alt ist:

```yaml
- label: Heizung
  icon: mdi:radiator
  entity: sensor.192_168_1_22_fehler_1
  states:
    - date_within_days: 30
      label: Heizungsfehler
      icon: mdi:alert
      warning: true
      color: "#ff4d4d"
  tap_action:
    action: more-info
```

---

## 7) Blink‑Animation (grau ↔ Farbe)

- `blink` gehört in die passende `states`‑Regel.
- Beispiel: `blink: 1.0` bedeutet ein kompletter Blink‑Zyklus pro Sekunde.
- `blink: 0` (oder kein `blink`) deaktiviert das Blinken.

---

## 8) Warnungen & Unterdrückung (Long‑Press)

- Halte die Kachel mindestens 1 Sekunde gedrückt, um einen Long-Press auszulösen.
- Ohne konfigurierte Long-Press-Aktion kann eine Warnkachel (`warning: true`) per **Long‑Press** unterdrückt werden.
- Unterdrückte Warnungen bleiben grau, bis der Status nicht mehr als Warnung gilt.
- Unterdrückung wird im Browser‑Storage gespeichert.
- Wenn `long_press_action: turn_on` gesetzt ist, wird beim Long-Press stattdessen nur der Schalter eingeschaltet; die Warnungsunterdrückung dieser Kachel ist dann deaktiviert. Nach Annahme des Dienstaufrufs erscheint eine Bestätigung, bei einem Fehler eine Fehlermeldung.
- Ein kurzer Tipp führt weiterhin die konfigurierte `tap_action` aus.

Beispiel: Zigbee2MQTT mit Long-Press einschalten:

```yaml
- label: Zigbee2MQTT
  icon: mdi:zigbee
  entity: binary_sensor.zigbee2mqtt_aktiv
  states:
    - values: ["off", "unknown", "unavailable"]
      warning: true
      color: "#ff4d4d"
    - value: "on"
      color: "#2ecc71"
  tap_action:
    action: more-info
  long_press_action: turn_on
  long_press_entity: switch.zigbee2mqtt
```

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

### Bubble-Popup mit einmaliger Definition im Dashboard

Die zusätzliche Karte `custom:status-tiles-list` ist in derselben JavaScript-Ressource
enthalten. Sie übernimmt Auswahl, Ausschlüsse und Warnregeln von der Kachel mit der
angegebenen `list_id`. Die ID muss unter allen gleichzeitig angezeigten
Status-Tiles-Karten eindeutig sein. Beide Karten müssen in derselben Ansicht geladen
sein. Die Liste aktualisiert sich mit den Entity-Zuständen; ein Klick auf einen
Eintrag öffnet dessen Detailansicht. Unterdrückte Warnungen bleiben in der Liste.
Kacheln mit `list_id` zeigen die Anzahl bereits ab einer Warnung.

Kachel:

```yaml
type: custom:status-tiles-card
tiles:
  - label: Batterie
    list_id: batterie
    icon: mdi:battery
    entity_filters:
      - domain: sensor
        entity_id_regex: sensor.*battery
      - domain: binary_sensor
        entity_id_regex: binary_sensor.*battery
    exclude:
      - deye
    states:
      - operator: "<="
        value: 50
        warning: true
        color: "#ffb347"
      - value: "on"
        warning: true
        color: "#ff4d4d"
    tap_action:
      action: navigate
      navigation_path: "#batterie"
```

Separate Popup-Karte (Bubble Card erforderlich, kein Auto-Entities oder Template-Sensor):

```yaml
type: vertical-stack
cards:
  - type: custom:bubble-card
    card_type: pop-up
    hash: "#batterie"
    name: Betroffene Batterien
    icon: mdi:battery-alert
  - type: custom:status-tiles-list
    source: batterie
    title: Betroffene Batterien
```

`source` muss der `list_id` entsprechen. Die Liste meldet fehlende oder doppelte
Quell-IDs ausdrücklich. Nach Aktualisierung der JavaScript-Datei Browser-Cache
leeren oder die Ressourcen-URL mit einem neuen Versionsparameter laden.
Die bestehenden `*_regex`-Filter verwenden JavaScript-RegEx: `(?i)` wird dort
nicht unterstützt. Für einfache Ausschlüsse stattdessen `exclude` verwenden.

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
- Der horizontale Abstand zwischen Kacheln ist auf **maximal 5px** begrenzt; zwischen den Reihen bleibt zusätzlicher Platz für Labels und Warn-Badges.
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
