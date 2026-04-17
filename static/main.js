// --- 0. INIZIALIZZAZIONE SICURA ---
window.GameState = window.GameState || {
    fase: 'LOBBY',
    giocatoriConnessi: 0,
    mioTurno: false,
    miaMano: [],
    briscola: null,
    cartaChiamata: null
};

const socket = io();
let mappaPosti = {}; 
const posizioniAvversari = ['ovest', 'nord-ovest', 'nord-est', 'est'];
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2];
let indiceAttualeAsta = -1;

// --- 1. LOGICA DI MAPPATURA ---
function assegnaPosti(tuttiIGiocatori) {
    mappaPosti = {};
    const mioIndice = tuttiIGiocatori.findIndex(g => g.id === socket.id);
    const ruotati = [];
    for (let i = 0; i < tuttiIGiocatori.length; i++) {
        ruotati.push(tuttiIGiocatori[(mioIndice + i) % tuttiIGiocatori.length]);
    }
    mappaPosti[ruotati[0].id] = 'sud';
    for (let i = 1; i < ruotati.length; i++) {
        const pos = posizioniAvversari[i - 1];
        mappaPosti[ruotati[i].id] = pos;
        const elNome = document.getElementById(`nome-${pos}`);
        if (elNome) elNome.innerText = ruotati[i].nome;
    }
}

// --- 2. ASCOLTO SERVER ---

socket.on('aggiorna_giocatori', (conteggio) => {
    GameState.giocatoriConnessi = conteggio;
    renderGame();
});

// RICEZIONE CARTE DAL SERVER (Fondamentale)
socket.on('ricevi_carte', (mano) => {
    GameState.miaMano = mano;
    console.log("Carte ricevute dal server:", mano);
    // Se siamo già in fase ASTA o GIOCANDO, disegnale subito
    if (GameState.fase !== 'LOBBY' && GameState.fase !== 'ATTESA') {
        disegnaManoReale(GameState.miaMano);
    }
});

socket.on('inizia_asta', (dati) => {
    avviaPartitaReale(dati.prossimoGiocatoreId);
});

socket.on('aggiorna_asta', (dati) => {
    if (dati.ultimoValore) {
        const elValore = document.getElementById('valore-asta-carta');
        if (elValore) elValore.innerText = dati.ultimoValore;
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
        document.getElementById('interfaccia-asta')?.classList.add('d-none');
    }
});

socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);

    if (dati.giocatori) assegnaPosti(dati.giocatori);

    const asta = document.getElementById('interfaccia-asta');
    if (asta) {
        asta.classList.add('d-none');
        asta.style.pointerEvents = "none";
    }

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
    disegnaManoReale(GameState.miaMano); // Aggiorna trasparenza
});

socket.on('fine_mano', (dati) => {
    // Aggiorna punti
    Object.keys(dati.puntiAggiornati).forEach(id => {
        const posizione = mappaPosti[id];
        if (posizione) {
            const elPunti = document.getElementById(`punti-${posizione}`);
            const contenitorePunti = elPunti?.parentElement;
            if (elPunti) {
                elPunti.innerText = dati.puntiAggiornati[id];
                if (id === dati.vincitoreId) {
                    contenitorePunti.classList.add('bg-warning', 'text-dark');
                } else {
                    contenitorePunti.classList.remove('bg-warning', 'text-dark');
                }
            }
        }
    });

    setTimeout(() => {
        const centro = document.getElementById('centro-tavolo');
        if (centro) centro.innerHTML = '';
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
        disegnaManoReale(GameState.miaMano);
    }, 2500);
});

// --- 3. FUNZIONI DI DISEGNO ---

function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO' || !GameState.mioTurno) return;
    const cartaGiocata = GameState.miaMano.splice(index, 1)[0];
    GameState.mioTurno = false;
    disegnaCartaAlCentro(cartaGiocata, socket.id);
    disegnaManoReale(GameState.miaMano);
    socket.emit('gioca_carta', { carta: cartaGiocata });
}

function disegnaCartaAlCentro(carta, giocatoreId) {
    const centro = document.getElementById('centro-tavolo');
    if (!centro) return;
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = `carta-tavolo pos-${mappaPosti[giocatoreId]}`;
    img.style.width = "80px";
    centro.appendChild(img);
}

function avviaPartitaReale(idChiInizia) {
    GameState.fase = 'ASTA';
    GameState.mioTurno = (socket.id === idChiInizia);
    renderGame();
    gestisciVisibilitaAsta();
}

function renderGame() {
    document.getElementById('area-lobby')?.classList.toggle('d-none', GameState.fase !== 'LOBBY');
    document.getElementById('area-attesa')?.classList.toggle('d-none', GameState.fase !== 'ATTESA');
    document.getElementById('tavolo-gioco')?.classList.toggle('d-none', !['ASTA', 'GIOCANDO'].includes(GameState.fase));

    if (GameState.fase === 'ATTESA') {
        const elCount = document.getElementById('count-giocatori');
        if (elCount) elCount.innerText = GameState.giocatoriConnessi;
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

    const èMioTurnoInGioco = (GameState.fase === 'GIOCANDO' && GameState.mioTurno);

    carte.forEach((carta, index) => {
        const img = document.createElement('img');
        img.src = carta.img;
        
        // Durante l'asta le carte sono visibili ma non cliccabili (non si gioca ancora)
        if (GameState.fase === 'ASTA') {
            img.className = 'carta-mano';
            img.style.pointerEvents = "none";
        } else if (èMioTurnoInGioco) {
            img.className = 'carta-mano';
            img.style.pointerEvents = "auto";
        } else {
            img.className = 'carta-mano opacity-50';
            img.style.pointerEvents = "none";
        }

        img.onclick = () => giocaCartaUmano(index);
        contenitore.appendChild(img);
    });
}

function disegnaAvversari() {
    document.querySelectorAll('.mazzetto-coperto').forEach(box => {
        box.innerHTML = '';
        for(let i=0; i<8; i++) {
            const img = document.createElement('img');
            img.src = 'carte/retro.jpg';
            img.style.width = '35px';
            box.appendChild(img);
        }
    });
}

// --- 4. ATTIVAZIONE EVENTI ---

document.addEventListener("DOMContentLoaded", () => {
    renderGame();

    document.getElementById('btn-crea').onclick = () => {
        const nomeUtente = prompt("Inserisci il tuo nome:") || "Player";
        GameState.fase = 'ATTESA';
        renderGame();
        socket.emit('unisciti_partita', nomeUtente);
    };

    document.getElementById('btn-chiama').onclick = () => {
        if (!GameState.mioTurno) return;
        const select = document.getElementById('select-numero');
        const indiceScelta = ordineCarteAsta.indexOf(parseInt(select.value));
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
    if (asta) {
        asta.classList.toggle('opacity-50', !GameState.mioTurno);
        asta.style.pointerEvents = GameState.mioTurno ? "auto" : "none";
    }
}

function fineAstaUmano() {
    const asta = document.getElementById('interfaccia-asta');
    if (asta) {
        asta.classList.remove('opacity-50');
        asta.style.pointerEvents = "auto";
    }
    ['btn-chiama', 'btn-passo', 'select-numero'].forEach(id => {
        document.getElementById(id)?.classList.add('d-none');
    });
    document.getElementById('scelta-seme')?.classList.remove('d-none');
}

socket.on('partita_finita', (dati) => {
    const schermata = document.getElementById('schermata-finale');
    document.getElementById('nomi-chiamanti').innerText = `${dati.chiamante} + ${dati.socio}`;
    document.getElementById('punti-chiamanti-finale').innerText = `${dati.puntiChiamanti} Punti`;
    document.getElementById('punti-altri-finale').innerText = `${dati.puntiAltri} Punti`;

    const titolo = document.getElementById('titolo-vittoria');
    if (dati.vittoriaChiamanti) {
        titolo.innerText = "IL CHIAMANTE VINCE!";
        titolo.className = "display-4 text-success";
    } else {
        titolo.innerText = "GLI ALTRI VINCONO!";
        titolo.className = "display-4 text-danger";
    }
    schermata.classList.remove('d-none');
});