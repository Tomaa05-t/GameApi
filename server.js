// --- 1. SETUP E DIPENDENZE ---
// Importazione dei moduli necessari per creare un server web (Express),
// gestire il protocollo WebSocket (Socket.io) e navigare tra le cartelle (path).
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors()); // Abilita CORS per permettere connessioni da diverse origini
app.use(express.static(path.join(__dirname, 'static'))); // Serve i file statici (HTML, CSS, JS del client)

// Rotta principale: quando l'utente si collega, riceve il file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- 2. DATABASE TEMPORANEO ---
// Un oggetto globale che memorizza lo stato di tutte le partite attive in RAM.
// Ogni chiave è un roomID e il valore è l'intero stato della partita (giocatori, punti, carte).
let partite = {}; 

// --- 3. GESTIONE CONNESSIONI SOCKET ---
io.on('connection', (socket) => { //quando un nuovo client si connette al server
    console.log('Connesso:', socket.id); 

    // Appena un utente si connette, riceve la lista delle lobby disponibili
    socket.emit('aggiorna_lista_partite', ottieniListaLobby());

    // --- 3a. CREAZIONE PARTITA ---
    // Gestisce la logica di inizializzazione di una nuova stanza
    socket.on('crea_partita', (nomeCreatore) => {
        const numeroPartite = Object.keys(partite).length;
        if (numeroPartite >= 5) { 
            return socket.emit('errore', 'Troppe partite attive nel server.');
        }

        const roomID = `room_${Date.now()}`; // Generazione ID univoco basato sul tempo
        // Creazione dell'oggetto "Stato della Partita" con tutti i parametri necessari
        partite[roomID] = {
            id: roomID,
            creatore: nomeCreatore,
            giocatori: [{ id: socket.id, nome: nomeCreatore }],
            stato: 'LOBBY',             // Stato iniziale
            giocatoriInAsta: [],
            indiceTurnoAsta: 0,
            briscolaCorrente: null,
            cartaChiamataCorrente: null,
            idChiamante: null,
            idSocio: null,
            maniGiocate: 0,
            indiceTurnoGiocata: 0,
            carteSulTavolo: [],
            puntiGiocatori: { [socket.id]: 0 }, // Tracciamento punti per ID
            isAcarichi: false, 
            senzaBriscola: false 
        };

        socket.join(roomID); // Il server inserisce il socket nella stanza virtuale
        socket.roomID = roomID;
        
        socket.emit('partita_creata', roomID);
        io.emit('aggiorna_lista_partite', ottieniListaLobby()); // Notifica globale: nuova stanza creata
    });

    // --- 3b. UNIRSI A UNA PARTITA ---
    // Gestisce l'ingresso di nuovi giocatori in una stanza esistente
    socket.on('unisciti_a_partita', (dati) => { 
        const { roomID, nomePlayer } = dati; 
        const p = partite[roomID]; 

        // Validazione: la stanza deve esistere, deve esserci posto (<5) e deve essere in fase LOBBY
        if (p && p.giocatori.length < 5 && p.stato === 'LOBBY') {
            p.giocatori.push({ id: socket.id, nome: nomePlayer });
            p.puntiGiocatori[socket.id] = 0;
            socket.join(roomID);
            socket.roomID = roomID;

            io.to(roomID).emit('aggiorna_giocatori', p.giocatori.length);
            io.emit('aggiorna_lista_partite', ottieniListaLobby());

            // Se raggiungiamo i 5 giocatori, il matchmaking finisce e inizia la partita
            if (p.giocatori.length === 5) {
                avviaPartitaReale(roomID);
            }
        }
    });

    // --- 3c. LOGICA ASTA ---
    // Gestisce i rilanci o il ritiro (Passo) dei giocatori durante la chiamata
    socket.on('mossa_asta', (dati) => {
        const p = partite[socket.roomID];
        if (!p || p.stato !== 'ASTA') return;

        // Controllo di sicurezza: solo il giocatore di turno può parlare
        const idCorrente = p.giocatoriInAsta[p.indiceTurnoAsta];
        if (socket.id !== idCorrente) return;

        // Chiamata "A CARICHI"
        // Salta l'asta standard e imposta una sfida 1 contro 4 senza briscola
        if (dati.tipo === 'CARICHI') {
            p.stato = 'GIOCANDO';
            p.idChiamante = socket.id; // Il chiamante è chi ha dichiarato "A CARICHI"
            p.idSocio = socket.id; // In A CARICHI, il chiamante gioca da solo contro tutti, quindi è anche il "socio" di se stesso
            p.isAcarichi = true;
            p.senzaBriscola = true; 
            p.briscolaCorrente = "nessuna";
            p.cartaChiamataCorrente = "A CARICHI";
            
            p.indiceTurnoGiocata = p.giocatori.findIndex(g => g.id === socket.id);
            const vincitore = p.giocatori[p.indiceTurnoGiocata];

            io.to(p.id).emit('inizio_partita_sincronizzato', {
                seme: "A CARICHI (Senza Briscola)",
                carta: "CARICHI",
                prossimoTurnoId: socket.id,
                prossimoTurnoNome: vincitore.nome,
                giocatori: p.giocatori,
                isAcarichi: true
            });
            return;
        }

        // Logica Asta Standard: Passo o Chiamata
        if (dati.tipo === 'PASSO') {
            p.giocatoriInAsta.splice(p.indiceTurnoAsta, 1); // Rimuove chi passa dall'asta
            if (p.indiceTurnoAsta >= p.giocatoriInAsta.length) p.indiceTurnoAsta = 0;
        } else {
            p.indiceTurnoAsta = (p.indiceTurnoAsta + 1) % p.giocatoriInAsta.length;
        }

        // Se è rimasto solo un giocatore, ha vinto l'asta
        if (p.giocatoriInAsta.length === 1) {
            const vincitoreId = p.giocatoriInAsta[0];
            const vincitore = p.giocatori.find(g => g.id === vincitoreId);
            io.to(p.id).emit('fine_asta', { 
                vincitoreId: vincitoreId, 
                vincitoreNome: vincitore ? vincitore.nome : "Sconosciuto" 
            });
        } else {
            // Continua l'asta con il prossimo giocatore
            const prossimoId = p.giocatoriInAsta[p.indiceTurnoAsta];
            const prossimoGiocatore = p.giocatori.find(g => g.id === prossimoId);
            io.to(p.id).emit('aggiorna_asta', {
                ultimoValore: dati.valore || "2",
                indice: dati.indice || 0,
                prossimoGiocatoreId: prossimoId,
                prossimoGiocatoreNome: prossimoGiocatore ? prossimoGiocatore.nome : "..."
            });
        }
    });

    // --- 3d. SCELTA BRISCOLA ---
    // Fase finale dell'asta dove il vincitore dichiara seme e carta
socket.on('scelta_briscola', (dati) => {
        const p = partite[socket.roomID];
        if (!p) return;

        // Cambiamo lo stato della partita da ASTA a GIOCANDO
        p.stato = 'GIOCANDO';
        // Memorizziamo chi è il "Chiamante" (colui che ha vinto l'asta)
        p.idChiamante = socket.id;
        // Impostiamo il seme della briscola scelto (es. 'ori', 'spade'...)
        p.briscolaCorrente = dati.seme;
        
        if (dati.tipo === 'CARICHI' || dati.carta === 'CARICHI') {
            // Se si gioca "A Carichi", il chiamante gioca da solo contro tutti
            p.isAcarichi = true;
            p.idSocio = socket.id; // Chiamante e Socio coincidono
            p.cartaChiamataCorrente = "CARICHI";
        } else {
            // Partita standard: resettiamo i carichi e prepariamo la ricerca del socio
            p.isAcarichi = false;
            // IMPORTANTE: convertiamo il valore in Numero per evitare bug nel confronto successivo
            p.cartaChiamataCorrente = parseInt(dati.carta); 
            p.idSocio = null; // Il socio non è ancora noto
        }

        // Il primo a giocare la prima mano è sempre il chiamante
        p.indiceTurnoGiocata = p.giocatori.findIndex(g => g.id === socket.id);

        // Comunichiamo a tutti i client che la partita può iniziare
        io.to(p.id).emit('inizio_partita_sincronizzato', { 
            seme: p.briscolaCorrente,
            carta: p.cartaChiamataCorrente,
            prossimoTurnoId: socket.id,
            prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome,
            giocatori: p.giocatori,
            isAcarichi: p.isAcarichi
        });
    });

    // --- 3e. GIOCATA CARTA ---
    // Gestione del flusso di gioco mano per mano
    socket.on('gioca_carta', (dati) => {
    const p = partite[socket.roomID];
    if (!p || socket.id !== p.giocatori[p.indiceTurnoGiocata].id) return;

    // LOGICA IDENTIFICAZIONE SOCIO (BLINDATA)
    // Controlliamo se non è una partita "A Carichi" e se il socio non è ancora stato trovato
    if (!p.isAcarichi && p.idSocio === null) {
        // Usiamo == per sicurezza, ma avendo usato parseInt sopra, ora sono entrambi numeri
        if (dati.carta.valore == p.cartaChiamataCorrente && dati.carta.seme == p.briscolaCorrente) {
            p.idSocio = socket.id;
            console.log("SOCIO TROVATO! È il giocatore:", socket.id);
        }
    }

    p.carteSulTavolo.push({ giocatoreId: socket.id, carta: dati.carta });
        p.indiceTurnoGiocata = (p.indiceTurnoGiocata + 1) % p.giocatori.length;

        // Notifica a tutti i client quale carta è stata messa sul tavolo
        io.to(p.id).emit('aggiorna_tavolo', {
            giocatoreId: socket.id,
            carta: dati.carta,
            prossimoTurnoId: p.giocatori[p.indiceTurnoGiocata].id,
            prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome
        });

        // Se ci sono 5 carte sul tavolo, la mano è finita e va risolta
        if (p.carteSulTavolo.length === 5) {
            setTimeout(() => risolviPresa(p.id), 1500);
        }
    });

    // --- 3f. DISCONNESSIONE ---
    socket.on('disconnect', () => {
        const rID = socket.roomID;
        if (partite[rID]) {
            partite[rID].giocatori = partite[rID].giocatori.filter(g => g.id !== socket.id);
            if (partite[rID].giocatori.length === 0) {
                delete partite[rID]; // Se la stanza è vuota, viene eliminata per liberare memoria
            } else {
                io.to(rID).emit('aggiorna_giocatori', partite[rID].giocatori.length);
            }
            io.emit('aggiorna_lista_partite', ottieniListaLobby());
        }
    });
});

// --- 4. FUNZIONI LOGICHE (MOTORE DI GIOCO) ---

// Filtra solo le partite visibili nella lobby
function ottieniListaLobby() {
    return Object.values(partite)
        .filter(p => p.stato === 'LOBBY')
        .map(p => ({ id: p.id, creatore: p.creatore, n: p.giocatori.length }));
}

// Inizializza la partita distribuendo le carte
function avviaPartitaReale(roomID) {
    const p = partite[roomID];
    p.stato = 'ASTA';
    const mazzo = creaMazzo();
    
    // Distribuzione carte: 8 carte a testa 
    p.giocatori.forEach((g, i) => {
        const mano = mazzo.slice(i * 8, (i + 1) * 8);
        io.to(g.id).emit('ricevi_carte', mano);
    });

    // Avvio dell'asta dopo un breve delay per permettere l'animazione client
    setTimeout(() => {
        p.giocatoriInAsta = p.giocatori.map(g => g.id);
        const primoId = p.giocatoriInAsta[0];
        const primoNome = p.giocatori.find(g => g.id === primoId).nome;
        
        io.to(roomID).emit('inizia_asta', { 
            prossimoGiocatoreId: primoId,
            prossimoGiocatoreNome: primoNome 
        });
    }, 1500);
}

// DETERMINAZIONE DEL VINCITORE DELLA MANO
// Questa è la funzione "arbitro" che calcola chi prende le carte sul tavolo
function risolviPresa(roomID) {
    const p = partite[roomID];
    if (!p) return;

    let vincente = p.carteSulTavolo[0];
    const semeDiMano = vincente.carta.seme; // Seme di uscita

    for (let i = 1; i < p.carteSulTavolo.length; i++) {
        const sfidante = p.carteSulTavolo[i];

        if (p.senzaBriscola) {
            // Logica A CARICHI: conta solo il seme di uscita
            if (sfidante.carta.seme === semeDiMano) {
                if (confrontaCarte(sfidante.carta.valore, vincente.carta.valore)) {
                    vincente = sfidante;
                }
            }
        } else {
            // Logica STANDARD: La briscola vince su tutto, altrimenti vince il seme di uscita più alto
            if (sfidante.carta.seme === p.briscolaCorrente && vincente.carta.seme !== p.briscolaCorrente) {
                vincente = sfidante;
            } 
            else if (sfidante.carta.seme === vincente.carta.seme) {
                if (confrontaCarte(sfidante.carta.valore, vincente.carta.valore)) {
                    vincente = sfidante;
                }
            }
        }
    }

    // Calcolo punti accumulati in questa mano
    const puntiMano = p.carteSulTavolo.reduce((acc, c) => acc + (c.carta.punti || 0), 0);
    p.puntiGiocatori[vincente.giocatoreId] += puntiMano;
    p.indiceTurnoGiocata = p.giocatori.findIndex(g => g.id === vincente.giocatoreId);
    p.maniGiocate++;

    io.to(roomID).emit('fine_mano', {
        vincitoreId: vincente.giocatoreId,
        puntiAggiornati: p.puntiGiocatori,
        prossimoTurnoId: vincente.giocatoreId,
        prossimoTurnoNome: p.giocatori[p.indiceTurnoGiocata].nome
    });

    p.carteSulTavolo = [];
    // Dopo 8 mani (tutte le carte giocate), si calcola la vittoria finale
    if (p.maniGiocate === 8) {
        setTimeout(() => inviaRisultatiFinali(roomID), 2000);
    }
}

// CALCOLO PUNTI FINALI
function inviaRisultatiFinali(roomID) {
    const p = partite[roomID];
    if (!p) return;

    // Somma dei punti del Chiamante e del Socio
    const puntiChiamanti = p.puntiGiocatori[p.idChiamante] + (p.idSocio && p.idSocio !== p.idChiamante ? p.puntiGiocatori[p.idSocio] : 0);
    const nomiChiamanti = p.giocatori.find(g => g.id === p.idChiamante)?.nome + 
                          (p.idSocio && p.idSocio !== p.idChiamante ? " e " + p.giocatori.find(g => g.id === p.idSocio)?.nome : "");

    io.to(roomID).emit('partita_finita', {
        chiamante: nomiChiamanti,
        socio: p.idSocio ? p.giocatori.find(g => g.id === p.idSocio)?.nome : "Nessuno",
        puntiChiamanti,
        puntiAltri: 120 - puntiChiamanti, // Il totale dei punti nel mazzo è sempre 120
        vittoriaChiamanti: puntiChiamanti > 60 // Soglia vittoria per i chiamanti
    });

    delete partite[roomID];
    io.emit('aggiorna_lista_partite', ottieniListaLobby());
}

// CREAZIONE E MISCHIAMENTO MAZZO
function creaMazzo() {
    const semi = ['bastoni', 'spade', 'coppe', 'ori'];
    const suffix = { 'bastoni': 'bast', 'spade': 'spade', 'coppe': 'coppe', 'ori': 'ori' };
    let mazzo = [];
    for (let s of semi) {
        for (let v = 1; v <= 10; v++) {
            mazzo.push({
                seme: s, valore: v,
                // Calcolo punti briscola: Asso=11, Tre=10, Dieci=4, ecc.
                punti: (v === 1 ? 11 : v === 3 ? 10 : v === 10 ? 4 : v === 9 ? 3 : v === 8 ? 2 : 0),
                img: `carte/${s}/${v}_${suffix[s]}.png`
            });
        }
    }
    return mazzo.sort(() => Math.random() - 0.5); // Algoritmo di mescolamento casuale
}

// GERARCHIA DI FORZA DELLE CARTE
function confrontaCarte(val1, val2) {
    const gerarchia = { 1: 12, 3: 11, 10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 2: 3 };
    return (gerarchia[val1] || 0) > (gerarchia[val2] || 0);
}

// --- 5. AVVIO SERVER ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});