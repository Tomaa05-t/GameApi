// --- 0. INIZIALIZZAZIONE SICURA ---
// Usiamo window.GameState per evitare l'errore "already declared" 
// nel caso il file venga caricato due volte o ci siano conflitti.
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

// --- 1. LOGICA DI MAPPATURA (POSTI A SEDERE) ---

function assegnaPosti(tuttiIGiocatori) {
    mappaPosti = {};
    const mioIndice = tuttiIGiocatori.findIndex(g => g.id === socket.id);
    
    // Ruotiamo l'array così l'utente corrente è sempre a SUD
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

    // --- AGGIUNGI QUESTE RIGHE ---
    const asta = document.getElementById('interfaccia-asta');
    if (asta) {
        asta.classList.add('d-none'); // Nasconde tutto il blocco asta
        asta.style.pointerEvents = "none"; // Evita interferenze click
    }
    // -----------------------------

    const infoPartita = document.getElementById('info-partita-corso');
    if (infoPartita) {
        infoPartita.classList.remove('d-none');
        document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
        document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();
    }
    renderGame();

    disegnaManoReale(GameState.miaMano);
});

socket.on('aggiorna_tavolo', (dati) => {
    if (dati.giocatoreId !== socket.id) {
        disegnaCartaAlCentro(dati.carta, dati.giocatoreId);
    }
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
});


socket.on('fine_mano', (dati) => {
    // 1. Aggiornamento Punti e Feedback Visivo
    Object.keys(dati.puntiAggiornati).forEach(id => {
        const posizione = mappaPosti[id];
        if (posizione) {
            const elPunti = document.getElementById(`punti-${posizione}`);
            const contenitorePunti = elPunti?.parentElement;

            if (elPunti) {
                // Aggiorna il numero dei punti
                elPunti.innerText = dati.puntiAggiornati[id];

                // Gestione evidenziatore (colore giallo/warning)
                if (id === dati.vincitoreId) {
                    // Chi vince la mano si illumina
                    contenitorePunti.classList.remove('bg-dark', 'bg-secondary');
                    contenitorePunti.classList.add('bg-warning', 'text-dark');
                } else {
                    // Gli altri tornano allo stile scuro standard
                    contenitorePunti.classList.remove('bg-warning', 'text-dark');
                    contenitorePunti.classList.add('bg-dark');
                }
            }
        }
    });

    // 2. Pulizia Tavolo e Sincronizzazione Turno
    setTimeout(() => {
        // Svuota il centro del tavolo
        const centro = document.getElementById('centro-tavolo');
        if (centro) centro.innerHTML = '';

        // Aggiorna lo stato del turno locale con i dati del server
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);

        // Ridisegna la mano per applicare/rimuovere la trasparenza
        disegnaManoReale(GameState.miaMano);

        console.log("Nuova mano iniziata. Turno di:", dati.prossimoTurnoId);
    }, 2500); // Aspettiamo 2.5 secondi per far vedere chi ha vinto la presa
});

// --- 3. FUNZIONI DI DISEGNO ---

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
    if (!centro) return;
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = `carta-tavolo pos-${mappaPosti[giocatoreId]}`;
    img.style.width = "80px";
    centro.appendChild(img);
}

function avviaPartitaReale(idChiInizia) {
    // Nota: mazzo deve essere definito in cards.js
    const mazzoMischiato = [...mazzo].sort(() => Math.random() - 0.5);
    GameState.miaMano = mazzoMischiato.slice(0, 8);
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

// js/main.js

function disegnaManoReale(carte) {
    const contenitore = document.getElementById('mie-carte');
    if (!contenitore) return;
    contenitore.innerHTML = '';

    // Controlliamo se è il nostro turno (solo durante la fase di gioco reale)
    const èMioTurnoInGioco = (GameState.fase === 'GIOCANDO' && GameState.mioTurno);

    carte.forEach((carta, index) => {
        const img = document.createElement('img');
        img.src = carta.img;
        
        // --- LOGICA TRASPARENZA ---
        if (èMioTurnoInGioco) {
            // È il mio turno: carte ben visibili e cliccabili
            img.className = 'carta-mano';
            img.style.pointerEvents = "auto"; // Abilita i click
        } else {
            // Non è il mio turno: carte trasparenti e non cliccabili
            img.className = 'carta-mano opacity-50'; // Aggiunge classe Bootstrap per trasparenza al 50%
            img.style.pointerEvents = "none"; // Disabilita i click (sicurezza extra)
        }
        // -----------------------------

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

// --- 4. ATTIVAZIONE EVENTI DOM ---

document.addEventListener("DOMContentLoaded", () => {
    renderGame();

    // Tasto Nuova Partita
    const btnCrea = document.getElementById('btn-crea');
    if (btnCrea) {
        btnCrea.onclick = () => {
            GameState.fase = 'ATTESA';
            renderGame();
            const nomeUtente = prompt("Inserisci il tuo nome:") || "Player";
            socket.emit('unisciti_partita', nomeUtente);
        };
    }

    // Altri bottoni
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
    // 1. Rendiamo il pannello di nuovo cliccabile e visibile
    const asta = document.getElementById('interfaccia-asta');
    if (asta) {
        asta.classList.remove('opacity-50');
        asta.style.pointerEvents = "auto";
    }

    // 2. Nascondiamo i bottoni dell'asta (Chiama/Passo)
    ['btn-chiama', 'btn-passo', 'select-numero'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });

    // 3. Mostriamo il selettore del seme e il tasto conferma
    const sceltaSeme = document.getElementById('scelta-seme');
    if (sceltaSeme) sceltaSeme.classList.remove('d-none');
    
    console.log("Asta vinta! Ora scegli il seme.");
}