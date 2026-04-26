/**
 * --- 0. INIZIALIZZAZIONE E STATO GLOBALE ---
 * GameState funge da "Single Source of Truth" per il frontend. 
 * Qui memorizziamo tutto ciò che il client sa sulla partita in corso.
 */
window.GameState = { 
    fase: 'LOBBY',           // Fasi: LOBBY, ATTESA, ASTA, GIOCANDO
    giocatoriConnessi: 0,
    mioTurno: false,
    miaMano: [],
    briscola: null,
    cartaChiamata: null,
    roomID: null,
    nomeUtente: ""
};

const socket = io(); // Inizializzazione della connessione WebSocket
let mappaPosti = {}; // Associa gli ID dei giocatori alle posizioni fisiche (sud, ovest, ecc.)
const posizioniAvversari = ['ovest', 'nord-ovest', 'nord-est', 'est'];
let ordineCarteAsta = [1, 3, 10, 9, 8, 7, 6, 5, 4, 2]; // Gerarchia specifica per l'asta
let indiceAttualeAsta = -1;

/**
 * --- 1. LOGICA DI MAPPATURA POSTI ---
 * Questa funzione è fondamentale per la User Experience.
 * Ruota l'array dei giocatori in modo che l'utente locale (tu) sia sempre 
 * posizionato a 'sud', distribuendo gli altri in senso orario.
 */
function assegnaPosti(tuttiIGiocatori) {
    mappaPosti = {};
    const mioIndice = tuttiIGiocatori.findIndex(g => g.id === socket.id);
    if (mioIndice === -1) return;

    // Algoritmo di rotazione array: mette il giocatore locale all'indice 0
    const ruotati = [];
    for (let i = 0; i < tuttiIGiocatori.length; i++) {
        ruotati.push(tuttiIGiocatori[(mioIndice + i) % tuttiIGiocatori.length]);
    }

    // Mappatura visiva: il primo dell'array ruotato va a SUD, gli altri seguono lo schema
    mappaPosti[ruotati[0].id] = 'sud';
    for (let i = 1; i < ruotati.length; i++) {
        const pos = posizioniAvversari[i - 1];
        mappaPosti[ruotati[i].id] = pos;
        const elNome = document.getElementById(`nome-${pos}`);
        if (elNome) elNome.innerText = ruotati[i].nome;
    }
}

/**
 * --- 2. ASCOLTO EVENTI SERVER (SOCKET.IO) ---
 * Qui gestiamo tutti i messaggi in arrivo dal server. 
 * Ogni evento aggiorna lo stato locale (GameState) e la UI.
 * Socket.io è una libreria che permette una comunicazione bidirezionale, in tempo reale e basata su eventi tra il browser (Client) e il server (Node.js)
 */

// Riceve la lista delle partite create da altri e le mostra nella lobby
socket.on('aggiorna_lista_partite', (partite) => {
    const contenitore = document.getElementById('lista-partite');
    if (!contenitore) return;
    if (partite.length === 0) {
        contenitore.innerHTML = '<div class="list-group-item bg-dark text-muted border-secondary text-center">Nessuna partita attiva. Creane una!</div>';
        return;
    }
    contenitore.innerHTML = partite.map(p => `
        <div class="list-group-item d-flex justify-content-between align-items-center bg-dark text-white border-secondary">
            <div>
                <strong>Stanza di ${p.creatore}</strong>
                <span class="badge bg-warning text-dark ms-2">${p.n}/5</span>
            </div>
            <button onclick="entraInPartita('${p.id}')" class="btn btn-sm btn-warning">Entra</button>
        </div>
    `).join('');
});

// Conferma creazione partita e sposta il giocatore nell'area di attesa
socket.on('partita_creata', (roomID) => {
    GameState.roomID = roomID;
    GameState.fase = 'ATTESA';
    renderGame();
});

// Aggiorna il contatore dei giocatori mentre si aspetta che la stanza si riempia
socket.on('aggiorna_giocatori', (conteggio) => {
    GameState.giocatoriConnessi = conteggio;
    if (GameState.fase === 'ATTESA') {
        const elCount = document.getElementById('count-giocatori');
        if (elCount) elCount.innerText = conteggio;
    }
});

// Il server invia le 8 carte personali a ogni giocatore
socket.on('ricevi_carte', (mano) => {
    GameState.miaMano = mano;
    disegnaManoReale(GameState.miaMano);
});

// Gestione inizio asta: determina chi è il primo a dover parlare
socket.on('inizia_asta', (dati) => {
    GameState.fase = 'ASTA';
    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    
    const elTurno = document.getElementById('nome-turno');
    if (elTurno) elTurno.innerText = GameState.mioTurno ? "TOCCA A TE" : dati.prossimoGiocatoreNome;
    
    renderGame();
    gestisciVisibilitaAsta();
});

// Aggiorna l'interfaccia dell'asta dopo ogni rilancio o passo
socket.on('aggiorna_asta', (dati) => {
    if (dati.ultimoValore) {
        const elValore = document.getElementById('valore-asta-carta');
        if (elValore) elValore.innerText = dati.ultimoValore;
        indiceAttualeAsta = dati.indice;
    }

    GameState.mioTurno = (socket.id === dati.prossimoGiocatoreId);
    
    const elTurno = document.getElementById('nome-turno');
    if (elTurno) {
        elTurno.innerText = GameState.mioTurno ? "TOCCA A TE!" : dati.prossimoGiocatoreNome;
        GameState.mioTurno ? elTurno.classList.add('text-warning') : elTurno.classList.remove('text-warning');
    }
    gestisciVisibilitaAsta();
});

// Quando rimane solo un giocatore in asta, questi deve scegliere il seme di briscola
socket.on('fine_asta', (dati) => {
    GameState.mioTurno = (socket.id === dati.vincitoreId);
    if (GameState.mioTurno) {
        preparaSceltaBriscola(); 
    } else {
        const container = document.getElementById('interfaccia-asta');
        container.style.opacity = "0.5";
        container.style.pointerEvents = "none";
        const elTurno = document.getElementById('nome-turno');
        if (elTurno) elTurno.innerText = `Attesa scelta briscola da: ${dati.vincitoreNome}`;
    }
});

// Transizione dall'asta al gioco vero e proprio. Gestisce anche il caso speciale "A CARICHI"
socket.on('inizio_partita_sincronizzato', (dati) => {
    console.log("Partita iniziata ufficialmente!", dati);
    GameState.fase = 'GIOCANDO';
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
    
    if (dati.isAcarichi) {
        GameState.briscola = "Senza Briscola (Comanda l'uscita)";
        GameState.cartaChiamata = "A CARICHI";
    } else {
        GameState.briscola = dati.seme;
        GameState.cartaChiamata = dati.carta;
    }

    assegnaPosti(dati.giocatori);
    
    // Pulizia UI asta e aggiornamento HUD di gioco
    const interAsta = document.getElementById('interfaccia-asta');
    if (interAsta) interAsta.classList.add('d-none');
    
    document.getElementById('visualizza-numero-chiamato').innerText = GameState.cartaChiamata;
    document.getElementById('visualizza-briscola').innerText = GameState.briscola.toUpperCase();
    
    const elTurno = document.getElementById('nome-turno');
    if (elTurno) {
        elTurno.innerText = GameState.mioTurno ? "TOCCA A TE!" : dati.prossimoTurnoNome;
        GameState.mioTurno ? elTurno.classList.add('text-warning') : elTurno.classList.remove('text-warning');
    }

    disegnaManoReale(GameState.miaMano);
});

// Mostra a schermo la carta giocata da un avversario e aggiorna il turno
socket.on('aggiorna_tavolo', (dati) => {
    if (dati.giocatoreId !== socket.id) {
        disegnaCartaAlCentro(dati.carta, dati.giocatoreId);
    }
    GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
    
    const elTurno = document.getElementById('nome-turno');
    if (elTurno) elTurno.innerText = GameState.mioTurno ? "TOCCA A TE" : dati.prossimoTurnoNome;
    
    disegnaManoReale(GameState.miaMano);
});

// Al termine di ogni mano (5 carte a terra), aggiorna i punti e pulisce il tavolo
socket.on('fine_mano', (dati) => {
    Object.keys(dati.puntiAggiornati).forEach(id => {
        const pos = mappaPosti[id];
        const el = document.getElementById(`punti-${pos}`);
        if (el) el.innerText = dati.puntiAggiornati[id];
    });

    setTimeout(() => {
        document.getElementById('centro-tavolo').innerHTML = '';
        GameState.mioTurno = (socket.id === dati.prossimoTurnoId);
        const elTurno = document.getElementById('nome-turno');
        if (elTurno) elTurno.innerText = GameState.mioTurno ? "TOCCA A TE" : dati.prossimoTurnoNome;
        disegnaManoReale(GameState.miaMano);
    }, 2000);
});

// Mostra la modale finale con i risultati quando le 8 mani sono terminate
socket.on('partita_finita', (dati) => {
    const win = document.getElementById('schermata-finale');
    document.getElementById('titolo-vittoria').innerText = dati.vittoriaChiamanti ? "I CHIAMANTI VINCONO!" : "I CHIAMANTI PERDONO!";
    document.getElementById('nomi-chiamanti').innerText = dati.chiamante;
    document.getElementById('punti-chiamanti-finale').innerText = dati.puntiChiamanti;
    document.getElementById('punti-altri-finale').innerText = dati.puntiAltri;
    win.classList.remove('d-none');
    win.classList.add('d-flex');
});

/**
 * --- 3. FUNZIONI DI SUPPORTO E INTERFACCIA ---
 * Logica di manipolazione del DOM e gestione input utente.
 */

// Invia al server la richiesta di partecipazione a una specifica stanza
function entraInPartita(id) {
    const nome = prompt("Il tuo nome:") || "Player";
    GameState.nomeUtente = nome;
    GameState.roomID = id;
    GameState.fase = 'ATTESA';
    renderGame();
    socket.emit('unisciti_a_partita', { roomID: id, nomePlayer: nome });
}

// Rimuove la carta dalla mano locale e informa il server della mossa
function giocaCartaUmano(index) {
    if (GameState.fase !== 'GIOCANDO' || !GameState.mioTurno) return;
    const carta = GameState.miaMano.splice(index, 1)[0];
    GameState.mioTurno = false;
    disegnaCartaAlCentro(carta, socket.id);
    disegnaManoReale(GameState.miaMano);
    socket.emit('gioca_carta', { carta: carta });
}

// Crea l'elemento visuale della carta giocata al centro del tavolo
function disegnaCartaAlCentro(carta, giocatoreId) {
    const centro = document.getElementById('centro-tavolo');
    const img = document.createElement('img');
    img.src = carta.img;
    img.className = 'carta-tavolo';
    // Estetica: rotazione casuale per simulare il lancio fisico della carta
    img.style.transform = `rotate(${Math.random() * 20 - 10}deg)`;
    centro.appendChild(img);
}

// Gestisce la visibilità delle macro-aree dell'app (Lobby vs Tavolo)
function renderGame() {
    document.getElementById('area-lobby').classList.toggle('d-none', GameState.fase !== 'LOBBY');
    document.getElementById('area-attesa').classList.toggle('d-none', GameState.fase !== 'ATTESA');
    document.getElementById('tavolo-gioco').classList.toggle('d-none', !['ASTA', 'GIOCANDO'].includes(GameState.fase));

    if (GameState.fase === 'ATTESA') {
        document.getElementById('count-giocatori').innerText = GameState.giocatoriConnessi;
    }
}

// Renderizza le carte in mano all'utente, gestendo l'opacità e l'interattività basandosi sul turno
function disegnaManoReale(carte) {
    const box = document.getElementById('mie-carte');
    if (!box) return;
    box.innerHTML = '';
    
    carte.forEach((c, i) => {
        const img = document.createElement('img');
        img.src = c.img;
        
        // Verifica se il giocatore può interagire con la carta
        const puoGiocare = (GameState.fase === 'GIOCANDO' && GameState.mioTurno);
        img.className = puoGiocare ? 'carta-mano' : 'carta-mano opaca';
        
        if (puoGiocare) {
            img.onclick = () => giocaCartaUmano(i);
        } else {
            img.onclick = null;
        }
        box.appendChild(img);
    });
}

// Gestisce l'abilitazione/disabilitazione visiva dei controlli dell'asta
function gestisciVisibilitaAsta() {
    const container = document.getElementById('interfaccia-asta');
    if (!container) return;
    
    if (GameState.fase === 'ASTA') {
        container.classList.remove('d-none');
        // Se non è il mio turno, rendo l'interfaccia semi-trasparente e non cliccabile
        container.style.opacity = GameState.mioTurno ? "1" : "0.5";
        container.style.pointerEvents = GameState.mioTurno ? "auto" : "none";
        
        document.getElementById('btn-chiama').classList.remove('d-none'); 
        document.getElementById('btn-passo').classList.remove('d-none');
        document.getElementById('select-numero').classList.remove('d-none');
        document.getElementById('btn-carichi').classList.remove('d-none');
        document.getElementById('scelta-seme').classList.add('d-none');
    }
}

// Trasforma il pannello dell'asta nel pannello di scelta briscola (per il vincitore)
function preparaSceltaBriscola() {
    const container = document.getElementById('interfaccia-asta');
    container.classList.remove('d-none');
    container.style.opacity = "1";
    container.style.pointerEvents = "auto";

    document.getElementById('btn-chiama').classList.add('d-none');
    document.getElementById('btn-passo').classList.add('d-none');
    document.getElementById('select-numero').classList.add('d-none');
    document.getElementById('scelta-seme').classList.remove('d-none');
    
    const elTurno = document.getElementById('nome-turno');
    if (elTurno) elTurno.innerText = "SCEGLI LA BRISCOLA!";
}

/**
 * --- 4. EVENTI DOM E SETUP INIZIALE ---
 * Assegnazione dei listener agli elementi HTML al caricamento della pagina.
 */
document.addEventListener("DOMContentLoaded", () => {
    
    // Bottone per creare una nuova stanza
    document.getElementById('btn-crea').onclick = () => {
        const nome = prompt("Inserisci il tuo nome:") || "Player";
        window.GameState.nomeUtente = nome;
        socket.emit('crea_partita', nome);
    };

    // Bottone per rilanciare nell'asta
    document.getElementById('btn-chiama').onclick = () => {
        const val = parseInt(document.getElementById('select-numero').value);
        const idx = ordineCarteAsta.indexOf(val);
        // Validazione: si può chiamare solo una carta che viene DOPO nella gerarchia (es. se è Asso, non puoi chiamare nulla)
        if (idx > indiceAttualeAsta) {
            const testo = document.getElementById('select-numero').options[document.getElementById('select-numero').selectedIndex].text;
            socket.emit('mossa_asta', { tipo: 'CHIAMATA', valore: testo, indice: idx });
        } else {
            alert("Devi chiamare una carta più bassa nella gerarchia (Asso > 3 > Re...)");
        }
    };

    // Bottone per uscire dall'asta
    document.getElementById('btn-passo').onclick = () => socket.emit('mossa_asta', { tipo: 'PASSO' });

    // Bottone speciale "A CARICHI": salta l'asta e gioca 1 vs 4 senza briscola
    document.getElementById('btn-carichi').onclick = () => {
        if (!GameState.mioTurno) {
            alert("Non è il tuo turno di parlare!");
            return;
        }
        if (confirm("Sei sicuro di voler chiamare A CARICHI? Sfiderai tutti da solo senza briscola fissa!")) {
            socket.emit('mossa_asta', { tipo: 'CARICHI' });
        }
    };

    // Selezione del seme di briscola (attivo solo per chi vince l'asta normale)
    document.querySelectorAll('.btn-seme').forEach(btn => {
        btn.onclick = () => {
            const seme = btn.getAttribute('data-seme');
            let carta = document.getElementById('valore-asta-carta').innerText;
            
            if (!carta || carta === "...") {
                console.warn("Valore-asta-carta vuoto, fallback a 2");
                carta = "2"; 
            }
            socket.emit('scelta_briscola', { seme, carta });
        };
    });
});