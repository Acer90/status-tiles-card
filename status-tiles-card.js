class StatusTilesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._pressTimer = null;
    this._longPressHandled = false;
    this._suppressed = this._loadSuppressed();
    this._lastWarningStates = {};
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.tiles)) {
      throw new Error("Status Tiles Card: 'tiles' array is required.");
    }

    this._config = {
      title: config.title || "",
      columns_min: config.columns_min || 90,
      circle_size: config.circle_size || 56,
      tile_gap: config.tile_gap || 12,
      suppressed_color: config.suppressed_color || "#8a8f99",
      alarm_sound: config.alarm_sound || "",
      alarm_volume:
        typeof config.alarm_volume === "number" ? config.alarm_volume : undefined,
      alarm_enabled: config.alarm_enabled !== false,
      tiles: config.tiles,
    };

    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _loadSuppressed() {
    try {
      const raw = window.localStorage.getItem("status_tiles_card_suppressed");
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  _saveSuppressed() {
    try {
      window.localStorage.setItem(
        "status_tiles_card_suppressed",
        JSON.stringify(this._suppressed)
      );
    } catch (err) {
      // ignore
    }
  }

  _handleTap(entityId, tapAction) {
    if (!tapAction || tapAction.action === "more-info") {
      if (!entityId) return;
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    if (tapAction.action === "navigate" && tapAction.navigation_path) {
      if (window.location.pathname !== tapAction.navigation_path) {
        window.history.pushState(null, "", tapAction.navigation_path);
        this.dispatchEvent(
          new CustomEvent("location-changed", {
            detail: { replace: false },
            bubbles: true,
            composed: true,
          })
        );
      }
      return;
    }

    if (tapAction.action === "url" && tapAction.url_path) {
      window.open(tapAction.url_path, "_blank");
      return;
    }
  }

  _compareNumeric(operator, left, right) {
    switch (operator) {
      case ">":
        return left > right;
      case ">=":
        return left >= right;
      case "<":
        return left < right;
      case "<=":
        return left <= right;
      case "!=":
        return left !== right;
      case "==":
      default:
        return left === right;
    }
  }

  _matchState(tile, stateObj) {
    if (!stateObj || !tile.states) return tile.default || null;

    const rawState = stateObj.state;
    const numericState = Number.parseFloat(rawState);
    const hasNumeric = !Number.isNaN(numericState);

    for (const rule of tile.states) {
      if (rule == null) continue;

      if (hasNumeric && (rule.from != null || rule.to != null)) {
        const fromOk = rule.from == null || numericState >= rule.from;
        const toOk = rule.to == null || numericState <= rule.to;
        if (fromOk && toOk) return rule;
      }

      if (hasNumeric && rule.operator && rule.value != null) {
        if (this._compareNumeric(rule.operator, numericState, rule.value)) return rule;
      }

      if (rule.regex) {
        try {
          const regex = new RegExp(rule.regex);
          if (regex.test(rawState)) return rule;
        } catch (err) {
          // ignore invalid regex
        }
      }

      if (rule.value != null && String(rule.value) === String(rawState)) return rule;

      if (Array.isArray(rule.values)) {
        if (rule.values.map(String).includes(String(rawState))) return rule;
      }
    }

    return tile.default || null;
  }

  _getTileKey(tile, index) {
    return (
      tile.key ||
      tile.entity ||
      (Array.isArray(tile.entities) ? tile.entities.join("|") : "") ||
      tile.label ||
      `tile_${index}`
    );
  }

  _getTileEntities(tile) {
    if (Array.isArray(tile.entities) && tile.entities.length) return tile.entities;
    if (tile.entity) return [tile.entity];

    const filters = Array.isArray(tile.entity_filters) ? tile.entity_filters : [];
    if (!filters.length || !this._hass?.states) return [];

    const entities = Object.keys(this._hass.states);
    const matchesFilter = (entityId, filter) => {
      const stateObj = this._hass.states[entityId];
      const domain = entityId.split(".")[0];

      if (filter.domain && filter.domain !== domain) return false;

      if (filter.entity_id_regex) {
        try {
          const regex = new RegExp(filter.entity_id_regex);
          if (!regex.test(entityId)) return false;
        } catch (err) {
          return false;
        }
      }

      if (filter.name_regex) {
        const name = stateObj?.attributes?.friendly_name || "";
        try {
          const regex = new RegExp(filter.name_regex);
          if (!regex.test(name)) return false;
        } catch (err) {
          return false;
        }
      }

      if (filter.state_regex) {
        const rawState = stateObj?.state ?? "";
        try {
          const regex = new RegExp(filter.state_regex);
          if (!regex.test(String(rawState))) return false;
        } catch (err) {
          return false;
        }
      }

      return true;
    };

    const included = entities.filter((entityId) =>
      filters.some((filter) => matchesFilter(entityId, filter))
    );

    if (Array.isArray(tile.exclude_entity_filters)) {
      const excluded = entities.filter((entityId) =>
        tile.exclude_entity_filters.some((filter) => matchesFilter(entityId, filter))
      );
      return included.filter((entityId) => !excluded.includes(entityId));
    }

    return included;
  }

  _isWarning(match, tile) {
    if (match && match.warning === true) return true;
    if (tile && tile.warning === true) return true;
    return false;
  }

  _clearSuppressionIfResolved(entityId, isWarning) {
    if (!this._suppressed[entityId]?.active) return;
    if (!isWarning) {
      delete this._suppressed[entityId];
      this._saveSuppressed();
    }
  }

  _playAlarm(tile) {
    if (tile?.alarm_enabled === false) return;
    if (this._config?.alarm_enabled === false && tile?.alarm_enabled !== true) return;

    const sound = tile?.alarm_sound || this._config?.alarm_sound;
    if (!sound) return;

    try {
      const audio = new Audio(sound);
      const volume =
        typeof tile?.alarm_volume === "number"
          ? tile.alarm_volume
          : this._config?.alarm_volume;
      if (typeof volume === "number") {
        audio.volume = Math.min(1, Math.max(0, volume));
      }
      audio.play().catch(() => undefined);
    } catch (err) {
      // ignore audio errors
    }
  }

  _render() {
    if (!this._config || !this.shadowRoot) return;

    const { columns_min, circle_size, tile_gap, suppressed_color, tiles } =
      this._config;
    const scaledCircleSize = Math.round(circle_size * 1.45);
    const scaledGap = Math.min(5, Math.max(2, Math.round(tile_gap * 0.35)));

    const tileHtml = tiles
      .map((tile, index) => {
        const key = this._getTileKey(tile, index);
        const entities = this._getTileEntities(tile);
        const primaryEntityId = entities[0] || "";

        let warningCount = 0;
        let match = null;
        let firstStateObj = null;

        entities.forEach((entityId, entityIndex) => {
          const stateObj = this._hass?.states?.[entityId];
          if (entityIndex === 0) firstStateObj = stateObj;
          const entityMatch = this._matchState(tile, stateObj);
          if (entityIndex === 0) match = entityMatch;
          if (this._isWarning(entityMatch, tile)) warningCount += 1;
        });

        const isWarning = warningCount > 0 || this._isWarning(match, tile);
        const suppressed = !!this._suppressed[key]?.active && isWarning;

        const wasWarning = !!this._lastWarningStates[key];
        if (!wasWarning && isWarning && !suppressed) {
          this._playAlarm(tile);
        }
        this._lastWarningStates[key] = isWarning;

        this._clearSuppressionIfResolved(key, isWarning);

        const label =
          (match && match.label) ||
          tile.label ||
          firstStateObj?.attributes?.friendly_name ||
          primaryEntityId ||
          "";

        const icon =
          (match && match.icon) ||
          tile.icon ||
          firstStateObj?.attributes?.icon ||
          "mdi:information-outline";

        const color = suppressed
          ? suppressed_color
          : (match && match.color) || tile.color || "var(--primary-color)";

        const blinkValue = match?.blink;
        const blinkSeconds = typeof blinkValue === "number" ? blinkValue : 0;
        const shouldBlink = blinkSeconds > 0 && !suppressed;

        const showBadge = warningCount > 2;

        return `
          <div class="tile" data-entity="${primaryEntityId}" data-key="${key}" style="--tile-color: ${color}; --circle-max-size: ${scaledCircleSize}px;${shouldBlink ? ` --blink-duration: ${blinkSeconds}s;` : ""}">
            <div class="circle ${shouldBlink ? "blink" : ""}">
              <ha-icon icon="${icon}"></ha-icon>
              ${showBadge ? `<span class="badge">${warningCount}</span>` : ""}
            </div>
            <div class="label-box ${suppressed ? "suppressed" : ""}">
              <div class="label">${label}</div>
            </div>
          </div>
        `;
      })
      .join("");

    this.shadowRoot.innerHTML = `
      <ha-card>
        <div class="grid">
          ${tileHtml}
        </div>
      </ha-card>
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 6px 6px 10px;
          background: transparent;
          box-shadow: none;
          border: none;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: ${scaledGap}px;
        }
        .tile {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          cursor: pointer;
          user-select: none;
          width: 100%;
          justify-self: center;
          --circle-size: min(100%, var(--circle-max-size));
        }
        .circle {
          width: var(--circle-size);
          height: var(--circle-size);
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          background: color-mix(in srgb, var(--tile-color) 80%, transparent);
          border: 1px solid color-mix(in srgb, var(--tile-color) 95%, rgba(255,255,255,0.8));
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 2;
        }
        .circle.blink {
          animation: status-tiles-blink var(--blink-duration, 1.2s) ease-in-out infinite;
        }
        @keyframes status-tiles-blink {
          0%, 100% {
            background: color-mix(in srgb, #9aa0a6 70%, transparent);
            border-color: color-mix(in srgb, #b0b5bb 90%, rgba(255,255,255,0.6));
          }
          50% {
            background: color-mix(in srgb, var(--tile-color) 80%, transparent);
            border-color: color-mix(in srgb, var(--tile-color) 95%, rgba(255,255,255,0.8));
          }
        }
        .circle ha-icon {
          width: calc(var(--circle-size) * 0.7);
          height: calc(var(--circle-size) * 0.7);
          --mdc-icon-size: calc(var(--circle-size) * 0.7);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          z-index: 3;
        }
        .badge {
          position: absolute;
          right: -6px;
          bottom: -6px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--tile-color);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        }
        .label-box {
          margin-top: calc(var(--circle-size) / -2);
          width: var(--circle-size);
          min-height: calc(var(--circle-size) * 0.78);
          border-radius: 0 0 8px 8px;
          background: rgba(120, 130, 140, 0.18);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: calc(var(--circle-size) * 0.32) 0 calc(var(--circle-size) * 0.08);
          box-sizing: border-box;
          position: relative;
          z-index: 1;
        }
        .label-box.suppressed {
          opacity: 0.65;
        }
        .label {
          font-size: 14px;
          color: #fff;
          font-weight: 300;
          line-height: 1.1;
          text-shadow: 0 1px 2px rgba(0,0,0,0.35);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          width: 100%;
        }
      </style>
    `;

    this._attachHandlers();
  }

  _attachHandlers() {
    const tiles = this.shadowRoot?.querySelectorAll(".tile") || [];
    tiles.forEach((tileEl) => {
      tileEl.onpointerdown = (ev) => this._onPointerDown(ev, tileEl);
      tileEl.onpointerup = () => this._onPointerUp();
      tileEl.onpointerleave = () => this._onPointerUp();
      tileEl.onpointercancel = () => this._onPointerUp();
      tileEl.onclick = (ev) => this._onClick(ev, tileEl);
    });
  }

  _onPointerDown(event, tileEl) {
    if (this._pressTimer) window.clearTimeout(this._pressTimer);
    this._longPressHandled = false;
    const entityId = tileEl.getAttribute("data-entity");
    const key = tileEl.getAttribute("data-key");
    const tile = this._config.tiles.find((t, index) => this._getTileKey(t, index) === key);
    if (!tile) return;
    if (tile.long_press_enabled === false) return;

    this._pressTimer = window.setTimeout(() => {
      this._pressTimer = null;
      this._longPressHandled = true;
      this._handleLongPress(tile);
    }, 600);
  }

  _onPointerUp() {
    if (this._pressTimer) {
      window.clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
  }

  _onClick(event, tileEl) {
    if (this._longPressHandled) return; // long-press handled

    const entityId = tileEl.getAttribute("data-entity");
    const key = tileEl.getAttribute("data-key");
    const tile = this._config.tiles.find((t, index) => this._getTileKey(t, index) === key);
    if (!tile) return;

    const entities = this._getTileEntities(tile);
    this._handleTap(entities[0], tile.tap_action);
  }

  _handleLongPress(tile) {
    const entityId = tile.entity;
    const stateObj = this._hass?.states?.[entityId];
    const match = this._matchState(tile, stateObj);
    const isWarning = this._isWarning(match, tile);

    if (!isWarning) return;

    this._suppressed[entityId] = {
      active: true,
      state: stateObj?.state,
      ts: Date.now(),
    };
    this._saveSuppressed();
    this._render();
  }
}

customElements.define("status-tiles-card", StatusTilesCard);

class StatusTilesCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
  }

  setConfig(config) {
    this._config = { ...config };
    if (!Array.isArray(this._config.tiles)) {
      this._config.tiles = [];
    }
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _render() {
    if (!this._config) return;

    const tilesJson = JSON.stringify(this._config.tiles || [], null, 2);

    this.innerHTML = `
      <div class="card-config">
        <ha-textfield label="Titel" .value="${this._config.title || ""}"></ha-textfield>
        <ha-textfield label="Min. Spaltenbreite (px)" type="number" .value="${this._config.columns_min || 90}"></ha-textfield>
        <ha-textfield label="Kreisgröße (px)" type="number" .value="${this._config.circle_size || 56}"></ha-textfield>
        <ha-textfield label="Abstand (px)" type="number" .value="${this._config.tile_gap || 12}"></ha-textfield>
        <ha-textfield label="Suppressed Farbe" .value="${this._config.suppressed_color || "#8a8f99"}"></ha-textfield>
        <ha-textfield label="Alarm Sound (global)" .value="${this._config.alarm_sound || ""}"></ha-textfield>
        <ha-textfield label="Alarm Volume (0-1)" type="number" step="0.1" .value="${this._config.alarm_volume ?? ""}"></ha-textfield>
        <ha-switch id="alarm_enabled" ?checked="${this._config.alarm_enabled !== false}"></ha-switch>
        <label for="alarm_enabled">Alarm global aktiv</label>

        <ha-textarea label="Tiles (JSON)" rows="12">${tilesJson}</ha-textarea>
        <div class="hint">Tiles als JSON-Array. Beispiel: [{"entity":"sensor.temp","label":"Haus","states":[{"value":"warn","warning":true,"color":"#ff4d4d"}]}]</div>
      </div>
      <style>
        .card-config {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .hint {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
      </style>
    `;

    this.querySelectorAll("ha-textfield, ha-textarea, ha-switch").forEach((el) => {
      el.addEventListener("change", () => this._handleChange());
    });
  }

  _handleChange() {
    const fields = this.querySelectorAll("ha-textfield");
    const textarea = this.querySelector("ha-textarea");
    const alarmSwitch = this.querySelector("#alarm_enabled");

    const getField = (label) =>
      Array.from(fields).find((el) => el.label === label)?.value ?? "";

    let tiles = this._config.tiles || [];
    try {
      tiles = textarea?.value ? JSON.parse(textarea.value) : [];
    } catch (err) {
      // keep old tiles if JSON invalid
    }

    const newConfig = {
      ...this._config,
      title: getField("Titel"),
      columns_min: Number(getField("Min. Spaltenbreite (px)")) || 90,
      circle_size: Number(getField("Kreisgröße (px)")) || 56,
      tile_gap: Number(getField("Abstand (px)")) || 12,
      suppressed_color: getField("Suppressed Farbe") || "#8a8f99",
      alarm_sound: getField("Alarm Sound (global)"),
      alarm_volume: getField("Alarm Volume (0-1)") === "" ? undefined : Number(getField("Alarm Volume (0-1)")),
      alarm_enabled: alarmSwitch?.checked !== false,
      tiles,
    };

    this._config = newConfig;
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: newConfig },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("status-tiles-card-editor", StatusTilesCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "status-tiles-card",
  name: "Status Tiles Card",
  description: "Dynamische Status-Kacheln mit Warnungen und Alarm-Sound",
  preview: true,
  configurable: true,
});
