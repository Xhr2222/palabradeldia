import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js';
import { collection, doc, getFirestore, onSnapshot, query, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { DAY, periodEnd, periodKey, toDate, toIso, voteId } from './periodos.js';

const db = getFirestore(initializeApp(firebaseConfig));
const USER_KEY = 'palabra-del-dia:usuario';
const TABS = ['inicio', 'historial', 'palabras'];
const TITULOS = { semana: 'Palabra de la semana', mes: 'Palabra del mes' };

const format = (options) => new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...options });
const monthFormat = format({ month: 'long', year: 'numeric' });
const dayFormat = format({ weekday: 'short', day: 'numeric' });
const longFormat = format({ dateStyle: 'full' });
const shortFormat = format({ day: 'numeric', month: 'short' });
const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const state = { dias: [], usuarios: [], archivados: [], vivos: [], usuario: null, pendiente: null, busqueda: '' };

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function wordLink(dia, className = '') {
    return el('a', { href: dia.url, target: '_blank', rel: 'noopener', className, textContent: dia.palabra });
}

function periodLabel(tipo, periodo) {
    if (tipo === 'mes') return monthFormat.format(toDate(periodo));
    const last = new Date(periodEnd(tipo, periodo).getTime() - DAY);
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

function renderToday() {
    const dia = state.dias[0];
    if (!dia) return;
    $('hoy').replaceChildren(
        el('p', { className: 'label', textContent: longFormat.format(toDate(dia.fecha)) }),
        wordLink(dia, 'word'),
        el('p', { textContent: dia.definicion ?? '' }),
    );
    $('hoy').hidden = false;
}

function renderVote(tipo) {
    const periodo = periodKey(tipo, toIso(new Date()));
    const rows = results(tipo, periodo, allVotes());
    const total = rows.reduce((sum, row) => sum + row.usuarios.length, 0);

    const options = rows.map(({ dia, usuarios }) => {
        const fill = el('span', { className: 'fill' });
        fill.style.width = `${total ? (usuarios.length / total) * 100 : 0}%`;
        const option = el('button', { type: 'button', className: usuarios.includes(state.usuario) ? 'option selected' : 'option' }, [
            el('span', { className: 'option-head' }, [
                el('strong', { textContent: dia.palabra }),
                el('span', { className: 'count', textContent: String(usuarios.length) }),
            ]),
            el('span', { className: 'definition', textContent: dia.definicion ?? '' }),
            el('span', { className: 'bar' }, [fill]),
            el('span', { className: 'voters', textContent: usuarios.join(', ') }),
        ]);
        option.addEventListener('click', () => vote(tipo, periodo, dia.palabra));
        return option;
    });

    $(`voto-${tipo}`).replaceChildren(
        el('header', { className: 'vote-head' }, [
            el('h2', { textContent: TITULOS[tipo] }),
            el('p', { className: 'muted', textContent: `${periodLabel(tipo, periodo)} · cierra ${closesIn(periodEnd(tipo, periodo))}` }),
        ]),
        ...(options.length ? options : [el('p', { className: 'muted', textContent: 'Todavía no hay palabras en este periodo.' })]),
    );
}

function renderHistory(tipo) {
    const now = Date.now();
    const votos = allVotes();
    const periodos = [...new Set(state.dias.map((dia) => periodKey(tipo, dia.fecha)))]
        .filter((periodo) => periodEnd(tipo, periodo).getTime() <= now)
        .sort()
        .reverse();

    const items = periodos.map((periodo) => {
        const rows = results(tipo, periodo, votos)
            .filter((row) => row.usuarios.length)
            .sort((a, b) => b.usuarios.length - a.usuarios.length);
        const max = rows[0]?.usuarios.length ?? 0;
        const winners = rows.filter((row) => row.usuarios.length === max);

        return el('details', { className: 'card past' }, [
            el('summary', {}, [
                el('span', { className: 'period', textContent: periodLabel(tipo, periodo) }),
                max
                    ? el('strong', { textContent: winners.map((row) => row.dia.palabra).join(' / ') })
                    : el('span', { className: 'muted', textContent: 'Sin votos' }),
                ...(max ? [el('span', { className: 'count', textContent: `${max} ${max === 1 ? 'voto' : 'votos'}${winners.length > 1 ? ' · empate' : ''}` })] : []),
            ]),
            el('ul', { className: 'tally' }, rows.map((row) => el('li', {}, [
                wordLink(row.dia),
                el('span', { className: 'muted', textContent: ` ${row.usuarios.length} · ${row.usuarios.join(', ')}` }),
            ]))),
        ]);
    });

    $(`historial-${tipo}`).replaceChildren(...(items.length ? items : [el('p', { className: 'muted', textContent: 'Aún no hay votaciones cerradas.' })]));
}

function renderList() {
    const q = state.busqueda.trim().toLocaleLowerCase('es');
    const matches = (text) => (text ?? '').toLocaleLowerCase('es').includes(q);
    const dias = state.dias.filter((d) => !q || matches(d.palabra) || matches(d.definicion));
    const meses = [...new Set(dias.map((d) => d.fecha.slice(0, 7)))].sort().reverse();

    const sections = meses.map((mes) => el('section', { className: 'month' }, [
        el('h2', { textContent: monthFormat.format(toDate(mes)) }),
        el('ul', { className: 'days' }, dias
            .filter((d) => d.fecha.startsWith(mes))
            .map((d) => el('li', {}, [
                el('time', { dateTime: d.fecha, textContent: dayFormat.format(toDate(d.fecha)) }),
                el('div', {}, [wordLink(d), el('p', { textContent: d.definicion ?? '' })]),
            ]))),
    ]));

    $('listado').replaceChildren(...sections);
    $('vacio').hidden = sections.length > 0;
}

function render() {
    renderUser();
    renderToday();
    renderVote('semana');
    renderVote('mes');
    renderHistory('semana');
    renderHistory('mes');
    renderList();
}

function showTab() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'inicio';
    document.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${tab}`; });
    document.querySelectorAll('.tabs a').forEach((link) => link.classList.toggle('active', link.hash === `#${tab}`));
}

function subscribe() {
    const today = toIso(new Date());
    const monthStart = toDate(periodKey('mes', today));
    const periodos = [
        periodKey('semana', today),
        periodKey('semana', toIso(new Date(Date.now() - 7 * DAY))),
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
    renderList();
});

window.addEventListener('hashchange', showTab);
setInterval(render, 60000);

showTab();
render();
subscribe();
