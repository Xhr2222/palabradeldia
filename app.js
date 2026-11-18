import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { collection, doc, getFirestore, onSnapshot, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { DAY, hoy, periodEnd, periodKey, toDate, toIso, voteId } from './periodos.js';

const db = getFirestore(initializeApp(firebaseConfig));
const USER_KEY = 'palabra-del-dia:usuario';
const TITULOS = { semana: 'Palabra de la semana', mes: 'Palabra del mes' };
const VOTOS = { semana: 'Votos semanales', mes: 'Votos mensuales' };
const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

const format = (options) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...options });
const monthFormat = format({ month: 'long', year: 'numeric' });
const monthNameFormat = format({ month: 'long' });
const dateFormat = format({ day: 'numeric', month: 'short', year: 'numeric' });
const longFormat = format({ dateStyle: 'full' });
const shortFormat = format({ day: 'numeric', month: 'short' });
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const state = { dias: [], usuarios: [], archivados: [], vivos: [], usuario: null, pendiente: null, busqueda: '', detalle: null };
const entryCache = new Map();

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function wordLink(dia, className = '') {
    return el('a', { href: dia.url, target: '_blank', rel: 'noopener', className, textContent: dia.palabra });
}

function wordButton(dia, onClick = () => showDay(dia)) {
    const button = el('button', { type: 'button', className: 'word-button', textContent: dia.palabra, title: dia.palabra });
    button.addEventListener('click', onClick);
    return button;
}

function periodLabel(tipo, periodo) {
    if (tipo === 'mes') return monthFormat.format(toDate(periodo));
    const last = new Date(toDate(periodo).getTime() + 6 * DAY);
    return `Del ${shortFormat.format(toDate(periodo))} al ${shortFormat.format(last)}`;
}

function closesIn(end) {
    const diff = end.getTime() - Date.now();
    return diff >= DAY
        ? relative.format(Math.floor(diff / DAY), 'day')
        : relative.format(Math.max(1, Math.ceil(diff / 3600000)), 'hour');
}

function allVotes() {
    const votos = new Map(state.archivados.map((voto) => [voteId(voto), voto]));
    state.vivos.forEach((voto) => votos.set(voteId(voto), voto));
    return [...votos.values()];
}

function results(tipo, periodo, votos) {
    return state.dias
        .filter((dia) => periodKey(tipo, dia.fecha) === periodo)
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((dia) => ({
            dia,
            usuarios: votos
                .filter((v) => v.tipo === tipo && v.periodo === periodo && v.palabra === dia.palabra)
                .map((v) => v.usuario)
                .sort((a, b) => a.localeCompare(b, 'es')),
        }));
}

function outcome(tipo, periodo, votos) {
    const rows = results(tipo, periodo, votos);
    if (!rows.length) return [];
    if (periodEnd(tipo, periodo).getTime() > Date.now()) return [el('span', { className: 'muted', textContent: 'En curso' })];
    const max = Math.max(...rows.map((row) => row.usuarios.length));
    if (!max) return [el('span', { className: 'muted', textContent: 'Sin votos' })];
    return [
        el('strong', { textContent: rows.filter((row) => row.usuarios.length === max).map((row) => row.dia.palabra).join(' / ') }),
        el('span', { className: 'count', textContent: `${max} ${max === 1 ? 'voto' : 'votos'}` }),
    ];
}

async function vote(tipo, periodo, palabra) {
    if (!state.usuario) {
        state.pendiente = () => vote(tipo, periodo, palabra);
        askUser();
        return;
    }
    try {
        await setDoc(doc(db, 'votos', voteId({ tipo, periodo, usuario: state.usuario })), {
            tipo,
            periodo,
            usuario: state.usuario,
            palabra,
            fecha: serverTimestamp(),
        });
    } catch {
        alert('No se ha podido registrar el voto. Puede que la votación ya esté cerrada.');
    }
}

function askUser() {
    $('usuarios').replaceChildren(...state.usuarios.map((nombre) => el('button', {
        value: nombre,
        textContent: nombre,
        className: nombre === state.usuario ? 'selected' : '',
    })));
    $('quien').returnValue = '';
    $('quien').showModal();
}

function renderUser() {
    const button = el('button', { type: 'button', className: 'link', textContent: state.usuario ? 'Cambiar' : '¿Quién eres?' });
    button.addEventListener('click', askUser);
    $('yo').replaceChildren(...(state.usuario ? [el('span', { textContent: state.usuario })] : []), button);
}

function loadEntries(dia) {
    if (!entryCache.has(dia.fecha)) {
        entryCache.set(dia.fecha, fetch(`data/entradas/${dia.fecha}.json`)
            .then((response) => (response.ok ? response.json() : { entradas: [] }))
            .then((data) => data.entradas)
            .catch(() => []));
    }
    return entryCache.get(dia.fecha);
}

function senseList(acepciones) {
    return el('ol', { className: 'senses' }, acepciones.map((acepcion) => el('li', {}, [
        el('span', { className: 'sense-num', textContent: acepcion.numero }),
        el('div', {}, [
            el('p', {}, [
                ...(acepcion.marcas ? [el('span', { className: 'marks', textContent: acepcion.marcas }), ' '] : []),
                acepcion.definicion,
            ]),
            ...acepcion.ejemplos.map((ejemplo) => el('p', { className: 'example', textContent: ejemplo })),
            ...acepcion.notas.map((nota) => el('p', { className: 'note', textContent: nota })),
        ]),
    ])));
}

function entryNodes(entradas) {
    return entradas.map((entrada) => el('section', { className: 'entry' }, [
        ...(entradas.length > 1 ? [el('h3', { className: 'lemma', textContent: entrada.lema })] : []),
        ...(entrada.etimologia ? [el('p', { className: 'etymology', textContent: entrada.etimologia })] : []),
        senseList(entrada.acepciones),
        ...(entrada.formas.length ? [el('details', { className: 'forms' }, [
            el('summary', { textContent: `Formas complejas (${entrada.formas.length})` }),
            ...entrada.formas.map((forma) => el('div', { className: 'form' }, [
                el('h4', { textContent: forma.forma }),
                ...(forma.variantes ? [el('p', { className: 'variants', textContent: forma.variantes })] : []),
                senseList(forma.acepciones),
            ])),
        ])] : []),
    ]));
}

function meaning(dia) {
    const container = el('div', { className: 'meaning' }, [el('p', { textContent: dia.definicion ?? '' })]);
    loadEntries(dia).then((entradas) => {
        if (entradas.length) container.replaceChildren(...entryNodes(entradas));
    });
    return container;
}

function renderToday() {
    const dia = state.dias[0];
    if (!dia) return;
    const key = `${dia.fecha}|${dia.fecha === hoy()}`;
    if ($('hoy').dataset.key === key) return;
    $('hoy').dataset.key = key;
    $('hoy').replaceChildren(
        el('p', { className: 'label', textContent: longFormat.format(toDate(dia.fecha)) }),
        wordLink(dia, 'word'),
        meaning(dia),
        ...(dia.fecha === hoy() ? [] : [el('p', { className: 'pending', textContent: 'La palabra de hoy aún no está disponible.' })]),
    );
    $('hoy').hidden = false;
}

function renderVote(tipo) {
    const periodo = periodKey(tipo, hoy());
    const rows = results(tipo, periodo, allVotes());
    const total = rows.reduce((sum, row) => sum + row.usuarios.length, 0);

    const options = rows
        .sort((a, b) => b.usuarios.length - a.usuarios.length || a.dia.fecha.localeCompare(b.dia.fecha))
        .map(({ dia, usuarios }) => {
            const fill = el('span', { className: 'fill' });
            fill.style.width = `${total ? (usuarios.length / total) * 100 : 0}%`;
            const option = el('button', { type: 'button', className: usuarios.includes(state.usuario) ? 'option selected' : 'option', title: dia.definicion ?? '' }, [
                el('span', { className: 'option-head' }, [
                    el('strong', { textContent: dia.palabra }),
                    el('span', { className: 'count', textContent: String(usuarios.length) }),
                ]),
                el('span', { className: 'bar' }, [fill]),
                ...(usuarios.length ? [el('span', { className: 'voters', textContent: usuarios.join(', ') })] : []),
            ]);
            option.addEventListener('click', () => vote(tipo, periodo, dia.palabra));
            return option;
        });

    $(`voto-${tipo}`).replaceChildren(
        el('header', { className: 'vote-head' }, [
            el('h2', { textContent: TITULOS[tipo] }),
            el('p', { className: 'muted', textContent: `${periodLabel(tipo, periodo)} · cierra ${closesIn(periodEnd(tipo, periodo))}` }),
        ]),
        options.length
            ? el('div', { className: 'options' }, options)
            : el('p', { className: 'muted', textContent: 'Todavía no hay palabras en este periodo.' }),
    );
}

function route() {
    const [tab, arg = ''] = location.hash.slice(1).split('/');
    return tab === 'calendario' ? { tab, arg } : { tab: 'inicio', arg: '' };
}

function firstMonth() {
    return state.dias.at(-1)?.fecha.slice(0, 7) ?? hoy().slice(0, 7);
}

function shiftMonth(mes, n) {
    const date = toDate(mes);
    return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1))).slice(0, 7);
}

function navLink(text, target, enabled) {
    return enabled
        ? el('a', { href: `#calendario/${target}`, className: 'nav', textContent: text })
        : el('span', { className: 'nav disabled', textContent: text });
}

function renderDayVotes(dia) {
    const votos = allVotes();
    $('detalle-votos').replaceChildren(...['semana', 'mes'].map((tipo) => {
        const periodo = periodKey(tipo, dia.fecha);
        const usuarios = results(tipo, periodo, votos).find((row) => row.dia === dia)?.usuarios ?? [];
        const children = [el('span', { className: 'muted', textContent: `${VOTOS[tipo]}: ${usuarios.length ? usuarios.join(', ') : 'ninguno'}` })];
        if (periodEnd(tipo, periodo).getTime() > Date.now()) {
            const elegida = usuarios.includes(state.usuario);
            const button = el('button', {
                type: 'button',
                className: elegida ? 'vote-button selected' : 'vote-button',
                textContent: elegida ? `Tu ${TITULOS[tipo].toLowerCase()}` : `Votar como ${TITULOS[tipo].toLowerCase()}`,
            });
            button.addEventListener('click', () => vote(tipo, periodo, dia.palabra));
            children.push(button);
        }
        return el('p', { className: 'day-vote' }, children);
    }));
}

function showDay(dia) {
    state.detalle = dia;
    $('detalle-contenido').replaceChildren(
        el('p', { className: 'label', textContent: longFormat.format(toDate(dia.fecha)) }),
        wordLink(dia, 'word'),
        meaning(dia),
    );
    renderDayVotes(dia);
    $('detalle').showModal();
}

function renderMonth(mes) {
    const votos = allVotes();
    const today = hoy();
    const next = shiftMonth(mes, 1);
    const porFecha = new Map(state.dias.map((dia) => [dia.fecha, dia]));
    const cells = [
        ...DIAS_SEMANA.map((nombre) => el('span', { className: 'weekday', textContent: nombre })),
        el('span', { className: 'weekday week-head', textContent: 'Semana' }),
    ];

    for (let lunes = toDate(periodKey('semana', `${mes}-01`)); toIso(lunes) < `${next}-01`; lunes = new Date(lunes.getTime() + 7 * DAY)) {
        for (let i = 0; i < 7; i++) {
            const fecha = toIso(new Date(lunes.getTime() + i * DAY));
            const dia = porFecha.get(fecha);
            const className = ['day', fecha.startsWith(mes) ? '' : 'out', fecha === today ? 'today' : ''].filter(Boolean).join(' ');
            cells.push(el('div', { className }, [
                el('span', { className: 'num', textContent: String(Number(fecha.slice(8))) }),
                ...(dia ? [wordButton(dia)] : []),
            ]));
        }
        const semana = outcome('semana', toIso(lunes), votos);
        cells.push(el('div', { className: 'week' }, semana.length ? [el('span', { className: 'week-label', textContent: 'Semana' }), ...semana] : []));
    }

    const ganador = outcome('mes', mes, votos);
    $('calendario').replaceChildren(
        el('header', { className: 'cal-head' }, [
            navLink('‹', shiftMonth(mes, -1), mes > firstMonth()),
            el('h2', {}, [el('a', { href: `#calendario/${mes.slice(0, 4)}`, textContent: monthFormat.format(toDate(mes)) })]),
            navLink('›', next, next <= today.slice(0, 7)),
        ]),
        ...(ganador.length ? [el('p', { className: 'cal-summary' }, [el('span', { textContent: TITULOS.mes }), ...ganador])] : []),
        el('div', { className: 'calendar' }, cells),
    );
}

function renderYear(year) {
    const votos = allVotes();
    const actual = hoy().slice(0, 7);
    const cards = Array.from({ length: 12 }, (_, i) => {
        const mes = `${year}-${String(i + 1).padStart(2, '0')}`;
        const palabras = state.dias.some((dia) => dia.fecha.startsWith(mes));
        const children = [
            el('span', { className: 'name', textContent: monthNameFormat.format(toDate(mes)) }),
            ...(palabras ? outcome('mes', mes, votos) : [el('span', { className: 'muted', textContent: 'Sin palabras' })]),
        ];
        return palabras || mes === actual
            ? el('a', { href: `#calendario/${mes}`, className: 'card month-card' }, children)
            : el('span', { className: 'card month-card empty' }, children);
    });

    $('calendario').replaceChildren(
        el('header', { className: 'cal-head' }, [
            navLink('‹', year - 1, year - 1 >= Number(firstMonth().slice(0, 4))),
            el('h2', { textContent: String(year) }),
            navLink('›', year + 1, year + 1 <= Number(actual.slice(0, 4))),
        ]),
        el('div', { className: 'year' }, cards),
    );
}

function renderSearch() {
    const q = state.busqueda.trim().toLocaleLowerCase('es');
    const matches = (text) => (text ?? '').toLocaleLowerCase('es').includes(q);
    const dias = state.dias.filter((dia) => matches(dia.palabra) || matches(dia.definicion));
    const open = (dia) => () => {
        state.busqueda = '';
        $('buscar').value = '';
        location.hash = `calendario/${dia.fecha.slice(0, 7)}`;
        renderCalendar();
        showDay(dia);
    };

    $('calendario').replaceChildren(dias.length
        ? el('ul', { className: 'days' }, dias.map((dia) => el('li', {}, [
            el('time', { dateTime: dia.fecha, textContent: dateFormat.format(toDate(dia.fecha)) }),
            el('div', {}, [wordButton(dia, open(dia)), el('p', { textContent: dia.definicion ?? '' })]),
        ])))
        : el('p', { className: 'muted', textContent: 'No hay resultados.' }));
}

function renderCalendar() {
    const { arg } = route();
    if (state.busqueda.trim()) renderSearch();
    else if (/^\d{4}$/.test(arg)) renderYear(Number(arg));
    else renderMonth(/^\d{4}-\d{2}$/.test(arg) ? arg : hoy().slice(0, 7));
}

function render() {
    renderUser();
    renderToday();
    renderVote('semana');
    renderVote('mes');
    renderCalendar();
    if ($('detalle').open) renderDayVotes(state.detalle);
}

function showTab() {
    const { tab } = route();
    document.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${tab}`; });
    document.querySelectorAll('.tabs a').forEach((link) => link.classList.toggle('active', link.hash === `#${tab}`));
}

function subscribe() {
    const today = hoy();
    const monthStart = toDate(periodKey('mes', today));
    const periodos = [
        periodKey('semana', today),
        periodKey('semana', toIso(new Date(toDate(today).getTime() - 7 * DAY))),
        periodKey('mes', today),
        periodKey('mes', toIso(new Date(monthStart.getTime() - DAY))),
    ];

    onSnapshot(query(collection(db, 'votos'), where('periodo', 'in', periodos)), (snapshot) => {
        state.vivos = snapshot.docs.map((d) => d.data());
        $('estado').hidden = true;
        render();
    }, () => {
        $('estado').textContent = 'No se han podido cargar los votos.';
        $('estado').hidden = false;
    });
}

const load = async (path) => (await fetch(path, { cache: 'no-store' })).json();
const [palabras, usuarios, votos] = await Promise.all([
    load('data/palabras.json'),
    load('data/usuarios.json'),
    load('data/votos.json'),
]);

state.dias = palabras.dias;
state.usuarios = usuarios;
state.archivados = votos.votos;
state.usuario = usuarios.includes(localStorage.getItem(USER_KEY)) ? localStorage.getItem(USER_KEY) : null;

$('quien').addEventListener('close', () => {
    const nombre = $('quien').returnValue;
    const pendiente = state.pendiente;
    state.pendiente = null;
    if (!state.usuarios.includes(nombre)) return;
    state.usuario = nombre;
    localStorage.setItem(USER_KEY, nombre);
    render();
    pendiente?.();
});

$('buscar').addEventListener('input', (event) => {
    state.busqueda = event.target.value;
    renderCalendar();
});

window.addEventListener('hashchange', () => {
    showTab();
    renderCalendar();
});
setInterval(render, 60000);

showTab();
render();
subscribe();
