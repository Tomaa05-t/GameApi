import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'static')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- STATO DELLA PARTITA ---
let giocatoriConnessi = [];
let giocatoriInAsta = []; 
let indiceTurnoAsta = 0; 

// Variabili di Gioco
let briscolaCorrente = null;
let cartaChiamataCorrente = null;
let indiceTurnoGiocata = 0; // Chi deve tirare la carta
let carteSulTavolo = [];    // Array di {giocatoreId, carta}
let puntiGiocatori = {};    // { socketId: punteggio }

io.on('connection', (socket) => {
    console.log('Giocatore connesso:', socket.id);

    socket.on('unisciti_partita', (nome) => {
        if (giocatoriConnessi.length < 5) {
            if (!giocatoriConnessi.find(g => g.id === socket.id)) {
                giocatoriConnessi.push({ 
                    id: socket.id, 
                    nome: nome || `Giocatore ${giocatoriConnessi.length + 1}` 
                });
                puntiGiocatori[socket.id] = 0; // Inizializza punti
            }
            io.emit('aggiorna_giocatori', giocatoriConnessi.length);

            if (giocatoriConnessi.length === 5) {
                indiceTurnoAsta = 0;
                giocatoriInAsta = giocatoriConnessi.map(g => g.id);
                io.emit('inizia_asta', { prossimoGiocatoreId: giocatoriInAsta[0] });
            }
        }
    });

    // --- GESTIONE ASTA ---
    socket.on('mossa_asta', (dati) => {
        if (socket.id !== giocatoriInAsta[indiceTurnoAsta]) return;

        if (dati.tipo === 'PASSO') {
            giocatoriInAsta.splice(indiceTurnoAsta, 1);
            if (indiceTurnoAsta >= giocatoriInAsta.length) indiceTurnoAsta = 0;
        } else {
            indiceTurnoAsta = (indiceTurnoAsta + 1) % giocatoriInAsta.length;
        }

        if (giocatoriInAsta.length === 1) {
            const vincitoreId = giocatoriInAsta[0];
            io.emit('fine_asta', { 
                vincitoreId: vincitoreId, 
                vincitoreNome: giocatoriConnessi.find(g => g.id === vincitoreId).nome 
            });
        } else {
            io.emit('aggiorna_asta', {
                ultimoValore: dati.valore,
                indice: dati.indice,
                prossimoGiocatoreId: giocatoriInAsta[indiceTurnoAsta]
            });
        }
    });

    // --- INIZIO PARTITA ---
    socket.on('scelta_briscola', (dati) => {
        briscolaCorrente = dati.seme;
        cartaChiamataCorrente = dati.carta;
        
        // Il primo a giocare è il primo che si è connesso (indice 0)
        // O puoi impostare il vincitore dell'asta: indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === socket.id);
        indiceTurnoGiocata = 0; 
        carteSulTavolo = [];

        io.emit('inizio_partita_sincronizzato', {
            seme: dati.seme,
            carta: dati.carta,
            prossimoTurnoId: giocatoriConnessi[indiceTurnoGiocata].id
        });
    });

    // --- LOGICA DI GIOCO (CARTE IN TAVOLA) ---
    socket.on('gioca_carta', (dati) => {
        // Controllo turno
        if (socket.id !== giocatoriConnessi[indiceTurnoGiocata].id) return;

        // Aggiungi carta al tavolo
        carteSulTavolo.push({
            giocatoreId: socket.id,
            carta: dati.carta // Oggetto {valore, seme, punti, img}
        });

        // Passa il turno al prossimo
        indiceTurnoGiocata = (indiceTurnoGiocata + 1) % giocatoriConnessi.length;

        // Comunica a tutti la carta giocata
        io.emit('aggiorna_tavolo', {
            giocatoreId: socket.id,
            carta: dati.carta,
            prossimoTurnoId: giocatoriConnessi[indiceTurnoGiocata].id,
            tavoloConfig: carteSulTavolo
        });

        // Se il tavolo è pieno (5 carte), calcola chi vince la presa
        if (carteSulTavolo.length === 5) {
            setTimeout(() => {
                risolviPresa();
            }, 2000); // Aspetta 2 secondi per far vedere le carte
        }
    });

    socket.on('disconnect', () => {
        giocatoriConnessi = giocatoriConnessi.filter(g => g.id !== socket.id);
        io.emit('aggiorna_giocatori', giocatoriConnessi.length);
    });
});

// Funzione per capire chi vince la mano e assegnare punti
function risolviPresa() {
    if (carteSulTavolo.length < 5) return;

    // Qui andrebbe la logica di calcolo vincitore (Seme dominante / Briscola)
    // Per ora facciamo una logica semplificata: vince il primo giocatore (da implementare gameLogic.js)
    let idVincitorePresa = carteSulTavolo[0].giocatoreId; 
    let puntiTotaliMano = carteSulTavolo.reduce((acc, c) => acc + (c.carta.punti || 0), 0);

    puntiGiocatori[idVincitorePresa] += puntiTotaliMano;

    // Nuovo turno: chi vince la presa inizia la prossima mano
    indiceTurnoGiocata = giocatoriConnessi.findIndex(g => g.id === idVincitorePresa);
    carteSulTavolo = [];

    io.emit('fine_mano', {
        vincitoreId: idVincitorePresa,
        puntiAggiornati: puntiGiocatori,
        prossimoTurnoId: idVincitorePresa
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server online sulla porta ${PORT}`);
});