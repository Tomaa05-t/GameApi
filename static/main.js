const socket = io(); 

// --- 1. ASCOLTO SERVER (Sincronizzazione) ---

// Aggiorna il numero di persone nella lobby
socket.on('aggiorna_giocatori', (conteggio) => {
    GameState.giocatoriConnessi = conteggio;
    renderGame();
});

// Riceve l'ordine di iniziare l'asta
socket.on('inizia_asta', (dati) => {
    avviaPartitaReale(dati.prossimoGiocatoreId);
});

// Aggiornamento durante i rilanci dell'asta
socket.on('aggiorna_asta', (dati) => {
    if (dati.ultimoValore) {
        document.getElementById('valore-asta-carta').innerText = dati.ultimoValore;
        
        // Sincronizziamo l'indice locale per sapere quale carta è stata chiamata
        if (dati.indice !== undefined) {
            indiceAttualeAsta = dati.indice;
        }
    }

    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    gestisciVisibilitaAsta();
});

// Fine dell'asta: uno vince, gli altri aspettano
socket.on('fine_asta', (dati) => {
    GameState.mioTurno = (socket.id === dati.vincitoreId);
    
    if (GameState.mioTurno) {
        // Riattiviamo l'interfaccia per il vincitore affinché possa scegliere il seme
        const interfacciaAsta = document.getElementById('interfaccia-asta');
        interfacciaAsta.classList.remove('opacity-50', 'd-none');
        interfacciaAsta.style.pointerEvents = "auto";
        
        alert("Hai vinto l'asta! Ora scegli il seme.");
        fineAstaUmano(); 
    } else {
        // Nascondiamo l'asta agli altri e mostriamo un messaggio di attesa
        document.getElementById('interfaccia-asta').classList.add('d-none');
        alert("L'asta è finita. Vince " + dati.vincitoreNome + ". In attesa della scelta del seme...");
    }
});

// Inizio effettivo del gioco (dopo che il vincitore ha scelto il seme)
socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;

    // Pulizia totale interfaccia asta
    document.getElementById('interfaccia-asta').classList.add('d-none');
    
    // Mostriamo il box informativo della partita in corso
    const infoPartita = document.getElementById('info-partita-corso');
    if (infoPartita) {
        infoPartita.classList.remove('d-none');
        document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
        document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();
    }

    renderGame();
});

// --- 2. LOGICA DI TRANSIZIONE E STATO ---

function preparaAttesa() {
    GameState.fase = 'ATTESA';
    renderGame();
    socket.emit('unisciti_partita', "Giocatore_" + socket.id.substring(0,4));
}

function avviaPartitaReale(idChiInizia) {
    indiceAttualeAsta = -1; // Reset ordine carte per l'asta
    
    // Distribuzione carte (Momentanea: in futuro sarà fatta dal server)
    const mazzoMischiato = [...mazzo].sort(() => Math.random() - 0.5);
    GameState.miaMano = mazzoMischiato.slice(0, 8);
    
    GameState.fase = 'ASTA';
    GameState.mioTurno = (socket.id === idChiInizia);
    
    renderGame();
    gestisciVisibilitaAsta();
}

function gestisciVisibilitaAsta() {
    const interfacciaAsta = document.getElementById('interfaccia-asta');
    if (!interfacciaAsta) return;

    if (GameState.mioTurno && GameState.fase === 'ASTA') {
        interfacciaAsta.classList.remove('opacity-50');
        interfacciaAsta.style.pointerEvents = "auto";
    } else {
        interfacciaAsta.classList.add('opacity-50');
        interfacciaAsta.style.pointerEvents = "none";
    }
}

// --- 3. VARIABILI E LOGICA ASTA ---
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2]; // Ordine Briscola Chiamata
let indiceAttualeAsta = -1; 

function fineAstaUmano() {
    // Nascondiamo i controlli della chiamata
    const elementiDaNascondere = ['btn-chiama', 'btn-passo', 'select-numero'];
    elementiDaNascondere.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('d-none');
    });

    // Mostriamo il div per la scelta del seme
    const divSeme = document.getElementById('scelta-seme');
    if (divSeme) {
        divSeme.classList.remove('d-none');
        divSeme.style.pointerEvents = "auto";
    }
}

// --- 4. EVENTI DOM ---

document.addEventListener("DOMContentLoaded", () => {
    if (!GameState.fase) GameState.fase = 'LOBBY';
    renderGame();

    // Bottone Crea/Unisciti
    const btnCrea = document.getElementById('btn-crea');
    if (btnCrea) {
        btnCrea.onclick = (e) => {
            e.preventDefault();
            preparaAttesa();
        };
    }

    // Bottone Chiama (Rilancio asta)
    const btnChiama = document.getElementById('btn-chiama');
    if (btnChiama) {
        btnChiama.onclick = (e) => {
            e.preventDefault();
            if (!GameState.mioTurno) return;

            const select = document.getElementById('select-numero');
            const scelta = parseInt(select.value);
            const indiceScelta = ordineCarteAsta.indexOf(scelta);

            // Controllo se la carta chiamata è più "bassa" (secondo l'ordine di briscola)
            if (indiceScelta > indiceAttualeAsta) {
                socket.emit('mossa_asta', { 
                    tipo: 'CHIAMATA',
                    valore: select.options[select.selectedIndex].text,
                    indice: indiceScelta 
                });
            } else {
                alert("Devi chiamare una carta più bassa (es. se c'è l'Asso devi chiamare il Tre)!");
            }
        };
    }

    // Bottone Passo (Uscita definitiva dall'asta)
    const btnPasso = document.getElementById('btn-passo');
    if (btnPasso) {
        btnPasso.onclick = (e) => {
            e.preventDefault();
            if (!GameState.mioTurno) return;
            socket.emit('mossa_asta', { tipo: 'PASSO' });
        };
    }

    // Bottone Conferma Seme (Solo per il vincitore dell'asta)
    const btnConferma = document.getElementById('btn-conferma-chiamata');
    if (btnConferma) {
        btnConferma.onclick = (e) => {
            e.preventDefault();
            const semeScelto = document.getElementById('select-seme').value;
            const numeroChiamatoText = document.getElementById('valore-asta-carta').innerText;

            socket.emit('scelta_briscola', {
                seme: semeScelto,
                carta: numeroChiamatoText
            });
        };
    }
});

// --- 5. FUNZIONI DI DISEGNO (Grafica) ---

function disegnaManoReale(carte) {
    const contenitore = document.getElementById('mie-carte');
    if (!contenitore) return;
    contenitore.innerHTML = '';

    carte.forEach((carta, index) => {
        const img = document.createElement('img');
        img.src = carta.img;
        img.className = 'carta-mano';
        img.style.width = "90px";
        img.style.margin = "5px";
        img.style.cursor = "pointer";
        img.onclick = () => giocaCartaUmano(index);
        contenitore.appendChild(img);
    });
}

function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO') return;
    
    // Rimuove la carta dalla mano e la mette al centro
    const cartaGiocata = GameState.miaMano.splice(index, 1)[0];
    const centro = document.getElementById('centro-tavolo');

    const img = document.createElement('img');
    img.src = cartaGiocata.img;
    img.style.width = "80px";
    img.style.position = "absolute";
    img.style.bottom = "10px";
    img.style.left = "50%";
    img.style.transform = "translateX(-50%)";
    img.style.zIndex = "50";
    centro.appendChild(img);

    disegnaManoReale(GameState.miaMano);

    if (centro.children.length >= 5) {
        setTimeout(() => { centro.innerHTML = ''; }, 2000);
    }
}

function disegnaAvversari() {
    const postazioni = document.querySelectorAll('.mazzetto-coperto');
    postazioni.forEach(box => {
        box.innerHTML = '';
        for(let i=0; i<8; i++) {
            const img = document.createElement('img');
            img.src = 'carte/retro.jpg';
            img.style.width = '40px';
            img.style.margin = '-15px';
            box.appendChild(img);
        }
    });
}