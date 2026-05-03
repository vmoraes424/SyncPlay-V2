const DAY_SECONDS = 86_400;

export function normalizeSecondsOfDay(seconds: number) {
  if (!Number.isFinite(seconds)) return 0;
  return ((Math.floor(seconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
}

export function formatSecondsOfDay(seconds: number, showSeconds = true) {
  const secondsOfDay = normalizeSecondsOfDay(seconds);
  const hours = Math.floor(secondsOfDay / 3600);
  const minutes = Math.floor((secondsOfDay % 3600) / 60);
  const secs = secondsOfDay % 60;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  return showSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

/** HH:MM:SS (mesmo padrão usado no tempo restante da playlist). */
export function formatTimeRemaining(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "00:00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function parseTimeToSeconds(input: string) {
  const parts = input.trim().split(':');
  const parse = (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`Valor de horário inválido: ${input}`);
    }
    return parsed;
  };

  let seconds: number;
  if (parts.length === 3) {
    seconds = parse(parts[0]) * 3600 + parse(parts[1]) * 60 + parse(parts[2]);
  } else if (parts.length === 2) {
    seconds = parse(parts[0]) * 3600 + parse(parts[1]) * 60;
  } else if (parts.length === 1) {
    seconds = parse(parts[0]);
  } else {
    throw new Error(`Formato de horário inválido: ${input}`);
  }

  return normalizeSecondsOfDay(seconds);
}
