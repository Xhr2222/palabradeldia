import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://dle.rae.es';
const DATA = new URL('../data/palabras.json', import.meta.url);
const HEADERS = {
    'User-Agent': 'palabra-del-dia/1.0',
    'Accept-Language': 'es-ES,es;q=0.9',
};
const RETRY_MS = 60000;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»' };

function decode(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
        .trim();
}

async function get(url) {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.text();
}

function parseWordOfTheDay(html) {
    const subtitle = html.match(/class="c-word-day__subtitle">[^<]*?(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
    const anchor = html.match(/<a[^>]*class="c-word-day__link"[^>]*>/i);
    const word = html.match(/class="c-word-day__word">([^<]+)</i);
    if (!subtitle || !anchor || !word) throw new Error('No se encontró la palabra del día en dle.rae.es');

    const month = MESES.indexOf(subtitle[2].toLowerCase().replace('setiembre', 'septiembre')) + 1;
    if (month === 0) throw new Error(`Mes desconocido: ${subtitle[2]}`);

    const href = anchor[0].match(/href="([^"]+)"/i)[1];
    const url = new URL(decode(href), BASE);
    url.search = '';

    return {
        fecha: `${subtitle[3]}-${String(month).padStart(2, '0')}-${subtitle[1].padStart(2, '0')}`,
        palabra: decode(word[1]),
        url: url.toString(),
    };
}

async function fetchDefinition(url) {
    const html = await get(url);
    const meta = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
    if (!meta) return '';
    return decode(meta[1]).replace(/^Definición RAE de «[^»]*» según el Diccionario de la lengua española:\s*/, '');
}

async function fetchToday(today) {
    for (let attempt = 1; ; attempt++) {
        try {
            const entry = parseWordOfTheDay(await get(BASE));
            if (entry.fecha === today) {
                entry.definicion = await fetchDefinition(entry.url);
                return entry;
            }
            console.log(`Intento ${attempt}: la RAE todavía muestra la palabra del ${entry.fecha}`);
        } catch (error) {
            console.log(`Intento ${attempt}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
}

const data = JSON.parse(await readFile(DATA, 'utf8'));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

if (data.dias.some((dia) => dia.fecha === today)) {
    console.log(`Ya registrada la palabra del ${today}`);
    process.exit(0);
}

const entry = await fetchToday(today);
data.dias.push(entry);
data.dias.sort((a, b) => b.fecha.localeCompare(a.fecha));

await writeFile(DATA, `${JSON.stringify(data, null, 4)}\n`);
console.log(`Añadida: ${entry.fecha} ${entry.palabra}`);
