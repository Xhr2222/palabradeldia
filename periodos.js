export const DAY = 86400000;

export const toDate = (iso) => new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);

export const toIso = (date) => date.toISOString().slice(0, 10);

export const voteId = (voto) => `${voto.tipo}_${voto.periodo}_${voto.usuario}`;

export function periodKey(tipo, iso) {
    if (tipo === 'mes') return iso.slice(0, 7);
    const date = toDate(iso);
    return toIso(new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY));
}

export function periodEnd(tipo, periodo) {
    const start = toDate(periodo);
    return tipo === 'semana'
        ? new Date(start.getTime() + 7 * DAY)
        : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}
