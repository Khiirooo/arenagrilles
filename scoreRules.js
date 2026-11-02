// Règles communes de saisie GAF/GAM. Elles restent indépendantes de React.
export function parseNum(value) {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim().replace(",", ".");
  // parseFloat("8abc") retournait 8 : refuser les saisies ambiguës.
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function isValidNumberInput(value) {
  return value == null || String(value).trim() === "" || parseNum(value) !== null;
}

function validFinite(n) {
  return typeof n === "number" && Number.isFinite(n);
}

export function checkCell(cell, division) {
  if (!division) return "Division inconnue";
  if (!cell || typeof cell !== "object") return "Notes manquantes";
  if (division.mode !== "DE" && division.mode !== "single")
    return "Mode de notation inconnu";
  const count = Number(division.judges);
  if (!Number.isInteger(count) || count < 1 || count > 20)
    return "Nombre de juges invalide";
  const ceiling = Number(division.start);
  if (!Number.isFinite(ceiling) || ceiling <= 0)
    return "Barème invalide";

  if (division.mode === "DE") {
    if (!validFinite(cell.d) || cell.d < 0) return "Note D manquante ou invalide";
    for (let j = 1; j <= count; j++) {
      const n = cell.e?.[j];
      if (!validFinite(n)) return `Note E du juge ${j} manquante`;
      if (n < 0 || n > ceiling) return `E du juge ${j} hors 0–${ceiling}`;
    }
  } else {
    for (let j = 1; j <= count; j++) {
      const n = cell.notes?.[j];
      if (!validFinite(n)) return `Note du juge ${j} manquante`;
      if (n < 0 || n > ceiling) return `Note du juge ${j} hors 0–${ceiling}`;
    }
  }

  if (cell.pen != null && (!validFinite(cell.pen) || cell.pen < 0 || cell.pen > 5))
    return "Pénalité hors 0–5";
  if (division.bonus && cell.bonus != null &&
    (!validFinite(cell.bonus) || Math.abs(cell.bonus) > ceiling))
    return "Bonus / malus invalide";
  return null;
}
