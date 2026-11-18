import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DOMParser } from 'linkedom';
import { hoy } from '../periodos.js';

const BASE = 'https://dle.rae.es';
const DATA = new URL('../data/palabras.json', import.meta.url);
const ENTRADAS = new URL('../data/entradas/', import.meta.url);
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
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

const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim() ?? '';

function parseSenses(list) {
    return [...list.querySelectorAll('.c-definitions__item')].map((item) => {
        const content = item.firstElementChild;
        const definition = content.querySelector('.dle24-definition');
        const marks = [];
        for (const child of content.children) {
            if (child === definition) break;
            if (!child.classList.contains('n_acep')) marks.push(text(child));
        }
        return {
            numero: text(content.querySelector('.n_acep')),
            marcas: marks.join(' '),
            definicion: text(definition),
            ejemplos: [...content.querySelectorAll('.c-definitions__item-example')].filter((node) => !node.closest('.e1')).map(text),
            notas: [...content.querySelectorAll('.e1')].map((note) => [...note.children].map(text).join(' ')),
        };
    });
}

function parseEntries(document) {
    return [...document.querySelectorAll('article.o-main__article')].map((article) => {
        article.querySelectorAll('sup').forEach((sup) => {
            sup.textContent = [...sup.textContent.trim()].map((digit) => SUP[digit] ?? digit).join('');
        });
        const parts = [...article.querySelector('section.c-section').children];
        const list = parts.find((node) => node.matches('ol.c-definitions'));
        return {
            lema: text(article.querySelector('.c-page-header__title')),
            etimologia: text(parts.find((node) => node.classList.contains('c-text-intro'))),
            acepciones: list ? parseSenses(list) : [],
            formas: parts.filter((node) => node.classList.contains('fc-definition')).map((form) => ({
                forma: text(form.querySelector('.k5')),
                variantes: text(form.querySelector('.c-text-intro')),
                acepciones: parseSenses(form.querySelector('ol.c-definitions')),
            })),
        };
    });
}

async function fetchEntries(url) {
    const entradas = parseEntries(new DOMParser().parseFromString(await get(url), 'text/html'));
    if (!entradas.length) throw new Error(`${url} -> sin acepciones`);
    return entradas;
}

async function fetchToday(today) {
    for (let attempt = 1; ; attempt++) {
        try {
            const entry = parseWordOfTheDay(await get(BASE));
            if (entry.fecha === today) return entry;
            console.log(`Intento ${attempt}: la RAE todavía muestra la palabra del ${entry.fecha}`);
        } catch (error) {
            console.log(`Intento ${attempt}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
}

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 4)}\n`);
const data = JSON.parse(await readFile(DATA, 'utf8'));
const today = hoy();

if (data.dias.some((dia) => dia.fecha === today)) {
    console.log(`Ya registrada la palabra del ${today}`);
} else {
    const entry = await fetchToday(today);
    data.dias.push(entry);
    data.dias.sort((a, b) => b.fecha.localeCompare(a.fecha));
    console.log(`Añadida: ${entry.fecha} ${entry.palabra}`);
}

await mkdir(ENTRADAS, { recursive: true });
for (const dia of data.dias) {
    const file = new URL(`${dia.fecha}.json`, ENTRADAS);
    if (existsSync(file)) continue;
    try {
        const entradas = await fetchEntries(dia.url);
        dia.definicion ??= entradas[0].acepciones[0]?.definicion ?? '';
        await writeJson(file, { entradas });
        console.log(`Acepciones guardadas: ${dia.fecha} ${dia.palabra}`);
    } catch (error) {
        console.log(`Acepciones de ${dia.palabra}: ${error.message}`);
    }
}

await writeJson(DATA, data);
