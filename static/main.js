const socket = io(); 

// --- 1. ASCOLTO SERVER (Sincronizzazione) ---

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
        const interfacciaAsta = document.getElementById('interfaccia-asta');
        interfacciaAsta.classList.remove('opacity-50', 'd-none');
        interfacciaAsta.style.pointerEvents = "auto";
        fineAstaUmano(); 
    } else {
        document.getElementById('interfaccia-asta').classList.add('d-none');
    }
});

// Inizio partita: riceve chi deve iniziare a giocare
socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);

    document.getElementById('interfaccia-asta').classList.add('d-none');
    
    const infoPartita = document.getElementById('info-partita-corso');
    if (infoPartita) {
        infoPartita.classList.remove('d-none');
        document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
        document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();
    }
    renderGame();
});

// AGGIORNAMENTO TAVOLO: Riceve la carta giocata da qualcuno
socket.on('aggiorna_tavolo', (dati) => {
    if (dati.giocatoreId !== socket.id) {
        disegnaCartaAlCentro(dati.carta, dati.giocatoreId);
    }
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
    // Opzionale: aggiungi una classe CSS per illuminare il bordo del giocatore di turno
});

// FINE MANO: Qualcuno ha vinto la presa
socket.on('fine_mano', (dati) => {
    // Aggiorna i punti nell'HTML
    Object.keys(dati.puntiAggiornati).forEach(id => {
        let spanPunti;
        if (id === socket.id) spanPunti = document.getElementById('punti-sud');
        // Qui andrebbe una logica per mappare gli ID socket alle posizioni Est/Ovest/Nord
        if (spanPunti) spanPunti.innerText = dati.puntiAggiornati[id];
    });

    // Pulisce il tavolo dopo 2 secondi
    setTimeout(() => {
        document.getElementById('centro-tavolo').innerHTML = '';
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
    }, 2000);
});

// --- 2. LOGICA DI GIOCO ---

function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO' || !GameState.mioTurno) {
        alert("Non è il tuo turno!");
        return;
    }

    const cartaGiocata = GameState.miaMano.splice(index, 1)[0];
    
    // Disegna localmente
    disegnaCartaAlCentro(cartaGiocata, socket.id);
    disegnaManoReale(GameState.miaMano);

    // Invia al server
    socket.emit('gioca_carta', { carta: cartaGiocata });
    GameState.mioTurno = false;
}

function disegnaCartaAlCentro(carta, giocatoreId) {
    const centro = document.getElementById('centro-tavolo');
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = 'carta-tavolo'; // Aggiungi stile CSS per posizionarle a raggiera
    img.style.width = "80px";
    
    // Semplice posizionamento: se sono io sta sotto, altrimenti sopra
    if (giocatoreId === socket.id) {
        img.style.border = "2px solid gold";
    }
    
    centro.appendChild(img);
}

// --- 3. LOGICA ASTA E LOBBY (Invariata) ---

function preparaAttesa() {
    GameState.fase = 'ATTESA';
    renderGame();
    socket.emit('unisciti_partita', prompt("Inserisci il tuo nome:") || "Player");
}

function avviaPartitaReale(idChiInizia) {
    indiceAttualeAsta = -1; 
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
    interfacciaAsta.classList.toggle('opacity-50', !GameState.mioTurno);
    interfacciaAsta.style.pointerEvents = GameState.mioTurno ? "auto" : "none";
}

let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2];
let indiceAttualeAsta = -1; 

function fineAstaUmano() {
    ['btn-chiama', 'btn-passo', 'select-numero'].forEach(id => {
        document.getElementById(id)?.classList.add('d-none');
    });
    document.getElementById('scelta-seme')?.classList.remove('d-none');
}

// --- 4. RENDER E EVENTI ---

function renderGame() {
    const areaLobby = document.getElementById('area-lobby');
    const areaAttesa = document.getElementById('area-attesa');
    const tavoloGioco = document.getElementById('tavolo-gioco');

    areaLobby.classList.toggle('d-none', GameState.fase !== 'LOBBY');
    areaAttesa.classList.toggle('d-none', GameState.fase !== 'ATTESA');
    tavoloGioco.classList.toggle('d-none', !['ASTA', 'GIOCANDO'].includes(GameState.fase));

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
            img.src = 'carte/retro.jpg'; // Assicurati che il percorso sia corretto
            img.style.width = '40px';
            box.appendChild(img);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    if (!GameState.fase) GameState.fase = 'LOBBY';
    renderGame();

    document.getElementById('btn-crea').onclick = () => preparaAttesa();

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
        } else {
            alert("Devi chiamare una carta più bassa!");
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