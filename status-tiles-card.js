class StatusTilesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._pressTimer = null;
    this._longPressHandled = false;
    this._dateExpiryTimer = null;
    this._suppressed = this._loadSuppressed();
    this._lastWarningStates = {};
    this._onListRequest = (event) => {
      for (const tile of this._config?.tiles || []) {
        if (tile.list_id === event.detail.source) {
          event.detail.providers.push({ card: this, tile });
        }
      }
    };
  }

  connectedCallback() {
    document.addEventListener("status-tiles-list-request", this._onListRequest);
    this._notifyLists();
  }

  disconnectedCallback() {
    document.removeEventListener("status-tiles-list-request", this._onListRequest);
    this._onPointerUp();
    if (this._dateExpiryTimer) {
      window.clearTimeout(this._dateExpiryTimer);
      this._dateExpiryTimer = null;
    }
    this._notifyLists();
  }

  _notifyLists() {
    document.dispatchEvent(new CustomEvent("status-tiles-list-changed"));
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.tiles)) {
      throw new Error("Status Tiles Card: 'tiles' array is required.");
    }
    const listIds = new Set();
    for (const tile of config.tiles) {
      if (tile.list_id != null) {
        if (typeof tile.list_id !== "string" || !tile.list_id.trim() || listIds.has(tile.list_id)) {
          throw new Error("Status Tiles Card: 'list_id' must be a non-empty, unique string.");
        }
        listIds.add(tile.list_id);
      }
      if (tile.exclude != null && (!Array.isArray(tile.exclude) ||
          tile.exclude.some((word) => typeof word !== "string" || !word.trim()))) {
        throw new Error("Status Tiles Card: 'exclude' must be an array of non-empty strings.");
      }
      if (tile.long_press_action != null) {
        const longPressEntity = tile.long_press_entity;
        const hasValidSwitchEntity =
          typeof longPressEntity === "string" &&
          longPressEntity.slice(0, "switch.".length) === "switch." &&
          longPressEntity.length > "switch.".length;
        if (tile.long_press_action !== "turn_on" || !hasValidSwitchEntity) {
          throw new Error(
            "Status Tiles Card: 'long_press_action: turn_on' requires a 'long_press_entity' in the switch domain."
          );
        }
      }
      if (tile.states?.some((rule) =>
        rule?.date_within_days != null &&
        (typeof rule.date_within_days !== "number" ||
         !Number.isFinite(rule.date_within_days) ||
         rule.date_within_days <= 0)
      )) {
        throw new Error(
          "Status Tiles Card: 'date_within_days' must be a positive number."
        );
      }
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
    if (this.isConnected) this._notifyLists();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    this._render();
    if (this.isConnected) this._notifyLists();
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

  _parseStateTimestamp(rawState) {
    const match = String(rawState).match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/
    );
    if (!match) return null;
    const normalized = match[1].replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  _matchState(tile, stateObj, entityId = stateObj?.entity_id) {
    if (!stateObj || !tile.states) return tile.default || null;

    const rawState = stateObj.state;
    const numericState = Number.parseFloat(rawState);
    const hasNumeric = !Number.isNaN(numericState);

    for (const rule of tile.states) {
      if (rule == null) continue;

      if (rule.entity_id_regex) {
        try {
          if (!entityId || !new RegExp(rule.entity_id_regex).test(entityId)) continue;
        } catch (err) {
          continue;
        }
      }

      if (typeof rule.date_within_days === "number") {
        const timestamp = this._parseStateTimestamp(rawState);
        const age = timestamp === null ? -1 : Date.now() - timestamp;
        if (age >= 0 && age <= rule.date_within_days * 86400000) return rule;
      }

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
    return this._getSelectedEntities(tile).filter((entityId) => {
      const name = this._hass?.states?.[entityId]?.attributes?.friendly_name || "";
      const text = `${entityId} ${name}`.toLowerCase();
      return !(tile.exclude || []).some((pattern) => {
        const glob = pattern
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*");
        return new RegExp(glob, "i").test(text);
      });
    });
  }

  _getWarningEntities(tile) {
    return this._getTileEntities(tile).filter((entityId) => {
      const stateObj = this._hass?.states?.[entityId];
      return stateObj && this._isWarning(this._matchState(tile, stateObj, entityId), tile);
    });
  }

  _getSelectedEntities(tile) {
    if (Array.isArray(tile.entities) && tile.entities.length) return tile.entities;
    if (tile.entity) return [tile.entity];

    const filters = Array.isArray(tile.entity_filters) ? tile.entity_filters : [];
    if (!filters.length || !this._hass?.states) return [];

    const entities = Object.keys(this._hass.states);
    const matchesFilter = (entityId, filter) => {
      const stateObj = this._hass.states[entityId];
      const domain = entityId.split(".")[0];

      if (filter.domain && filter.domain !== domain) return false;
      if (filter.device_class &&
          filter.device_class !== stateObj?.attributes?.device_class) return false;

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
    if (this._dateExpiryTimer) {
      window.clearTimeout(this._dateExpiryTimer);
      this._dateExpiryTimer = null;
    }

    const { columns_min, circle_size, tile_gap, suppressed_color, tiles } =
      this._config;
    const scaledCircleSize = Math.round(circle_size * 1.45);
    const scaledGap = Math.min(5, Math.max(2, Math.round(tile_gap * 0.35)));
    const scaledRowGap = Math.max(28, Math.round(scaledCircleSize * 0.4));
    const now = Date.now();
    let nextDateExpiry = null;

    const tileHtml = tiles
      .map((tile, index) => {
        const key = this._getTileKey(tile, index);
        const entities = this._getTileEntities(tile);
        const primaryEntityId = entities[0] || "";

        let warningCount = 0;
        let match = null;
        let warningMatch = null;
        let warningPriority = Infinity;
        let firstStateObj = null;

        entities.forEach((entityId, entityIndex) => {
          const stateObj = this._hass?.states?.[entityId];
          if (entityIndex === 0) firstStateObj = stateObj;
          for (const rule of tile.states || []) {
            if (typeof rule?.date_within_days !== "number") continue;
            const timestamp = this._parseStateTimestamp(stateObj?.state);
            if (timestamp === null || timestamp > now) continue;
            const expiry = timestamp + rule.date_within_days * 86400000 + 1;
            if (expiry > now && (nextDateExpiry === null || expiry < nextDateExpiry)) {
              nextDateExpiry = expiry;
            }
          }
          const entityMatch = this._matchState(tile, stateObj, entityId);
          if (entityIndex === 0) match = entityMatch;
          if (this._isWarning(entityMatch, tile)) {
            warningCount += 1;
            if (entityMatch) {
              const ruleIndex = tile.states?.indexOf(entityMatch) ?? -1;
              const priority = ruleIndex < 0 ? Infinity : ruleIndex;
              if (!warningMatch || priority < warningPriority) {
                warningMatch = entityMatch;
                warningPriority = priority;
              }
            }
          }
        });
        if (warningMatch) match = warningMatch;

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

        const showBadge = warningCount > 2 || (tile.list_id && warningCount > 0);

        return `
          <div class="tile" data-index="${index}" data-entity="${primaryEntityId}" data-key="${key}" style="--tile-color: ${color}; --circle-max-size: ${scaledCircleSize}px;${shouldBlink ? ` --blink-duration: ${blinkSeconds}s;` : ""}">
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
          column-gap: ${scaledGap}px;
          row-gap: ${scaledRowGap}px;
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
    if (nextDateExpiry !== null && this.isConnected) {
      this._dateExpiryTimer = window.setTimeout(() => {
        this._dateExpiryTimer = null;
        this._render();
        this._notifyLists();
      }, Math.min(nextDateExpiry - Date.now(), 2147483647));
    }
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
    tileEl.dataset.longPressHandled = "false";
    const tile = this._config.tiles[Number(tileEl.getAttribute("data-index"))];
    if (!tile) return;
    if (tile.long_press_enabled === false) return;

    this._pressTimer = window.setTimeout(() => {
      this._pressTimer = null;
      tileEl.dataset.longPressHandled = "true";
      this._handleLongPress(tile);
    }, 1000);
  }

  _onPointerUp() {
    if (this._pressTimer) {
      window.clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
  }

  _onClick(event, tileEl) {
    if (tileEl.dataset.longPressHandled === "true") {
      tileEl.dataset.longPressHandled = "false";
      return;
    }

    const tile = this._config.tiles[Number(tileEl.getAttribute("data-index"))];
    if (!tile) return;

    const entities = this._getTileEntities(tile);
    this._handleTap(entities[0] || tile.entity, tile.tap_action);
  }

  _handleLongPress(tile) {
    if (tile.long_press_action === "turn_on") {
      this._hass.callService("switch", "turn_on", {
        entity_id: tile.long_press_entity,
      }).then(
        () => this._notify("Einschaltbefehl an Zigbee2MQTT gesendet."),
        (error) => {
          console.error(
            `Status Tiles Card: could not turn on ${tile.long_press_entity}.`,
            error
          );
          this._notify("Zigbee2MQTT konnte nicht eingeschaltet werden.");
        }
      );
      return;
    }

    const entityId = tile.entity;
    const stateObj = this._hass?.states?.[entityId];
    const match = this._matchState(tile, stateObj, entityId);
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

  _notify(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        detail: { message },
        bubbles: true,
        composed: true,
      })
    );
  }
}

customElements.define("status-tiles-card", StatusTilesCard);

class StatusTilesList extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onSourceChanged = () => this._render();
  }

  connectedCallback() {
    document.addEventListener("status-tiles-list-changed", this._onSourceChanged);
    this._render();
  }

  disconnectedCallback() {
    document.removeEventListener("status-tiles-list-changed", this._onSourceChanged);
  }

  setConfig(config) {
    if (typeof config.source !== "string" || !config.source.trim()) {
      throw new Error("Status Tiles List: 'source' must match a tile's 'list_id'.");
    }
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  _render() {
    if (!this._config || !this.isConnected) return;
    const detail = { source: this._config.source, providers: [] };
    document.dispatchEvent(new CustomEvent("status-tiles-list-request", { detail }));
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 16px; }
        h2 { margin: 0 0 12px; font-size: 20px; }
        p { color: var(--secondary-text-color); }
        button {
          display: flex; align-items: center; gap: 12px; width: 100%;
          padding: 12px 0; border: 0; background: none;
          color: var(--primary-text-color); font: inherit;
          text-align: left; cursor: pointer;
        }
        .name { flex: 1; overflow-wrap: anywhere; }
        .state { color: var(--secondary-text-color); }
      </style>
      <ha-card><h2></h2><div class="rows"></div></ha-card>
    `;
    const title = this.shadowRoot.querySelector("h2");
    const rows = this.shadowRoot.querySelector(".rows");
    title.textContent = this._config.title || "Betroffene Entities";
    const message = (text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      rows.append(paragraph);
    };
    if (detail.providers.length !== 1) {
      message(detail.providers.length
        ? `Mehrere Kacheln mit list_id "${this._config.source}". Bitte eindeutige IDs verwenden.`
        : `Keine Kachel mit list_id "${this._config.source}" in dieser Ansicht gefunden.`);
      return;
    }
    const { card, tile } = detail.providers[0];
    if (!card._hass || !this._hass) {
      message("Entity-Zust\u00e4nde sind noch nicht verf\u00fcgbar.");
      return;
    }
    if (!card._getTileEntities(tile).length) {
      message("Keine passenden Sensoren gefunden.");
      return;
    }
    const entities = card._getWarningEntities(tile);
    title.textContent += ` (${entities.length})`;
    if (!entities.length) {
      message("Keine Warnungen vorhanden.");
      return;
    }
    for (const entityId of entities) {
      const stateObj = card._hass.states[entityId];
      const row = document.createElement("button");
      row.type = "button";
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", stateObj.attributes.icon || tile.icon || "mdi:alert-circle-outline");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = stateObj.attributes.friendly_name || entityId;
      const state = document.createElement("span");
      state.className = "state";
      state.textContent = this._hass.formatEntityState
        ? this._hass.formatEntityState(stateObj)
        : `${stateObj.state} ${stateObj.attributes.unit_of_measurement || ""}`.trim();
      row.append(icon, name, state);
      row.onclick = () => this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId }, bubbles: true, composed: true,
      }));
      rows.append(row);
    }
  }
}

customElements.define("status-tiles-list", StatusTilesList);

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
window.customCards.push({
  type: "status-tiles-list",
  name: "Status Tiles Warning List",
  description: "Warnungen einer Status-Kachel, ohne doppelte Filter",
  preview: false,
});
