const socket = io();

// --- STATO LOCALE DEL GIOCO ---
let GameState = {
    fase: 'LOBBY',
    giocatoriConnessi: 0,
    mioTurno: false,
    miaMano: [],
    briscola: null,
    cartaChiamata: null
};

let mappaPosti = {}; 
const posizioniAvversari = ['ovest', 'nord-ovest', 'nord-est', 'est'];
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2];
let indiceAttualeAsta = -1;

// --- 1. LOGICA DI MAPPATURA (POSTI A SEDERE) ---

function assegnaPosti(tuttiIGiocatori) {
    mappaPosti = {};
    const mioIndice = tuttiIGiocatori.findIndex(g => g.id === socket.id);
    
    // Ruotiamo l'array così l'utente corrente è sempre all'indice 0 (SUD)
    const ruotati = [];
    for (let i = 0; i < tuttiIGiocatori.length; i++) {
        ruotati.push(tuttiIGiocatori[(mioIndice + i) % tuttiIGiocatori.length]);
    }

    // Assegnazione Sud (Tu)
    mappaPosti[ruotati[0].id] = 'sud';
    
    // Assegnazione altri 4 posti
    for (let i = 1; i < ruotati.length; i++) {
        const pos = posizioniAvversari[i - 1];
        mappaPosti[ruotati[i].id] = pos;
        
        // Aggiorna Nome nell'HTML
        const elNome = document.getElementById(`nome-${pos}`);
        if (elNome) elNome.innerText = ruotati[i].nome;
    }
}

// --- 2. ASCOLTO SERVER (SOCKET.IO) ---

socket.on('aggiorna_giocatori', (conteggio) => {
    GameState.giocatoriConnessi = conteggio;
    renderGame();
});

socket.on('inizia_asta', (dati) => {
    avviaPartitaReale(dati.prossimoGiocatoreId);
});

socket.on('aggiorna_asta', (dati) => {
    if (dati.ultimoValore) {
        document.getElementById('valore-asta-carta').innerText = dati.ultimoValore;
        if (dati.indice !== undefined) indiceAttualeAsta = dati.indice;
    }
    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    gestisciVisibilitaAsta();
});

socket.on('fine_asta', (dati) => {
    GameState.mioTurno = (socket.id === dati.vincitoreId);
    if (GameState.mioTurno) {
        fineAstaUmano(); 
    } else {
        document.getElementById('interfaccia-asta').classList.add('d-none');
    }
});

socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);

    if (dati.giocatori) assegnaPosti(dati.giocatori);

    document.getElementById('interfaccia-asta').classList.add('d-none');
    const infoPartita = document.getElementById('info-partita-corso');
    if (infoPartita) {
        infoPartita.classList.remove('d-none');
        document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
        document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();
    }
    renderGame();
});

socket.on('aggiorna_tavolo', (dati) => {
    if (dati.giocatoreId !== socket.id) {
        disegnaCartaAlCentro(dati.carta, dati.giocatoreId);
    }
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
});

socket.on('fine_mano', (dati) => {
    // Aggiornamento Punti Dinamico
    Object.keys(dati.puntiAggiornati).forEach(id => {
        const posizione = mappaPosti[id];
        if (posizione) {
            const elPunti = document.getElementById(`punti-${posizione}`);
            if (elPunti) {
                elPunti.innerText = dati.puntiAggiornati[id];
                if (id === dati.vincitoreId) {
                    elPunti.parentElement.classList.add('bg-warning');
                    elPunti.parentElement.classList.remove('bg-secondary', 'bg-dark');
                }
            }
        }
    });

    // Pulizia tavolo
    setTimeout(() => {
        document.getElementById('centro-tavolo').innerHTML = '';
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
        
        // Reset colori punti
        document.querySelectorAll('.badge').forEach(b => {
            if (!b.parentElement.classList.contains('bg-success')) {
                b.parentElement.classList.remove('bg-warning');
                b.parentElement.classList.add('bg-dark');
            }
        });
    }, 2500);
});

// --- 3. FUNZIONI DI GIOCO ---

function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO' || !GameState.mioTurno) return;

    const cartaGiocata = GameState.miaMano.splice(index, 1)[0];
    disegnaCartaAlCentro(cartaGiocata, socket.id);
    disegnaManoReale(GameState.miaMano);

    socket.emit('gioca_carta', { carta: cartaGiocata });
    GameState.mioTurno = false;
}

function disegnaCartaAlCentro(carta, giocatoreId) {
    const centro = document.getElementById('centro-tavolo');
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = `carta-tavolo pos-${mappaPosti[giocatoreId]}`;
    img.style.width = "80px";
    centro.appendChild(img);
}

function avviaPartitaReale(idChiInizia) {
    // In produzione le carte dovrebbero arrivare dal server, qui manteniamo la tua logica
    const mazzoMischiato = [...mazzo].sort(() => Math.random() - 0.5);
    GameState.miaMano = mazzoMischiato.slice(0, 8);
    GameState.fase = 'ASTA';
    GameState.mioTurno = (socket.id === idChiInizia);
    renderGame();
    gestisciVisibilitaAsta();
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
        disegnaAvversari();
    }
}

function disegnaManoReale(carte) {
    const contenitore = document.getElementById('mie-carte');
    if (!contenitore) return;
    contenitore.innerHTML = '';
    carte.forEach((carta, index) => {
        const img = document.createElement('img');
        img.src = carta.img;
        img.className = 'carta-mano';
        img.onclick = () => giocaCartaUmano(index);
        contenitore.appendChild(img);
    });
}

function disegnaAvversari() {
    const postazioni = document.querySelectorAll('.mazzetto-coperto');
    postazioni.forEach(box => {
        box.innerHTML = '';
        for(let i=0; i<8; i++) {
            const img = document.createElement('img');
            img.src = 'carte/retro.jpg';
            img.style.width = '35px';
            box.appendChild(img);
        }
    });
}

// --- 4. EVENTI DOM ---

document.addEventListener("DOMContentLoaded", () => {
    renderGame();

    document.getElementById('btn-crea').onclick = () => {
        GameState.fase = 'ATTESA';
        renderGame();
        const nomeUtente = prompt("Inserisci il tuo nome:") || "Player";
        socket.emit('unisciti_partita', nomeUtente);
    };

    document.getElementById('btn-chiama').onclick = () => {
        if (!GameState.mioTurno) return;
        const select = document.getElementById('select-numero');
        const scelta = parseInt(select.value);
        const indiceScelta = ordineCarteAsta.indexOf(scelta);

        if (indiceScelta > indiceAttualeAsta) {
            socket.emit('mossa_asta', { 
                tipo: 'CHIAMATA',
                valore: select.options[select.selectedIndex].text,
                indice: indiceScelta 
            });
        }
    };

    document.getElementById('btn-passo').onclick = () => {
        if (GameState.mioTurno) socket.emit('mossa_asta', { tipo: 'PASSO' });
    };

    document.getElementById('btn-conferma-chiamata').onclick = () => {
        const semeScelto = document.getElementById('select-seme').value;
        const numeroChiamatoText = document.getElementById('valore-asta-carta').innerText;
        socket.emit('scelta_briscola', { seme: semeScelto, carta: numeroChiamatoText });
    };
});

function gestisciVisibilitaAsta() {
    const asta = document.getElementById('interfaccia-asta');
    asta.classList.toggle('opacity-50', !GameState.mioTurno);
    asta.style.pointerEvents = GameState.mioTurno ? "auto" : "none";
}

function fineAstaUmano() {
    ['btn-chiama', 'btn-passo', 'select-numero'].forEach(id => {
        document.getElementById(id)?.classList.add('d-none');
    });
    document.getElementById('scelta-seme')?.classList.remove('d-none');
}