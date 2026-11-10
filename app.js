const monthFormat = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const longFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'full', timeZone: 'UTC' });

function el(tag, props = {}, children = []) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function toDate(iso) {
    return new Date(`${iso.length === 7 ? `${iso}-01` : iso}T00:00:00Z`);
}

function wordLink(dia, className = '') {
    return el('a', { href: dia.url, target: '_blank', rel: 'noopener', className, textContent: dia.palabra });
}

function renderToday(dia) {
    const hoy = document.getElementById('hoy');
    hoy.replaceChildren(
        el('p', { className: 'label', textContent: longFormat.format(toDate(dia.fecha)) }),
        wordLink(dia, 'word'),
        el('p', { textContent: dia.definicion ?? '' }),
    );
    hoy.hidden = false;
}

function renderList(data, query) {
    const q = query.trim().toLocaleLowerCase('es');
    const matches = (text) => (text ?? '').toLocaleLowerCase('es').includes(q);

    const dias = data.dias.filter((d) => !q || matches(d.palabra) || matches(d.definicion));
    const meses = new Map(data.meses.filter((m) => m.palabra).map((m) => [m.mes, m]));
    const keys = new Set(dias.map((d) => d.fecha.slice(0, 7)));
    if (!q) meses.forEach((_, key) => keys.add(key));

    const sections = [...keys].sort().reverse().map((key) => {
        const children = [el('h2', { textContent: monthFormat.format(toDate(key)) })];

        const mes = meses.get(key);
        if (mes) {
            children.push(el('div', { className: 'card month-word' }, [
                el('span', { className: 'label', textContent: 'Palabra del mes' }),
                el('strong', { textContent: mes.palabra }),
                ...(mes.nota ? [el('p', { className: 'muted', textContent: mes.nota })] : []),
            ]));
        }

        const items = dias
            .filter((d) => d.fecha.startsWith(key))
            .map((d) => el('li', {}, [
                el('time', { dateTime: d.fecha, textContent: dayFormat.format(toDate(d.fecha)) }),
                el('div', {}, [wordLink(d), el('p', { textContent: d.definicion ?? '' })]),
            ]));
        children.push(el('ul', { className: 'days' }, items));

        return el('section', { className: 'month' }, children);
    });

    document.getElementById('listado').replaceChildren(...sections);
    document.getElementById('vacio').hidden = sections.length > 0;
}

async function main() {
    const response = await fetch('data/palabras.json', { cache: 'no-store' });
    const data = await response.json();

    if (data.dias.length) renderToday(data.dias[0]);
    renderList(data, '');

    document.getElementById('buscar').addEventListener('input', (event) => renderList(data, event.target.value));
}

main();
