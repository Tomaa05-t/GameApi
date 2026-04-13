const socket = io(); // Si connette automaticamente all'IP del server

// --- ASCOLTO SERVER ---

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
        
        // CORREZIONE: Sincronizziamo l'indice locale con quello inviato dal server
        // Se il server non lo invia, dobbiamo dedurlo dal valore o aggiungerlo nel server.js
        if (dati.indice !== undefined) {
            indiceAttualeAsta = dati.indice;
        }
    }

    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    gestisciVisibilitaAsta();
});

socket.on('fine_asta', (dati) => {
    GameState.mioTurno = (socket.id === dati.vincitoreId);
    
    if (GameState.mioTurno) {
        // Il vincitore non deve vedere l'asta sbiadita per poter scegliere il seme
        const interfacciaAsta = document.getElementById('interfaccia-asta');
        interfacciaAsta.classList.remove('opacity-50');
        interfacciaAsta.style.pointerEvents = "auto";
        
        alert("Hai vinto l'asta! Ora scegli il seme.");
        fineAstaUmano(); 
    } else {
        // Gli altri vedono il messaggio di attesa
        document.getElementById('interfaccia-asta').classList.add('d-none');
        alert("L'asta è finita. Vince " + dati.vincitoreNome + ". In attesa del seme...");
    }
});

// --- LOGICA DI TRANSIZIONE ---

function preparaAttesa() {
    GameState.fase = 'ATTESA';
    renderGame();
    socket.emit('unisciti_partita', "Giocatore_" + socket.id.substring(0,4));
}

function avviaPartitaReale(idChiInizia) {
    indiceAttualeAsta = -1; // Reset ordine carte
    
    // Distribuzione carte (temporanea, in futuro lo farà il server)
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

// --- VARIABILI ASTA ---
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2];
let indiceAttualeAsta = -1; 

// --- EVENTI DOM ---

document.addEventListener("DOMContentLoaded", () => {
    if (!GameState.fase) GameState.fase = 'LOBBY';
    renderGame();

    // 1. TASTO NUOVA PARTITA
    const btnCrea = document.getElementById('btn-crea');
    if (btnCrea) {
        btnCrea.onclick = (e) => {
            e.preventDefault();
            preparaAttesa();
        };
    }

    // 2. TASTO CHIAMA
    const btnChiama = document.getElementById('btn-chiama');
    if (btnChiama) {
        btnChiama.onclick = (e) => {
            e.preventDefault();
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
    }

    // 3. TASTO PASSO
    const btnPasso = document.getElementById('btn-passo');
    if (btnPasso) {
        btnPasso.onclick = (e) => {
            e.preventDefault();
            if (!GameState.mioTurno) return;
            socket.emit('mossa_asta', { tipo: 'PASSO' });
        };
    }

    // 4. CONFERMA CHIAMATA (Scelta Seme)
// 4. CONFERMA CHIAMATA (Scelta Seme)
const btnConferma = document.getElementById('btn-conferma-chiamata');
if (btnConferma) {
    btnConferma.onclick = (e) => {
        e.preventDefault();
        const semeScelto = document.getElementById('select-seme').value;
        const numeroChiamatoText = document.getElementById('valore-asta-carta').innerText;

        // Comunichiamo al server la decisione finale
        socket.emit('scelta_briscola', {
            seme: semeScelto,
            carta: numeroChiamatoText
        });
    };
}

// Aggiungi questo ascoltatore per ricevere la briscola dal server
socket.on('inizio_partita_sincronizzato', (dati) => {
    GameState.fase = 'GIOCANDO';
    GameState.briscola = dati.seme;
    GameState.cartaChiamata = dati.carta;

    // Nascondiamo l'interfaccia asta per TUTTI
    document.getElementById('interfaccia-asta').classList.add('d-none');
    
    // Aggiorniamo le info a schermo
    const infoPartita = document.getElementById('info-partita-corso');
    if (infoPartita) infoPartita.classList.remove('d-none');
    document.getElementById('visualizza-numero-chiamato').innerText = dati.carta;
    document.getElementById('visualizza-briscola').innerText = dati.seme.toUpperCase();

    renderGame();
});
});

// --- FUNZIONI DI DISEGNO ---



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

    // In futuro: if (!GameState.mioTurno) return;



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


function fineAstaUmano() {
    // Nascondiamo i controlli della chiamata (select e pulsante chiama/passo)
    const btnChiama = document.getElementById('btn-chiama');
    const btnPasso = document.getElementById('btn-passo');
    const selectNum = document.getElementById('select-numero');
    
    if(btnChiama) btnChiama.classList.add('d-none');
    if(btnPasso) btnPasso.classList.add('d-none');
    if(selectNum) selectNum.classList.add('d-none');

    // Mostriamo il div per scegliere il seme
    const divSeme = document.getElementById('scelta-seme');
    if (divSeme) {
        divSeme.classList.remove('d-none');
        // Rimuoviamo eventuali blocchi di opacità se il div è dentro interfaccia-asta
        divSeme.style.pointerEvents = "auto";
    }
}