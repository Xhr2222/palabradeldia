import { readFile, writeFile } from 'node:fs/promises';
import { firebaseConfig } from '../firebase-config.js';
import { periodEnd, voteId } from '../periodos.js';

const FILE = new URL('../data/votos.json', import.meta.url);
const ENDPOINT = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/votos`;

async function fetchVotes() {
    const votes = [];
    let pageToken = '';
    do {
        const url = new URL(ENDPOINT);
        url.searchParams.set('pageSize', '300');
        url.searchParams.set('key', firebaseConfig.apiKey);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Firestore -> HTTP ${response.status}: ${await response.text()}`);
        const body = await response.json();

        for (const { fields } of body.documents ?? []) {
            votes.push({
                tipo: fields.tipo.stringValue,
                periodo: fields.periodo.stringValue,
                usuario: fields.usuario.stringValue,
                palabra: fields.palabra.stringValue,
            });
        }
        pageToken = body.nextPageToken ?? '';
    } while (pageToken);
    return votes;
}

const data = JSON.parse(await readFile(FILE, 'utf8'));
const archived = new Map(data.votos.map((voto) => [voteId(voto), voto]));
const now = Date.now();

for (const voto of await fetchVotes()) {
    if (periodEnd(voto.tipo, voto.periodo).getTime() <= now) archived.set(voteId(voto), voto);
}

const added = archived.size - data.votos.length;
data.votos = [...archived.values()].sort((a, b) => voteId(a).localeCompare(voteId(b)));

await writeFile(FILE, `${JSON.stringify(data, null, 4)}\n`);
console.log(`Votos archivados: ${data.votos.length} (${added} nuevos)`);
