// --- 0. INIZIALIZZAZIONE ---
window.GameState = {
    fase: 'LOBBY',
    giocatoriConnessi: 0,
    mioTurno: false,
    miaMano: [],
    briscola: null,
    cartaChiamata: null,
    roomID: null
};

const socket = io();
let mappaPosti = {}; 
const posizioniAvversari = ['ovest', 'nord-ovest', 'nord-est', 'est'];
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2];
let indiceAttualeAsta = -1;

// --- 1. LOGICA DI MAPPATURA POSTI ---
function assegnaPosti(tuttiIGiocatori) {
    mappaPosti = {};
    const mioIndice = tuttiIGiocatori.findIndex(g => g.id === socket.id);
    if (mioIndice === -1) return;

    const ruotati = [];
    for (let i = 0; i < tuttiIGiocatori.length; i++) {
        ruotati.push(tuttiIGiocatori[(mioIndice + i) % tuttiIGiocatori.length]);
    }

    mappaPosti[ruotati[0].id] = 'sud';
    // Mappiamo gli altri 4 giocatori nelle posizioni restanti
    for (let i = 1; i < ruotati.length; i++) {
        const pos = posizioniAvversari[i - 1];
        mappaPosti[ruotati[i].id] = pos;
        const elNome = document.getElementById(`nome-${pos}`);
        if (elNome) elNome.innerText = ruotati[i].nome;
    }
}

// --- 2. ASCOLTO EVENTI SERVER ---

// Ricezione lista partite
socket.on('aggiorna_lista_partite', (partite) => {
    const contenitore = document.getElementById('lista-partite');
    if (!contenitore) return;

    if (partite.length === 0) {
        contenitore.innerHTML = '<div class="list-group-item bg-dark text-muted border-secondary">Nessuna partita attiva. Creane una!</div>';
        return;
    }

    contenitore.innerHTML = partite.map(p => `
        <div class="list-group-item d-flex justify-content-between align-items-center bg-dark text-white border-secondary">
            <div>
                <i class="fas fa-user-friends me-2 text-warning"></i>
                <strong>Partita di ${p.creatore}</strong>
                <span class="badge bg-secondary ms-2">${p.n}/5</span>
            </div>
            <button onclick="entraInPartita('${p.id}')" class="btn btn-sm btn-outline-warning">Entra</button>
        </div>
    `).join('');
});

socket.on('partita_creata', (roomID) => {
    GameState.roomID = roomID;
    GameState.fase = 'ATTESA';

    // Scrive il nome dell'host nell'area attesa (se hai aggiunto lo span nell'html)
    const elHost = document.getElementById('nome-host');
    if (elHost) elHost.innerText = window.GameState.nomeUtente;
    
    renderGame();
});

socket.on('aggiorna_giocatori', (conteggio) => {
    GameState.giocatoriConnessi = conteggio;
    if (GameState.fase === 'ATTESA') renderGame();
});

socket.on('ricevi_carte', (mano) => {
    GameState.miaMano = mano;
    console.log("Carte ricevute:", mano);
    disegnaManoReale(GameState.miaMano);
});

socket.on('inizia_asta', (dati) => {
    GameState.fase = 'ASTA';
    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    renderGame();
    gestisciVisibilitaAsta();
});

socket.on('aggiorna_asta', (dati) => {
    if (dati.ultimoValore) {
        document.getElementById('valore-asta-carta').innerText = dati.ultimoValore;
        indiceAttualeAsta = dati.indice;
    }
    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    gestisciVisibilitaAsta();
});

socket.on('fine_asta', (dati) => {
    GameState.mioTurno = (socket.id === dati.vincitoreId);
    if (GameState.mioTurno) {
        preparaSceltaBriscola(); 
    } else {
        document.getElementById('interfaccia-asta').classList.add('d-none');
    }
});

socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);

    assegnaPosti(dati.giocatori);
    
    // Aggiorna UI
    document.getElementById('interfaccia-asta').classList.add('d-none');
    document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
    document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();
    
    renderGame();
});

socket.on('aggiorna_tavolo', (dati) => {
    if (dati.giocatoreId !== socket.id) {
        disegnaCartaAlCentro(dati.carta, dati.giocatoreId);
    }
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
    disegnaManoReale(GameState.miaMano);
});

socket.on('fine_mano', (dati) => {
    // Aggiorna punteggi visibili
    Object.keys(dati.puntiAggiornati).forEach(id => {
        const pos = mappaPosti[id];
        const el = document.getElementById(`punti-${pos}`);
        if (el) el.innerText = dati.puntiAggiornati[id];
    });

    setTimeout(() => {
        document.getElementById('centro-tavolo').innerHTML = '';
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
        disegnaManoReale(GameState.miaMano);
    }, 2000);
});

// --- 3. FUNZIONI DI INTERFACCIA ---

function entraInPartita(id) {
    const nome = prompt("Il tuo nome:") || "Player";
    GameState.roomID = id;
    GameState.fase = 'ATTESA';
    renderGame();
    socket.emit('unisciti_a_partita', { roomID: id, nomePlayer: nome });
}

function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO' || !GameState.mioTurno) return;
    const carta = GameState.miaMano.splice(index, 1)[0];
    GameState.mioTurno = false;
    disegnaCartaAlCentro(carta, socket.id);
    disegnaManoReale(GameState.miaMano);
    socket.emit('gioca_carta', { carta: carta });
}

function disegnaCartaAlCentro(carta, giocatoreId) {
    const centro = document.getElementById('centro-tavolo');
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = 'carta-tavolo';
    img.style.transform = `rotate(${Math.random() * 10 - 5}deg)`;
    centro.appendChild(img);
}

function renderGame() {
    document.getElementById('area-lobby').classList.toggle('d-none', GameState.fase !== 'LOBBY');
    document.getElementById('area-attesa').classList.toggle('d-none', GameState.fase !== 'ATTESA');
    document.getElementById('tavolo-gioco').classList.toggle('d-none', !['ASTA', 'GIOCANDO'].includes(GameState.fase));

    if (GameState.fase === 'ATTESA') {
        document.getElementById('count-giocatori').innerText = GameState.giocatoriConnessi;
    }
    if (GameState.fase === 'ASTA' || GameState.fase === 'GIOCANDO') {
        disegnaManoReale(GameState.miaMano);
        disegnaMazzettiAvversari();
    }
}

function disegnaManoReale(carte) {
    const box = document.getElementById('mie-carte');
    if (!box) return;
    box.innerHTML = '';
    carte.forEach((c, i) => {
        const img = document.createElement('img');
        img.src = c.img;
        img.className = (GameState.fase === 'GIOCANDO' && GameState.mioTurno) ? 'carta-mano' : 'carta-mano opacity-75';
        img.onclick = () => giocaCartaUmano(i);
        box.appendChild(img);
    });
}

function disegnaMazzettiAvversari() {
    document.querySelectorAll('.mazzetto-coperto').forEach(m => {
        m.innerHTML = '<i class="fas fa-layer-group fa-2x text-white-50"></i>';
    });
}

function gestisciVisibilitaAsta() {
    const container = document.getElementById('interfaccia-asta');
    if (GameState.fase === 'ASTA') {
        container.classList.remove('d-none');
        container.style.opacity = GameState.mioTurno ? "1" : "0.5";
        container.style.pointerEvents = GameState.mioTurno ? "auto" : "none";
    }
}

function preparaSceltaBriscola() {
    document.getElementById('btn-chiama').classList.add('d-none');
    document.getElementById('btn-passo').classList.add('d-none');
    document.getElementById('select-numero').classList.add('d-none');
    document.getElementById('scelta-seme').classList.remove('d-none');
}

// --- 4. EVENTI DOM ---

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('btn-crea').onclick = () => {
        const nome = prompt("Nome della stanza (tuo nome):") || "Player";
        window.GameState.nomeUtente = nome;
        socket.emit('crea_partita', nome);
    };

    document.getElementById('btn-chiama').onclick = () => {
        const val = parseInt(document.getElementById('select-numero').value);
        const idx = ordineCarteAsta.indexOf(val);
        if (idx > indiceAttualeAsta) {
            const testo = document.getElementById('select-numero').options[document.getElementById('select-numero').selectedIndex].text;
            socket.emit('mossa_asta', { tipo: 'CHIAMATA', valore: testo, indice: idx });
        } else {
            alert("Devi chiamare una carta più bassa (es. se è Asso, devi chiamare 3 o meno)");
        }
    };

    document.getElementById('btn-passo').onclick = () => socket.emit('mossa_asta', { tipo: 'PASSO' });

    // Gestione bottoni semi
    document.querySelectorAll('.btn-seme').forEach(btn => {
        btn.onclick = () => {
            const seme = btn.getAttribute('data-seme');
            const carta = document.getElementById('valore-asta-carta').innerText;
            socket.emit('scelta_briscola', { seme, carta });
        };
    });
});

socket.on('partita_finita', (dati) => {
    const win = document.getElementById('schermata-finale');
    document.getElementById('titolo-vittoria').innerText = dati.vittoriaChiamanti ? "I CHIAMANTI VINCONO!" : "GLI ALTRI VINCONO!";
    document.getElementById('nomi-chiamanti').innerText = `${dati.chiamante} & ${dati.socio}`;
    document.getElementById('punti-chiamanti-finale').innerText = dati.puntiChiamanti;
    document.getElementById('punti-altri-finale').innerText = dati.puntiAltri;
    win.classList.remove('d-none');
});